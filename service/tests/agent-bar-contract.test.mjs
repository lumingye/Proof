// Proof · Agent 饮酒/状态投递/Reset + Gateway/MCP 并列收口单 —— 服务层契约。
// 只验证“谁消费记谁、Link 只在真正喝下时消耗、状态读取与注入许可解耦、
// reset 清当前状态保历史、匿名回归、actives 单链路”等服务侧事实。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PROOF_AGENTS = 'charb:CharB,chara:CharA,charc:CharC'; // 测试 fixture：用户部署三 Agent（产品默认已 generic）
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T0 = Date.UTC(2026, 8, 3, 9, 0, 0);

function agentBase(snap, id) { const a = (snap && snap[id]) || {}; return { c: a.c || 0, cupsDrunk: a.cupsDrunk || 0, records: a.records || [], revision: a.revision || 0, actives: a.actives || {} }; }
function assertAgentUnchanged(snap, id, before) {
  const b = before && before[id];
  if (!b) {
    const a = (snap && snap[id]) || {};
    assert.equal(a.c || 0, 0, id + ' 未被写入(c)');
    assert.equal(a.cupsDrunk || 0, 0, id + ' 未被写入(cups)');
    assert.equal((a.records || []).length, 0, id + ' 未被写入(records)');
    assert.equal(a.revision || 0, 0, id + ' revision 不变');
    return;
  }
  assert.deepEqual(snap[id], b, id + ' 完全不变');
}


async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function startServer(extraEnv = {}) {
  const dir = extraEnv.PROOF_DATA_DIR ? null : await mkdtemp(join(tmpdir(), 'proof-agentbar-'));
  const dataDir = dir || extraEnv.PROOF_DATA_DIR;
  const port = 24000 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PROOF_HOST: '127.0.0.1', PROOF_PORT: String(port), PROOF_DATA_DIR: dataDir, PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10_000);
    child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(true); } });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  const ctx = { dir, child, base: `http://127.0.0.1:${port}`, started };
  if (!started) return ctx;
  await fetch(`${ctx.base}/human/admin/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-owner-admin-password' }) });
  ctx.dataDir = dataDir;
  ctx.tokens = {
    charb: (await readFile(join(dataDir, 'charb.token'), 'utf8')).trim(),
    chara: (await readFile(join(dataDir, 'chara.token'), 'utf8')).trim(),
    charc: (await readFile(join(dataDir, 'charc.token'), 'utf8')).trim()
  };
  return ctx;
}

async function stop(ctx) { await killChild(ctx.child); if (ctx.dir) await rm(ctx.dir, { recursive: true, force: true }); }

async function api(ctx, path, { method = 'GET', token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(`${ctx.base}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: r.status, json, text };
}

