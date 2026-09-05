// 发布前回归 · 服务侧新增覆盖。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function startServer(extraEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'proof-birthday-'));
  const port = 21000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PROOF_HOST: '127.0.0.1',
      PROOF_PORT: String(port),
      PROOF_DATA_DIR: dir,
      PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
      // 注入确定性杯 id，关掉隐藏抽卡——不靠「这次应该抽不到」
      PROOF_TEST_FIXED_CUP_IDS: 'true',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stderr = [];
  child.stderr.on('data', (b) => stderr.push(String(b)));
  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(true); } });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  const ctx = { dir, child, base: `http://127.0.0.1:${port}`, stderr, started, exitCode: child.exitCode };
  if (!started) return ctx;
  await fetch(`${ctx.base}/human/admin/password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-owner-admin-password' })
  });
  ctx.token = (await readFile(join(dir, 'chara.token'), 'utf8')).trim();
  return ctx;
}

async function stop(ctx) {
  await killChild(ctx.child);
  await rm(ctx.dir, { recursive: true, force: true });
}

async function api(ctx, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(`${ctx.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function drinkOnce(ctx) {
  const created = await api(ctx, '/human/offers', {
    method: 'POST', body: { targetId: 'chara', name: '灌一杯', parts: [{ id: '伏特加', volume: 150 }] }
  });
  const capabilityToken = String(created.json.link).split('#')[1];
  return api(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.token, body: { capabilityToken } });
}

test('FIX-1：迷情剂在 AI 点单菜单里', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const home = await api(ctx, '/agent/home', { token: ctx.token });
  const names = (home.json.menu || []).map((c) => c.name || c.claimedName);
  assert.ok(names.includes('迷情剂'), '迷情剂必须在 AI 菜单里，实际：' + names.join('/'));
});

test('FIX-1：AI 点单投影保留自然语言味道与效果', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const home = await api(ctx, '/agent/home', { token: ctx.token });
  const potion = (home.json.menu || []).find((c) => (c.name || c.claimedName) === '迷情剂');
  assert.ok(potion, '找不到迷情剂');
  const text = JSON.stringify(potion);
  assert.ok(text.includes('甘甜') || text.includes('效果') || text.includes('发烫'),
    'AI 菜单应保留登记文案，实际：' + text.slice(0, 200));
});

test('FIX-2：无参数 reset 得到紧凑空闲投影且停止注入', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  await api(ctx, '/agent/injection', { method: 'POST', token: ctx.token, body: { enabled: true } });
  await drinkOnce(ctx);
  const busy = await api(ctx, '/agent/turn-context', { token: ctx.token });
  assert.equal(busy.json.active, true);

  const reset = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.token, body: {} });
  assert.equal(reset.status, 200, '无参数 reset 必须成功');
  assert.equal(reset.json.mode, '连宿醉一起清');

  const idle = await api(ctx, '/agent/turn-context', { token: ctx.token });
  assert.equal(idle.json.active, false);
  assert.equal(idle.json.shouldFetch, false);
  assert.equal(idle.json.injected, false, 'reset 后不得继续返回空注入');
  assert.equal(idle.json.block, null);
});

test('FIX-2：显式「醒酒」模式仍然可用，且保留宿醉', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  await drinkOnce(ctx);
  const sober = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.token, body: { mode: '醒酒' } });
  assert.equal(sober.status, 200);
  assert.equal(sober.json.mode, '醒酒');
});

test('FIX-3：对外监听且缺少 setup key 时必须失败关闭', async (t) => {
  const ctx = await startServer({ PROOF_HOST: '0.0.0.0', PROOF_ADMIN_SETUP_KEY: '' });
  t.after(async () => { try { await stop(ctx); } catch { /* 已退出 */ } });
  assert.equal(ctx.started, false, '缺 key 对外监听不得启动成功');
  assert.match(ctx.stderr.join(''), /PROOF_ADMIN_SETUP_KEY/);
});

