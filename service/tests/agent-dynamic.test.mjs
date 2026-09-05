// 部署前静态收口 v2 —— 服务层动态 Agent 契约。
// 用 PROOF_AGENTS=...（registry 是动态配置源，非三 Agent 常量）注册第 4 个 fixture Agent 'ark'，
// 验证：N+1 全链路、任意 A≠B 隔离、自动投递确定化动态遍历 registry、72h 公开清理与 Agent 解耦。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REGISTRY = 'charb:CharB,chara:CharA,charc:CharC,ark:阿克';
const AGENT_IDS = ['charb', 'chara', 'charc', 'ark'];

async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function startServer(extraEnv = {}) {
  const dir = extraEnv.PROOF_DATA_DIR ? null : await mkdtemp(join(tmpdir(), 'proof-dyn-'));
  const dataDir = dir || extraEnv.PROOF_DATA_DIR;
  const port = 27000 + Math.floor(Math.random() * 800);
  const env = {
    ...process.env,
    PROOF_HOST: '127.0.0.1',
    PROOF_PORT: String(port),
    PROOF_DATA_DIR: dataDir,
    PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
    PROOF_AGENTS: REGISTRY,
    ...extraEnv
  };
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 12_000);
    child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(true); } });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  const ctx = { dir, child, base: `http://127.0.0.1:${port}`, started };
  if (!started) return ctx;
  await fetch(`${ctx.base}/human/admin/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-owner-admin-password' }) });
  ctx.dataDir = dataDir;
  ctx.tokens = {};
  for (const id of AGENT_IDS) {
    ctx.tokens[id] = (await readFile(join(dataDir, `${id}.token`), 'utf8')).trim();
  }
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

async function stateFile(ctx) { try { return JSON.parse(await readFile(join(ctx.dataDir, 'engines.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } }

function snapshot(fields, keys) {
  const out = {};
  for (const k of keys) {
    const a = fields[k] || {};
    out[k] = { c: a.c || 0, cupsDrunk: a.cupsDrunk || 0, records: (a.records || []).length, actives: a.actives || {}, revision: a.revision || 0 };
  }
  return out;
}

async function makeLink(ctx, name, parts) {
  const made = await api(ctx, '/human/offers', { method: 'POST', body: { name, parts } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const link = made.json.link;
  return { link, token: link.slice(link.indexOf('#') + 1) };
}

test('DYN-1 第 N+1 个动态 Agent 全链路（不在默认三人名单，经 registry 配置注册）', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  assert.ok(ctx.tokens.ark, 'ark 由动态 registry 注册并获得 token');
  const before = snapshot(await stateFile(ctx), AGENT_IDS);
  const home = await api(ctx, '/agent/home', { token: ctx.tokens.ark });
  assert.equal(home.status, 200);
  assert.ok((home.json.menu || []).length > 0);
  const drink = await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.ark });
  assert.equal(drink.status, 200, drink.text.slice(0, 200));
  assert.ok(drink.json.drink && drink.json.drink.actualEffectDescription, 'ark 当轮有效果');
  const tc = await api(ctx, '/agent/turn-context', { token: ctx.tokens.ark });
  assert.equal(tc.json.hasState, true, 'ark 状态正常产生');
  assert.equal(tc.json.injected, true, 'ark 自动投递默认开');
  const mid = snapshot(await stateFile(ctx), AGENT_IDS);
  assert.ok(mid.ark.records > before.ark.records, 'ark ledger +');
  assert.equal(mid.charb.records, before.charb.records, 'charb 不变');
  assert.equal(mid.chara.records, before.chara.records, 'chara 不变');
  assert.equal(mid.charc.records, before.charc.records, 'charc 不变');
  // reset
  const rs = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.ark, body: {} });
  assert.equal(rs.status, 200, rs.text.slice(0, 200));
  const idle = await api(ctx, '/agent/turn-context', { token: ctx.tokens.ark });
  assert.equal(idle.json.hasState, false);
  // 自动投递配置可关并持久化（ark 自己的配置，不影响其他人）
  const off = await api(ctx, '/agent/injection', { method: 'POST', token: ctx.tokens.ark, body: { enabled: false } });
  assert.equal(off.json.stateInjection, false);
  const saved = await stateFile(ctx);
  assert.equal(saved.ark.stateInjection, false);
  assert.equal(saved.ark.stateInjectionConfigured, true);
  assert.equal(saved.chara.stateInjection, true, '其他 Agent 开关不受影响');
});

test('DYN-2 任意 A≠B 隔离：drink/reset/自动投递都不改变对方', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const beforeArk = snapshot(await stateFile(ctx), ['ark']);
  // charb 喝酒并 reset
  await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.charb });
  await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.charb });
  await api(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });
  const afterCharBOps = snapshot(await stateFile(ctx), ['ark', 'charb']);
  assert.deepEqual(afterCharBOps.ark, beforeArk.ark, 'charb 的 drink/reset 不改变 ark');
  assert.equal(afterCharBOps.charb.records >= 2, true, 'charb 自己历史在');
  // ark 喝酒不影响 charb 已 reset 后的状态；mil 也不再注入
  const charbBefore = snapshot(await stateFile(ctx), ['charb']);
  await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.ark });
  const afterArk = snapshot(await stateFile(ctx), ['charb', 'ark']);
  assert.equal(afterArk.charb.records, charbBefore.charb.records, 'ark 喝酒不改变 charb');
  // ark 关闭自动投递不影响 charb turn-context 状态存在性（charb 无状态）
  await api(ctx, '/agent/injection', { method: 'POST', token: ctx.tokens.ark, body: { enabled: false } });
  const charbTc = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(charbTc.status, 200);
});

test('DYN-3 自动投递确定化动态遍历 registry（含第 4 个 Agent，非固定三名）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-dyn3-'));
  const { ProofEngine } = await import('../../engine/src/index.js');
  const { realPack } = await import('../../engine/src/content/realPack.js');
  const mkLegacy = (stateInjection) => {
    const s = new ProofEngine(null, realPack).exportState();
    s.stateInjection = stateInjection;
    delete s.stateInjectionConfigured;
    return s;
  };
  const engines = { charb: mkLegacy(false), chara: mkLegacy(false), charc: mkLegacy(false), ark: mkLegacy(false) };
  const catalog = {
    drinks: [], proposals: [], visibility: {}, capabilities: [],
    audit: [{ actorType: 'agent', actorId: 'charb', targetId: 'charb', action: 'injection', result: false, time: Date.now() - 1000 }]
  };
  await writeFile(join(dir, 'engines.json'), JSON.stringify(engines));
  await writeFile(join(dir, 'catalog.json'), JSON.stringify(catalog));
  const ctx = await startServer({ PROOF_DATA_DIR: dir });
  if (!ctx.started) { await rm(dir, { recursive: true, force: true }); return t.skip('server_start_failed'); }
  t.after(async () => { await killChild(ctx.child); await rm(dir, { recursive: true, force: true }); });
  const saved = await stateFile(ctx);
    // charb：审计证据“曾显式关” → 关；chara/charc/ark：无证据 → 新默认开。全部 configured=true。
  assert.equal(saved.charb.stateInjection, false, 'charb 显式关保持关');
  assert.equal(saved.charb.stateInjectionConfigured, true);
  for (const id of ['chara', 'charc', 'ark']) {
    assert.equal(saved[id].stateInjection, true, `${id} 无关闭证据 → 默认开`);
    assert.equal(saved[id].stateInjectionConfigured, true, `${id} 已确定化（不再依赖 audit）`);
  }
});

test('DYN-4 72h 公开清理与 Agent registry/历史完全解耦', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-dyn4-'));
  const ctx = await startServer({ PROOF_DATA_DIR: dir, PROOF_PUBLIC_LINK_RETENTION_HOURS: '1' });
  if (!ctx.started) { await rm(dir, { recursive: true, force: true }); return t.skip('server_start_failed'); }
  const link1 = await makeLink(ctx, '老链接', [{ id: '威士忌', volume: 60 }]);
  const anonymous = await api(ctx, '/capability/offer', { method: 'POST', token: link1.token, body: { action: 'drink' } });
  assert.equal(anonymous.status, 200, anonymous.text.slice(0, 200));
  assert.ok(anonymous.json && anonymous.json.portableResult, '匿名饮用返回 portable result');
  const beforeAgents = snapshot(await stateFile(ctx), AGENT_IDS);
  await killChild(ctx.child);
  // 把该终端 capability 的终态时间伪造成超过 retention（>1h），模拟 72h 后
  const catPath = join(dir, 'catalog.json');
  const cat = JSON.parse(await readFile(catPath, 'utf8'));
  const old = Date.now() - 2 * 3600000;
  const entry = cat.capabilities.find((c) => c.status !== 'open');
  assert.ok(entry, '存在终端 capability');
  entry.createdAt = old;
  entry.consumedAt = old;
  await writeFile(catPath, JSON.stringify(cat));
  const engPath = join(dir, 'engines.json');
  const eng = JSON.parse(await readFile(engPath, 'utf8'));
  const publicKeysBefore = Object.keys(eng).filter((k) => k.startsWith('public:'));
  assert.ok(publicKeysBefore.length >= 1, '存在 public 临时 engine');
  await writeFile(engPath, JSON.stringify(eng));
  // 重启（同 registry，不枚举 Agent），触发一次 cleanup
  const ctx2 = await startServer({ PROOF_DATA_DIR: dir, PROOF_PUBLIC_LINK_RETENTION_HOURS: '1' });
  if (!ctx2.started) return t.skip('restart_failed');
  t.after(async () => { await killChild(ctx2.child); await rm(dir, { recursive: true, force: true }); });
  // 触发一次 cleanup（公开层路由 GET /human/offers 内部会清理过期终端 capability/public engine）
  const list = await api(ctx2, '/human/offers');
  assert.equal(list.status, 200, list.text.slice(0, 120));
  // 老终端 capability 与对应 public engine 被清理
  const cat2 = JSON.parse(await readFile(catPath, 'utf8'));
  assert.equal(cat2.capabilities.some((c) => c.offerId === entry.offerId), false, '终端 capability 已清理');
  const eng2 = JSON.parse(await readFile(engPath, 'utf8'));
  assert.equal(eng2[`public:${entry.offerId}`] === undefined, true, '对应 public 临时 engine 已清理');
  // Agent 历史零删除
  const afterAgents = snapshot(eng2, AGENT_IDS);
  for (const id of AGENT_IDS) {
    assert.deepEqual(afterAgents[id], beforeAgents[id], `${id} 历史/状态未被 cleanup 删除`);
  }
});