async function stateFile(ctx) { try { return JSON.parse(await readFile(join(ctx.dataDir, 'engines.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } }
function agentIds() { return ['charb', 'chara', 'charc']; }

async function makeLink(ctx, name, parts) {
  const made = await api(ctx, '/human/offers', { method: 'POST', body: { name, parts } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const link = made.json.link;
  return { link, token: link.slice(link.indexOf('#') + 1) };
}

test('A1 自主进酒吧喝菜单酒：只记自己、当轮带效果、turn 有状态', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const before = await stateFile(ctx);
  const home = await api(ctx, '/agent/home', { token: ctx.tokens.charb });
  assert.equal(home.status, 200);
  assert.ok((home.json.menu || []).length > 0, '菜单可见');
  const item = home.json.menu.find((m) => (m.name || m.claimedName) === '金汤力' || m.id === 'cup-金汤力');
  assert.ok(item, '金汤力在菜单');
  const drink = await api(ctx, `/agent/menu/${encodeURIComponent(item.id || item.name)}/drink`, { method: 'POST', token: ctx.tokens.charb });
  assert.equal(drink.status, 200, drink.text.slice(0, 300));
  assert.ok(drink.json.drink && drink.json.drink.actualEffectDescription, '当轮返回实际效果');
  assert.equal(typeof drink.json.revision, 'number');
  const after = await stateFile(ctx);
  assert.ok(after.charb.records.length > (before.charb?.records||[]).length, 'charb ledger +');
  assertAgentUnchanged(after, 'chara', before);
  assertAgentUnchanged(after, 'charc', before);
  // 状态可读与自动投递默认开启（无需手工 /agent/injection；后续有“总开关关闭”专项）
  const tc = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(tc.status, 200);
  assert.equal(tc.json.hasState, true, '有状态即可读');
  assert.equal(tc.json.active, true);
  assert.ok(tc.json.context && tc.json.context.text, 'context 可读');
  assert.equal(tc.json.injected, true, '自动投递默认开启');
  assert.ok(tc.json.block, '默认开时带 block');
});

test('B1 Link→CharB：CharB 记账、capability spent、他人/匿名均失败', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const before = await stateFile(ctx);
  const link = await makeLink(ctx, 'B1杯', [{ id: '威士忌', volume: 60 }]);
  const c = await api(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.tokens.charb, body: { capabilityToken: link.token } });
  assert.equal(c.status, 200, c.text.slice(0, 200));
  assert.equal(c.json.consumed, true, 'link 已被喝下');
  const after = await stateFile(ctx);
  assert.ok(after.charb.records.length > (before.charb?.records||[]).length);
  assertAgentUnchanged(after, 'chara', before);
  assertAgentUnchanged(after, 'charc', before);
  for (const who of ['chara', 'charc']) {
    const again = await api(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.tokens[who], body: { capabilityToken: link.token } });
    assert.equal(again.status, 409, `${who} 再喝应 409`);
  }
  const anon = await api(ctx, '/capability/offer', { token: link.token });
  assert.equal(anon.status, 410, '匿名再读 spent');
});

test('C1 Link→CharA：只写 CharA', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const before = await stateFile(ctx);
  const link = await makeLink(ctx, 'C1杯', [{ id: '金酒', volume: 45 }, { id: '汤力水', volume: 100 }]);
  const c = await api(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.tokens.chara, body: { capabilityToken: link.token } });
  assert.equal(c.status, 200);
  const after = await stateFile(ctx);
  assert.ok(after.chara.records.length > (before.chara?.records||[]).length);
  assertAgentUnchanged(after, 'charb', before);
  assertAgentUnchanged(after, 'charc', before);
});

async function busyEngineState() {
  const { ProofEngine } = await import('../../engine/src/index.js');
  const { realPack, menuItem } = await import('../../engine/src/content/realPack.js');
  const engine = new ProofEngine(null, realPack);
  const id = engine.createOffer(menuItem('金汤力'), 'user', 'user', 'charb', T0);
  const cup = engine.offers.get(id).cup;
  engine.applyMouth(cup, 0, T0);
  const st = engine.exportState();
  assert.ok(st.currentCup && st.currentCup.closed === false, 'fixture 应为未喝完状态');
  return st;
}

test('D1 喝不下不吞 Link：capability 保持 open，reset 后可继续喝', async (t) => {
  const busy = await busyEngineState();
  const dir = await mkdtemp(join(tmpdir(), 'proof-busy-'));
  await writeFile(join(dir, 'engines.json'), JSON.stringify({ charb: busy }));
  const ctx = await startServer({ PROOF_DATA_DIR: dir });
  if (!ctx.started) { await rm(dir, { recursive: true, force: true }); return t.skip('server_start_failed'); }
  t.after(async () => { await killChild(ctx.child); await rm(dir, { recursive: true, force: true }); });
  const link = await makeLink(ctx, 'D1杯', [{ id: '伏特加', volume: 60 }]);
  const before = await stateFile(ctx);
  const fail = await api(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.tokens.charb, body: { capabilityToken: link.token } });
  assert.equal(fail.status, 409, '忙态不得喝成');
  assert.equal(fail.json.error, 'cannot_drink_now');
  const mid = await stateFile(ctx);
  assert.deepEqual(mid.charb.records, before.charb.records, '失败不写 ledger');
  const open = await api(ctx, '/capability/offer', { token: link.token });
  assert.equal(open.status, 200, 'capability 保持 open');
  assert.equal(open.json.status, 'open');
  // Link 未被吞：另一个 Agent 仍可正常消费同一 Link（归属=实际喝下者）
  const ok = await api(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.tokens.chara, body: { capabilityToken: link.token } });
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
  assert.equal(ok.json.consumed, true);
});

test('F1 reset 后 turn-context 无状态；stateInjection 职责收窄为自动投递', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.charb });
  await api(ctx, '/agent/injection', { method: 'POST', token: ctx.tokens.charb, body: { enabled: true } });
  const on = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(on.json.hasState, true);
  assert.equal(on.json.injected, true);
  assert.ok(on.json.block, '许可开时有 block');
  // 关闭许可：状态仍可读，block 不再给（transport 不再自动投递）
  await api(ctx, '/agent/injection', { method: 'POST', token: ctx.tokens.charb, body: { enabled: false } });
  const off = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(off.json.hasState, true, '关许可不影响状态存在');
  assert.equal(off.json.injected, false);
  assert.equal(off.json.block, null);
  assert.ok(off.json.context, 'context 仍可读');
  // reset 清空
  const rs = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });
  assert.equal(rs.status, 200);
  const idle = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(idle.json.hasState, false);
  assert.equal(idle.json.active, false);
  assert.equal(idle.json.context, null);
});