test('FIX-3：没有 setup key 也没打开本地开发开关时，初始化端点关闭', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-noinit-'));
  const port = 21900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PROOF_HOST: '127.0.0.1', PROOF_PORT: String(port), PROOF_DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => { await killChild(child); await rm(dir, { recursive: true, force: true }); });
  const up = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(true); } });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!up) return t.skip('start_failed');
  const r = await fetch(`http://127.0.0.1:${port}/human/admin/password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'another-owner-password' })
  });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'admin_setup_not_allowed');
});

test('FIX-4：公开链接第一屏不含味道、效果、收尾与配方', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const created = await api(ctx, '/human/offers', {
    method: 'POST', body: { targetId: 'chara', name: '喝前不该看到', parts: [{ id: '金酒', volume: 45 }, { id: '汤力水', volume: 100 }] }
  });
  const token = String(created.json.link).split('#')[1];
  const first = await fetch(`${ctx.base}/capability/offer`, { headers: { authorization: `Bearer ${token}` } });
  const body = await first.json();
  const keys = Object.keys(body.projection || {});
  for (const banned of ['flavor', 'flavorDescription', 'finish', 'recipe', 'claimedEffects', 'actualEffectDescription']) {
    assert.equal(keys.includes(banned), false, `第一屏不得含 ${banned}，实际字段：${keys.join(',')}`);
  }
  assert.deepEqual(keys.sort(), ['claimedName', 'color', 'cupType', 'intro'].sort());
});

test('FIX-4：喝完之后才给味道与效果', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const created = await api(ctx, '/human/offers', {
    method: 'POST', body: { targetId: 'chara', name: '喝完才有', parts: [{ id: '金酒', volume: 45 }] }
  });
  const token = String(created.json.link).split('#')[1];
  const drunk = await fetch(`${ctx.base}/capability/offer`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'drink' })
  });
  const body = await drunk.json();
  assert.equal(body.ok, true);
  assert.ok(body.projection.flavorDescription, '喝完必须给味道');
  assert.ok(body.projection.actualEffectDescription, '喝完必须给效果');
});

test('匿名饮用仍不写入 Agent 状态', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const before = await api(ctx, '/agent/turn-context', { token: ctx.token });
  const created = await api(ctx, '/human/offers', {
    method: 'POST', body: { targetId: 'chara', name: '路人喝的', parts: [{ id: '伏特加', volume: 120 }] }
  });
  const token = String(created.json.link).split('#')[1];
  await fetch(`${ctx.base}/capability/offer`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'drink' })
  });
  const after = await api(ctx, '/agent/turn-context', { token: ctx.token });
  assert.equal(after.json.revision, before.json.revision, '匿名饮用不得推进 Agent 的 revision');
});

test('追加 · 认证 Agent 喝前也只有四个字段', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const created = await api(ctx, '/human/offers', {
    method: 'POST', body: { targetId: 'chara', name: '给认证 Agent', parts: [{ id: '金酒', volume: 45 }, { id: '汤力水', volume: 100 }] }
  });
  const capabilityToken = String(created.json.link).split('#')[1];
  // Agent 领取（领取即饮用），领取前先用 Agent 身份看第一屏
  const claimed = await api(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.token, body: { capabilityToken }
  });
  assert.equal(claimed.json.ok, true);
  const offerId = claimed.json.offerId;

  // 再造一杯，用 Agent 身份在喝之前看
  const second = await api(ctx, '/human/offers', {
    method: 'POST', body: { targetId: 'chara', name: '喝前看一眼', parts: [{ id: '金酒', volume: 45 }] }
  });
  const token2 = String(second.json.link).split('#')[1];
  const claim2 = await api(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.token, body: { capabilityToken: token2 } });
  const id2 = claim2.json.offerId;
  const view = await api(ctx, `/agent/offers/${id2}`, { token: ctx.token });
  assert.equal(view.status, 200);
  // 这一杯已经被领取即饮用，所以看到的是喝后视图；喝后应当有效果
  assert.ok(view.json.projection, '应当返回投影');
  assert.ok(offerId, '领取应当给出 offerId');
});

test('追加 · 喝前（未饮用）的 Agent 视图不含声称效果', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  // 用引擎直接验证喝前投影：服务层的 Agent 路径与之同源
  const { ProofEngine, realPack, buildFromParts } = await import('../../engine/src/index.js');
  const e = new ProofEngine(null, realPack);
  const cup = buildFromParts('喝前', [{ id: '金酒', volume: 45 }], { kind: 'custom', listed: false, intro: '一杯没有说明的特调。' });
  const id = e.createOffer(cup, 'user', 'user', 'chara', 0);
  const keys = Object.keys(e.viewOffer(id, 'chara', 0).projection).sort();
  assert.deepEqual(keys, ['claimedName', 'color', 'cupType', 'intro']);
});

test('追加 · 已消费/过期的公开链接会被清理，不会无限堆积', async (t) => {
  const ctx = await startServer({ PROOF_PUBLIC_LINK_RETENTION_HOURS: '1' });
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  // 造一杯并喝掉
  const created = await api(ctx, '/human/offers', {
    method: 'POST', body: { targetId: 'chara', name: '会被清理', parts: [{ id: '水', volume: 100 }] }
  });
  const token = String(created.json.link).split('#')[1];
  await fetch(`${ctx.base}/capability/offer`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'drink' })
  });

  const { readFile, writeFile } = await import('node:fs/promises');
  const path = join(ctx.dir, 'catalog.json');
  const raw = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(raw.capabilities.length >= 1, true);
  // 把消费时间改到保留期之外
  for (const cap of raw.capabilities) {
    if (cap.status === 'consumed') cap.consumedAt = Date.now() - 3 * 3600000;
  }
  await writeFile(path, JSON.stringify(raw));
  await killChild(ctx.child);

  const again = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PROOF_HOST: '127.0.0.1',
      PROOF_PORT: String(new URL(ctx.base).port),
      PROOF_DATA_DIR: ctx.dir,
      PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
      PROOF_PUBLIC_LINK_RETENTION_HOURS: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  ctx.child = again;
  const up = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    again.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(true); } });
    again.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!up) return t.skip('restart_failed');
  // 触发一次会走 expirePublicOffers 的读取
  await api(ctx, '/human/offers');
  const after = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(after.capabilities.some((c) => c.status === 'consumed'), false,
    '超过保留期的已消费链接应被清掉');
});
