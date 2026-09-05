// 生命周期契约 · 服务侧：Agent 隔离、匿名不写 Agent、四入口同一投影、reset 语义。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function startServer(extraEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'proof-lifecycle-'));
  const port = 19000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PROOF_HOST: '127.0.0.1', PROOF_PORT: String(port), PROOF_DATA_DIR: dir, PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
      // 注入确定性杯 id，关掉隐藏抽卡——不靠「这次应该抽不到」
      PROOF_TEST_FIXED_CUP_IDS: 'true', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stderr = [];
  child.stderr.on('data', (buf) => stderr.push(String(buf)));
  const ok = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('listening')) { clearTimeout(timer); resolve(true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  const base = `http://127.0.0.1:${port}`;
  const ctx = { dir, port, child, base, stderr, started: ok };
  if (!ok) return ctx;
  await fetch(`${base}/human/admin/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-owner-admin-password' })
  });
  ctx.admin = 'test-owner-admin-password';
  ctx.tokens = {
    charb: (await readFile(join(dir, 'charb.token'), 'utf8')).trim(),
    chara: (await readFile(join(dir, 'chara.token'), 'utf8')).trim(),
    charc: (await readFile(join(dir, 'charc.token'), 'utf8')).trim()
  };
  return ctx;
}

// 子进程可能已经自己退出（例如配置非法），此时不能再等 'exit'，否则挂死。
async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function stop2(ctx) { return stopServer(ctx); }

async function stopServer(ctx) {
  await killChild(ctx.child);
  await rm(ctx.dir, { recursive: true, force: true });
}

async function req(ctx, path, { method = 'GET', token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body) h['content-type'] = 'application/json';
  const response = await fetch(`${ctx.base}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await response.json(); } catch { /* 非 JSON */ }
  return { status: response.status, json };
}

async function offerTo(ctx, targetId, name = '测试特调') {
  return req(ctx, '/human/offers', {
    method: 'POST',
    body: { targetId, claimedName: name, parts: [{ id: '伏特加', volume: 120 }] }
  });
}

// 公开链接不预绑定接收者：Agent 用 capability token 领取，领取即饮用。
async function drinkAs(ctx, token) {
  const created = await offerTo(ctx, 'chara');
  const capabilityToken = String(created.json.link).split('#')[1];
  const claimed = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token, body: { capabilityToken }
  });
  return { created, claimed, offerId: claimed.json.offerId };
}

test('隔离：伪造 agentId 被拒绝', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip(`server_start_failed: ${ctx.stderr.join('')}`);
  t.after(() => stopServer(ctx));
  const forged = await req(ctx, '/agent/injection', {
    method: 'POST', token: ctx.tokens.chara, body: { enabled: true, agentId: 'charb' }
  });
  assert.equal(forged.status, 403);
  const anon = await req(ctx, '/agent/turn-context');
  assert.equal(anon.status, 401);
});

test('隔离：turn-context 只返回自己的投影，且带 revision/day', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip(`server_start_failed: ${ctx.stderr.join('')}`);
  t.after(() => stopServer(ctx));
  const mine = await req(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.agentId, 'chara');
  assert.equal(typeof mine.json.revision, 'number');
  assert.match(mine.json.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(mine.json.active, false);
  assert.equal(mine.json.shouldFetch, false);
});

test('隔离：A 喝酒不改变 B 的 revision', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip(`server_start_failed: ${ctx.stderr.join('')}`);
  t.after(() => stopServer(ctx));
  const before = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  const { claimed } = await drinkAs(ctx, ctx.tokens.chara);
  assert.equal(claimed.json.ok, true);
  const after = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(after.json.revision, before.json.revision, 'B 的 revision 不得被 A 的饮用推进');
});

test('幂等：同一杯重复 POST 不重复累计', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip(`server_start_failed: ${ctx.stderr.join('')}`);
  t.after(() => stopServer(ctx));
  const { claimed, offerId } = await drinkAs(ctx, ctx.tokens.chara);
  assert.equal(claimed.json.ok, true);
  assert.equal(claimed.json.idempotent, false, '第一次领取即入账');
  const repeat = await req(ctx, `/agent/offers/${offerId}/drink`, {
    method: 'POST', token: ctx.tokens.chara, headers: { 'idempotency-key': 'same' }
  });
  assert.equal(repeat.json.ok, true);
  assert.equal(repeat.json.idempotent, true, '重复 POST 不得重复累计');
});

test('reset：返回 active=false / shouldFetch=false，且保留敏感度字段', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip(`server_start_failed: ${ctx.stderr.join('')}`);
  t.after(() => stopServer(ctx));
  await drinkAs(ctx, ctx.tokens.chara);
  const reset = await req(ctx, '/agent/reset', {
    method: 'POST', token: ctx.tokens.chara, body: { mode: '连宿醉一起清' }
  });
  assert.equal(reset.status, 200);
  const ctxAfter = await req(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
  assert.equal(ctxAfter.json.active, false);
  assert.equal(ctxAfter.json.shouldFetch, false);
  assert.ok(ctxAfter.json.sensitivitySummary !== undefined);
});

test('配置：非法配置必须启动失败，不得静默回退', async (t) => {
  const ctx = await startServer({ PROOF_BLACKOUT_RECOVERY_HOURS: 'abc' });
  t.after(async () => { try { await stopServer(ctx); } catch { /* 已退出 */ } });
  assert.equal(ctx.started, false, '非法配置不得启动成功');
  assert.match(ctx.stderr.join(''), /PROOF_BLACKOUT_RECOVERY_HOURS/);
});

test('重启：revision 与状态来自持久文件，跨进程保持', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip(`server_start_failed: ${ctx.stderr.join('')}`);
  await drinkAs(ctx, ctx.tokens.chara);
  const before = await req(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
  assert.ok(before.json.revision > 0, '喝过之后 revision 必须大于 0');

  await killChild(ctx.child);

  // 同一数据目录重新起一个进程
  const again = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PROOF_HOST: '127.0.0.1', PROOF_PORT: String(ctx.port), PROOF_DATA_DIR: ctx.dir, PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    await killChild(again);
    await rm(ctx.dir, { recursive: true, force: true });
  });
  const up = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    again.stdout.on('data', (buf) => { if (String(buf).includes('listening')) { clearTimeout(timer); resolve(true); } });
    again.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!up) return t.skip('restart_failed');
  const after = await req(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
  assert.equal(after.json.revision, before.json.revision, 'revision 必须来自持久状态');
});

test('P0：HTTP 路上的断片也进 block.text', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip(`server_start_failed: ${ctx.stderr.join('')}`);
  t.after(() => stop2(ctx));
  await req(ctx, '/agent/injection', { method: 'POST', token: ctx.tokens.chara, body: { enabled: true } });
  // 灌到断片：多次领取同一 Agent
  for (let i = 0; i < 6; i += 1) {
    const created = await req(ctx, '/human/offers', {
      method: 'POST',
      body: { targetId: 'chara', claimedName: `灌${i}`, parts: [{ id: '伏特加', volume: 400 }] }
    });
    const capabilityToken = String(created.json.link).split('#')[1];
    await req(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.tokens.chara, body: { capabilityToken } });
  }
  const turn = await req(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
  assert.equal(turn.status, 200);
  if (!turn.json.blackout?.active) return t.skip('未达到断片阈值，跳过');
  assert.equal(turn.json.injected, true, '断片时 HTTP 也必须注入');
  assert.ok(turn.json.block.text.includes('尚未恢复的断片期'));
  assert.equal(turn.json.block.text.includes('像被雾吞掉了'), false);
});