test('I1 reset 清当前状态但保留 ledger/history/audit，下一杯可喝', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  await api(ctx, '/agent/menu/cup-长岛冰茶/drink', { method: 'POST', token: ctx.tokens.charb });
  const before = await stateFile(ctx);
  const rs = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });
  assert.equal(rs.status, 200);
  const after = await stateFile(ctx);
  assert.equal(after.charb.records.length, (before.charb?.records||[]).length, '历史记录保留');
  assert.equal(after.charb.cupsDrunk ?? 0, before.charb?.cupsDrunk ?? 0, '已喝杯数保留');
  assert.equal(Number(after.charb.c || 0), 0, '酒精清零');
  assert.ok(!(after.charb.currentCup && !after.charb.currentCup.closed), '当前杯清掉');
  const next = await api(ctx, '/agent/menu/cup-啤酒/drink', { method: 'POST', token: ctx.tokens.charb });
  assert.equal(next.status, 200, '下一杯可喝');
});

test('J1 CharB reset 不影响 CharA/CharC', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.charb });
  await api(ctx, '/agent/menu/cup-啤酒/drink', { method: 'POST', token: ctx.tokens.chara });
  const before = await stateFile(ctx);
  const rs = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });
  assert.equal(rs.status, 200);
  const after = await stateFile(ctx);
  assert.deepEqual(after.chara, before.chara, 'CharA 不受 CharB reset 影响');
  assert.deepEqual(after.charc, before.charc, 'CharC 不受影响');
});

test('K1 匿名 Link 回归：open→portable→spent，不写任何 Agent', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const before = await stateFile(ctx);
  const link = await makeLink(ctx, 'K1杯', [{ id: '金酒', volume: 45 }]);
  const open = await api(ctx, '/capability/offer', { token: link.token });
  assert.equal(open.status, 200);
  assert.deepEqual(Object.keys(open.json.projection).sort(), ['claimedName', 'color', 'cupType', 'intro'].sort());
  const drink = await api(ctx, '/capability/offer', { method: 'POST', token: link.token, body: { action: 'drink' } });
  assert.equal(drink.status, 200);
  assert.ok(drink.json.portableResult || drink.json.projection, '返回结果');
  const spent = await api(ctx, '/capability/offer', { token: link.token });
  assert.equal(spent.status, 410);
  const after = await stateFile(ctx);
  for (const id of agentIds()) assertAgentUnchanged(after, id, before);
});

test('ACT1 actives 经 Agent/MCP 路径单链路：无双入账、turn 反映、reset 清活性', async (t) => {
  const ctx = await startServer();
  if (!ctx.started) return t.skip('server_start_failed');
  t.after(() => stop(ctx));
  const before = await stateFile(ctx);
  const drink = await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.charb });
  assert.equal(drink.status, 200, drink.text.slice(0, 200));
  const after = await stateFile(ctx);
  const actives = Object.values(after.charb.actives || {});
  assert.ok(actives.some((a) => Number(a.amount || 0) > 0), '活性槽产生');
  // 单一入账：整杯只有一次 records 增加（无第二套结算翻倍）
  const drankBefore = (before.charb?.records || []).filter((r) => r.id && String(r.id).startsWith('drink-')).length;
  const drankAfter = after.charb.records.filter((r) => r.id && String(r.id).startsWith('drink-')).length;
  assert.equal(drankAfter - drankBefore, 1, '整杯只入账一次整杯喝下（无 double ingestion）');
  const tc = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(tc.json.hasState, true);
  const text = (tc.json.context && tc.json.context.text) || '';
  for (const banned of ['奎宁', '咖啡因', '半衰期', 'cap', '化合物', '糖分']) {
    assert.equal(text.includes(banned), false, `注入文本不得泄露 ${banned}`);
  }
  const rs = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });
  assert.equal(rs.status, 200);
  const clean = await stateFile(ctx);
  const remains = Object.values(clean.charb.actives || {}).filter((a) => Number(a.amount || 0) > 0);
  assert.equal(remains.length, 0, 'reset 清除当前活性状态');
});

// ---------- Reset 强制清当前杯 + 自动投递默认化（Follow-up 单）服务层 ----------

async function partialActiveState() {
  const { ProofEngine } = await import('../../engine/src/index.js');
  const { realPack, menuItem } = await import('../../engine/src/content/realPack.js');
  const engine = new ProofEngine(null, realPack);
  const at = Date.now() - 2000; // 贴近真实时钟：避免未完成杯在 server 内被“过期结算”干扰
  const id = engine.createOffer(menuItem('Espresso Martini'), 'user', 'user', 'charb', at);
  const cup = engine.offers.get(id).cup;
  const r = engine.applyMouth(cup, 0, at);
  assert.notEqual(r?.ok, false, r?.error || 'mouth applied');
  const st = engine.exportState();
  assert.ok(st.currentCup && st.currentCup.closed === false, 'fixture 应为未喝完');
  assert.ok(Object.keys(st.actives || {}).length > 0, 'fixture 应含活性存量');
  return st;
}

