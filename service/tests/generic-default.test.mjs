// 开源前 Generic Agent 清理 —— 服务层回归。
// 产品默认（PROOF_AGENTS 缺省）＝单个 generic 'char'（N>=1）。
// 此处显式清除 env，验证默认与 legacy STATE_FILE fallback 迁移到 registry 首个 Agent。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
delete process.env.PROOF_AGENTS; // 本套件验证“不配置”时的 generic 默认

async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function startServer(extraEnv = {}) {
  const dir = extraEnv.PROOF_DATA_DIR ? null : await mkdtemp(join(tmpdir(), 'proof-gen-'));
  const dataDir = dir || extraEnv.PROOF_DATA_DIR;
  const port = 29000 + Math.floor(Math.random() * 800);
  const env = {
    ...process.env,
    PROOF_HOST: '127.0.0.1',
    PROOF_PORT: String(port),
    PROOF_DATA_DIR: dataDir,
    PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
    ...extraEnv
  };
  if (extraEnv.PROOF_AGENTS == null) delete env.PROOF_AGENTS; // 未显式提供 → 走 generic 默认
  const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 12_000);
    child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(true); } });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  const ctx = { dir, child, base: `http://127.0.0.1:${port}`, started };
  if (!started) return ctx;
  await fetch(`${ctx.base}/human/admin/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-owner-admin-password' }) });
  ctx.dataDir = dataDir;
  ctx.agentId = extraEnv.PROOF_AGENTS ? String(extraEnv.PROOF_AGENTS).split(',')[0].split(':')[0].trim() : 'char';
  ctx.agent = (await readFile(join(dataDir, `${ctx.agentId}.token`), 'utf8')).trim();
  return ctx;
}

async function stop(ctx) { await killChild(ctx.child); if (ctx.dir) await rm(ctx.dir, { recursive: true, force: true }); }
async function api(ctx, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`${ctx.base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: r.status, json, text };
}
async function enginesFile(ctx) { try { return JSON.parse(await readFile(join(ctx.dataDir, 'engines.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } }

test('GD-1 generic 默认：不配置 PROOF_AGENTS 时 registry 恰为一个 generic agent，全链路可用', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const agents = await api(ctx, '/human/agents');
  assert.equal(agents.status, 200);
  assert.ok(Array.isArray(agents.json.agents) && agents.json.agents.length === 1, 'registry 恰 1 个');
  assert.equal(agents.json.agents[0].id, 'char', 'generic 默认 id');
  assert.ok(ctx.agent, 'generic agent token 已生成');
  // bar → drink → ledger → turn-context → reset
  const home = await api(ctx, '/agent/home', { token: ctx.agent });
  assert.equal(home.status, 200);
  const drink = await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.agent });
  assert.equal(drink.status, 200, drink.text.slice(0, 200));
  assert.ok(drink.json.drink && drink.json.drink.actualEffectDescription);
  const tc = await api(ctx, '/agent/turn-context', { token: ctx.agent });
  assert.equal(tc.json.hasState, true);
  assert.equal(tc.json.injected, true, 'generic agent 自动投递默认开');
  const saved = await enginesFile(ctx);
  assert.ok(saved.char.records.length > 0, 'generic ledger +');
  const rs = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.agent, body: {} });
  assert.equal(rs.status, 200);
});

async function legacyState() {
  const { ProofEngine } = await import('../../engine/src/index.js');
  const { realPack, menuItem } = await import('../../engine/src/content/realPack.js');
  const e = new ProofEngine(null, realPack);
  const id = e.createOffer(menuItem('金汤力'), 'user', 'user', 'legacy-drinker', Date.now() - 1000);
  const r = e.drinkOffer(id, 'legacy-drinker', 'legacy-1', Date.now() - 1000);
  assert.equal(r.ok, true);
  return e.exportState();
}

test('GD-2 legacy 单 Agent 存档迁入 generic 默认的首 Agent', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-legacy-g-'));
  await writeFile(join(dir, 'engine.json'), JSON.stringify(await legacyState())); // 旧路径：单 agent 状态
  const ctx = await startServer({ PROOF_DATA_DIR: dir });
  if (!ctx.started) { await rm(dir, { recursive: true, force: true }); return t.skip('server_start_failed'); }
  t.after(async () => { await killChild(ctx.child); await rm(dir, { recursive: true, force: true }); });
  const saved = await enginesFile(ctx);
  assert.ok(saved.char, 'legacy 状态迁入 generic 首 Agent');
  assert.ok(saved.char.records.length > 0, 'legacy 历史随迁');
  const tc = await api(ctx, '/agent/turn-context', { token: ctx.agent });
  assert.equal(tc.json.hasState, true, '迁移后状态可读');
});

test('GD-3 legacy 存档迁入自定义首 Agent', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-legacy-a-'));
  await writeFile(join(dir, 'engine.json'), JSON.stringify(await legacyState()));
  const ctx = await startServer({ PROOF_DATA_DIR: dir, PROOF_AGENTS: 'alpha:Alpha' });
  if (!ctx.started) { await rm(dir, { recursive: true, force: true }); return t.skip('server_start_failed'); }
  t.after(async () => { await killChild(ctx.child); await rm(dir, { recursive: true, force: true }); });
  const saved = await enginesFile(ctx);
  assert.ok(saved.alpha, 'legacy 迁入自定义首 Agent alpha');
  assert.ok(saved.alpha.records.length > 0);
  assert.equal(saved.char === undefined, true, '显式配置时不创建额外默认身份');
  const agents = await api(ctx, '/human/agents');
  assert.equal(agents.json.agents.length, 1);
  assert.equal(agents.json.agents[0].id, 'alpha');
});
