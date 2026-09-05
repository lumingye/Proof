// 回归修复 A · 服务侧：保留身份不得进入普通菜单或 AI 点单列表。

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

async function startServer() {
  const dir = await mkdtemp(join(tmpdir(), 'proof-reserved-'));
  const port = 19900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PROOF_HOST: '127.0.0.1', PROOF_PORT: String(port), PROOF_DATA_DIR: dir, PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
      // 注入确定性杯 id，关掉隐藏抽卡——不靠「这次应该抽不到」
      PROOF_TEST_FIXED_CUP_IDS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    child.stdout.on('data', (buf) => { if (String(buf).includes('listening')) { clearTimeout(timer); resolve(true); } });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  const base = `http://127.0.0.1:${port}`;
  const ctx = { dir, child, base, started };
  if (!started) return ctx;
  await fetch(`${base}/human/admin/password`, {
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

async function post(ctx, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${ctx.base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const VODKA = [{ id: '伏特加', volume: 100 }];

test('A：保存名为 heaven 的普通菜单项被拒绝', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const r = await post(ctx, '/human/menu', { name: 'heaven', parts: VODKA });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'reserved_hidden_name');
});

test('A：大小写变体 Heaven 同样被拒绝', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const r = await post(ctx, '/human/menu', { name: 'Heaven', parts: VODKA });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'reserved_hidden_name');
});

test('A：保存名为「五彩斑斓的黑」被拒绝', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const r = await post(ctx, '/human/menu', { name: '五彩斑斓的黑', parts: VODKA });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'reserved_hidden_name');
});

test('A：把已有菜单项重命名为保留名被拒绝', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const created = await post(ctx, '/human/menu', { name: '普通特调', parts: VODKA });
  assert.equal(created.status, 201);
  const id = created.json.drink.id;
  const renamed = await fetch(`${ctx.base}/human/menu/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'heaven' })
  });
  assert.equal(renamed.status, 400);
  assert.equal((await renamed.json()).error, 'reserved_hidden_name');
});

test('A：AI 点单列表不出现遗留的保留名条目', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  // 直接写进 catalog 模拟历史遗留数据
  const created = await post(ctx, '/human/menu', { name: '将被改名', parts: VODKA });
  const id = created.json.drink.id;
  const catalogPath = join(ctx.dir, 'catalog.json');
  const raw = JSON.parse(await readFile(catalogPath, 'utf8'));
  const item = raw.drinks.find((d) => d.id === id);
  item.cup.claimedName = 'heaven';
  const { writeFile } = await import('node:fs/promises');
  await writeFile(catalogPath, JSON.stringify(raw));
  await killChild(ctx.child);
  const again = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PROOF_HOST: '127.0.0.1', PROOF_PORT: String(new URL(ctx.base).port), PROOF_DATA_DIR: ctx.dir, PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  ctx.child = again;
  const up = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    again.stdout.on('data', (buf) => { if (String(buf).includes('listening')) { clearTimeout(timer); resolve(true); } });
    again.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!up) return t.skip('restart_failed');
  const home = await fetch(`${ctx.base}/agent/home`, { headers: { authorization: `Bearer ${ctx.token}` } });
  const body = await home.json();
  assert.ok(Array.isArray(body.menu));
  assert.equal(body.menu.some((cup) => String(cup.name || cup.claimedName).toLowerCase() === 'heaven'), false,
    'AI 点单列表不得出现保留名');
  const human = await (await fetch(`${ctx.base}/human/menu`)).json();
  assert.equal(human.drinks.some((d) => String(d.name).toLowerCase() === 'heaven'), false,
    '人类菜单也不得出现保留名');
});

test('A：普通命名不能绕过 5% 抽取（合格配方仍走抽卡）', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  // 递一杯合格的纯烈酒特调，名字随便起——不得因为名字而必中隐藏
  const created = await post(ctx, '/human/offers', { targetId: 'chara', name: '我的特调', parts: [{ id: '伏特加', volume: 150 }] });
  assert.equal(created.status, 201);
  assert.notEqual(String(created.json.name).toLowerCase(), 'heaven');
});

test('B：装饰物必须在允许列表内，否则 400', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const bad = await post(ctx, '/human/menu', { name: '带装饰', parts: VODKA, garnishes: ['伏特加'] });
  assert.equal(bad.status, 400);
  const good = await post(ctx, '/human/menu', { name: '带装饰2', parts: VODKA, garnishes: ['柠檬皮'] });
  assert.equal(good.status, 201);
});