test('RS-1 忙态（未喝完 + 活性）+ 普通 reset：不再 409，丢弃剩余、活性清零、历史保留、可喝下一杯', async (t) => {
  const busy = await partialActiveState();
  const dir = await mkdtemp(join(tmpdir(), 'proof-rs1-'));
  await writeFile(join(dir, 'engines.json'), JSON.stringify({ charb: busy }));
  const ctx = await startServer({ PROOF_DATA_DIR: dir });
  if (!ctx.started) { await rm(dir, { recursive: true, force: true }); return t.skip('server_start_failed'); }
  t.after(async () => { await killChild(ctx.child); await rm(dir, { recursive: true, force: true }); });
  const recBefore = (await stateFile(ctx)).charb?.records || [];
  const rs = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });
  assert.equal(rs.status, 200, rs.text.slice(0, 200));
  const mid = await stateFile(ctx);
  assert.equal(mid.charb.c, 0, '酒精清零');
  assert.deepEqual(mid.charb.actives || {}, {}, '活性清零');
  assert.equal(mid.charb.records.length, recBefore.length, '已摄入历史保留');
  const drink = await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.charb });
  assert.equal(drink.status, 200, drink.text.slice(0, 200));
  assert.ok(drink.json.drink && drink.json.drink.actualEffectDescription, '下一杯当轮有效果');
  const tc = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(tc.json.hasState, true, '新杯状态正常产生');
  assert.equal(tc.json.injected, true, '自动投递默认开');
});

test('RS-2 服务重启后总开关持久化：显式关闭保持关闭', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-rs2-'));
  const ctx = await startServer({ PROOF_DATA_DIR: dir });
  if (!ctx.started) { await rm(dir, { recursive: true, force: true }); return t.skip('server_start_failed'); }
  await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.charb });
  const off = await api(ctx, '/agent/injection', { method: 'POST', token: ctx.tokens.charb, body: { enabled: false } });
  assert.equal(off.json.stateInjection, false);
  await killChild(ctx.child);
  // 同目录重启
  const ctx2 = await startServer({ PROOF_DATA_DIR: dir });
  if (!ctx2.started) return t.skip('restart_failed');
  t.after(async () => { await killChild(ctx2.child); await rm(dir, { recursive: true, force: true }); });
  const tc = await api(ctx2, '/agent/turn-context', { token: ctx2.tokens.charb });
  assert.equal(tc.json.hasState, true, '状态仍在（72h 内）');
  assert.equal(tc.json.injected, false, '重启后显式关闭保持（不擅自重开）');
  assert.ok(tc.json.context && tc.json.context.text, 'context 手动仍可读');
  // 显式关闭已持久化到引擎文件
  const saved = await stateFile(ctx2);
  assert.equal(saved.charb.stateInjection, false);
  assert.equal(saved.charb.stateInjectionConfigured, true);
});

test('RS-3 启动迁移：审计确认“最后一次注入=关”的存量 Agent 保持关；未配置的保持默认开', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-rs3-'));
  const { ProofEngine } = await import('../../engine/src/index.js');
  const { realPack } = await import('../../engine/src/content/realPack.js');
  const legacy = new ProofEngine(null, realPack).exportState();
  legacy.stateInjection = false;
  delete legacy.stateInjectionConfigured;
  const catalog = {
    drinks: [], proposals: [], visibility: {}, capabilities: [],
    audit: [{ actorType: 'agent', actorId: 'charb', targetId: 'charb', action: 'injection', result: false, time: T0 + 100 }]
  };
  await writeFile(join(dir, 'engines.json'), JSON.stringify({ charb: legacy, chara: new ProofEngine(null, realPack).exportState() }));
  await writeFile(join(dir, 'catalog.json'), JSON.stringify(catalog));
  const ctx = await startServer({ PROOF_DATA_DIR: dir });
  if (!ctx.started) { await rm(dir, { recursive: true, force: true }); return t.skip('server_start_failed'); }
  t.after(async () => { await killChild(ctx.child); await rm(dir, { recursive: true, force: true }); });
  const saved = await stateFile(ctx);
  assert.equal(saved.charb.stateInjection, false, '显式关过的 charb 迁移后保持关');
  assert.equal(saved.charb.stateInjectionConfigured, true, '回填 configured=true');
  // charb 喝酒后 turn-context：有状态但不再自动投递；chara（无审计）默认开
  await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.charb });
  const charbTc = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(charbTc.json.hasState, true);
  assert.equal(charbTc.json.injected, false, '显式关保持不自动投递');
  await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.tokens.chara });
  const charaTc = await api(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
  assert.equal(charaTc.json.hasState, true);
  assert.equal(charaTc.json.injected, true, '未配置 Agent 保持新默认：开');
});
