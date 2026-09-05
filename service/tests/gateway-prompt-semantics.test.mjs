// G-P1 ～ G-P6：Gateway 接入 Agent-facing 状态语义与正向宿主契约。
// 针对 Gateway 新增的 Proof context block / metadata，不粗暴全 request 禁词。

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProofEngine } from '../../engine/src/engine/ProofEngine.js';
import { realPack, menuItem, buildFromParts } from '../../engine/src/content/realPack.js';
import { STATE_FRAME_NOTE } from '../../engine/src/core/injection.js';
import { AGENT_STATE_USE_POLICY } from '../../engine/src/runtime/agentStateUsePolicy.js';
import { buildAgentTurnContext } from '../../engine/src/runtime/agentTurnContext.js';
import { createGateway } from '../gateway/index.mjs';
import { handleModelEndpoint } from '../gateway/handler.mjs';
import { makeTempDir, removeTempDir, createClock } from './lib/gatewayEnv.mjs';

const H = 3600000;
const T0 = Date.UTC(2026, 8, 4, 15, 0, 0);
const SECRET = 'BLACKOUT_SECRET_GP4';
const STATE_LABEL = '[Proof 状态]';
const RECOVERY_LABEL = '[Proof 恢复片段]';
const AXIS_NAMES = ['愉悦', '唤醒', '精度', '亲近', '守门', '欲望'];
const SCRIPT_BANS = [
  '话要更多', '话要更少', '句子变长', '句子变短',
  '必须主动靠近', '必须叫对方名字', '固定停顿', '你现在必须说话'
];

async function startFakeUpstream() {
  const state = { calls: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    state.calls.push({ headers: { ...req.headers }, rawText: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'r_1', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好。' }] }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { state, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function build(opts = {}) {
  const dir = opts.dir ?? await makeTempDir('gw-gp-');
  const clock = opts.clock ?? createClock(T0);
  const engines = opts.engines ?? new Map([['charb', new ProofEngine(null, realPack, { disableHiddenDraw: true })]]);
  const fake = opts.fake ?? await startFakeUpstream();
  const gateway = createGateway({
    getEngine: (id) => engines.get(id) || null,
    dataDir: dir,
    now: clock.now,
    env: { PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1', PROOF_OPENAI_BASE_URL: fake.url, PROOF_GATEWAY_ENABLED: '1' }
  });
  await gateway.identity.ensure('charb');
  const key = (await readFile(join(dir, 'charb.gateway-token'), 'utf8')).trim();
  const srv = http.createServer(async (req, res) => {
    const agentId = await gateway.identity.agentIdForToken(req.headers['x-proof-gateway-key']);
    if (!agentId) { res.writeHead(401); res.end('{}'); return; }
    if (!gateway.concurrency.tryAcquire()) { res.writeHead(429); res.end('{}'); return; }
    const release = () => gateway.concurrency.release();
    res.once('finish', release);
    res.once('close', release);
    try { await handleModelEndpoint({ gateway, req, res, pathname: req.url, agentId }); } catch { if (!res.writableEnded) { res.writeHead(500); res.end('{}'); } }
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const base = `http://127.0.0.1:${srv.address().port}`;
  const request = async (payload, conv) => {
    const r = await fetch(`${base}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-proof-gateway-key': key, 'x-proof-conversation-id': conv },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, json, text };
  };
  return {
    gateway, clock, dir, fake, key, request,
    engine: () => engines.get('charb'),
    ledgerRaw: () => readFile(join(dir, 'gateway-ledger.json'), 'utf8').catch(() => ''),
    stop: async () => {
      srv.close();
      if (!opts.fake) await fake.close();
      if (!opts.dir) await removeTempDir(dir);
    }
  };
}

function msg(text) {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] };
}
function lastSent(h) {
  return JSON.parse(h.fake.state.calls.at(-1).rawText);
}
function tailSlot(sent) {
  if (typeof sent.instructions === 'string') return sent.instructions;
  if (typeof sent.system === 'string') return sent.system;
  return '';
}
function proofStateBlock(sent) {
  const slot = tailSlot(sent);
  const idx = slot.indexOf(STATE_LABEL);
  if (idx < 0) return '';
  const rest = slot.slice(idx);
  const rec = rest.indexOf(RECOVERY_LABEL, STATE_LABEL.length);
  return rec >= 0 ? rest.slice(0, rec).trim() : rest.trim();
}
function recoveryBlock(sent) {
  const slot = tailSlot(sent);
  const idx = slot.indexOf(RECOVERY_LABEL);
  if (idx < 0) return '';
  const rest = slot.slice(idx);
  const st = rest.indexOf(STATE_LABEL, RECOVERY_LABEL.length);
  return st >= 0 ? rest.slice(0, st).trim() : rest.trim();
}
function countNeedle(hay, needle) {
  if (!needle) return 0;
  return hay.split(needle).length - 1;
}

function drinkMenu(engine, name, at) {
  const id = engine.createOffer(menuItem(name), 'user', 'user', 'charb', at);
  return engine.drinkOffer(id, 'charb', `r-${name}-${at}`, at);
}

test('G-P1 Agent context 不泄六轴诊断（只扫 Gateway 新增 Proof 状态块）', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(true);
    drinkMenu(h.engine(), '威士忌', T0);
    await h.request({ model: 'm', input: [msg('用户本来就会说唤醒这个词')] }, 'gp1');
    const sent = lastSent(h);
    const state = proofStateBlock(sent);
    assert.ok(state.startsWith(STATE_LABEL), '有动态状态块');
    for (const axis of AXIS_NAMES) {
      assert.equal(state.includes(axis), false, `状态块不得出现轴名 ${axis}；用户历史可以`);
    }
    assert.ok(JSON.stringify(sent.input).includes('唤醒'), '输入正文不受禁词误伤');
    assert.equal(/[+\-]/.test(state), false, '状态块不得带 +/- 诊断');
    assert.equal(/\b(low|mid|high|tier|axis)\b/i.test(state), false);
    assert.equal(/\d/.test(state), false, '状态块不得写精确内部值');
    assert.equal(state.includes('claimedEffects'), false);
    assert.equal(state.includes('actualEffectDescription'), false);
  } finally {
    await h.stop();
  }
});

test('G-P2 不泄人类文学 effect copy；人类结果页仍保留', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(true);
    const drunk = drinkMenu(h.engine(), '威士忌', T0);
    const literary = drunk.projection.actualEffectDescription?.text || '';
    assert.ok(literary.length > 8, '人类投影仍有文学正文');
    await h.request({ model: 'm', input: [msg('今晚如何')] }, 'gp2');
    const sent = lastSent(h);
    const state = proofStateBlock(sent);
    assert.ok(state.startsWith(STATE_LABEL));
    assert.equal(state.includes(literary), false, '[Proof 状态] 不得含文学效果正文');
    assert.equal(tailSlot(sent).includes(literary), false, 'Gateway 不得从 human projection 把文学正文捞回宿主层');
  } finally {
    await h.stop();
  }
});

test('G-P3 正向 host policy 固定且只出现一次', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(true);
    drinkMenu(h.engine(), '威士忌', T0);
    await h.request({ model: 'm', input: [msg('第一轮')] }, 'gp3');
    const first = lastSent(h);
    const slotA = tailSlot(first);
    assert.equal(countNeedle(slotA, AGENT_STATE_USE_POLICY), 1, '第一轮只有一份 host policy');
    assert.ok(slotA.includes('{{user}}'), '{{user}} 保持占位符');
    assert.equal(slotA.includes('用户询问'), false);
    const policyA = AGENT_STATE_USE_POLICY;
    assert.ok(slotA.includes(policyA));
    assert.equal(proofStateBlock(first).includes(AGENT_STATE_USE_POLICY), false, 'policy 不进 [Proof 状态]');

    h.clock.set(T0 + 3 * H);
    drinkMenu(h.engine(), '金汤力', T0 + 3 * H);
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: [msg('第二轮')] }, 'gp3');
    const second = lastSent(h);
    const slotB = tailSlot(second);
    assert.equal(countNeedle(slotB, AGENT_STATE_USE_POLICY), 1, '第二轮仍然只有一份');
    assert.equal(slotB.includes(policyA), true, 'policy 逐字不变');
    assert.notEqual(proofStateBlock(first), proofStateBlock(second), '动态 [Proof 状态] 可以变化');
  } finally {
    await h.stop();
  }
});

test('G-P4 injection off 不偷偷送状态，但 blackout / recovery 仍工作', async () => {
  const h = await build();
  try {
    const eng = h.engine();
    eng.setStateInjection(true);
    drinkMenu(eng, '威士忌', T0);
    eng.setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    eng.state.fragmentBatches.push({
      id: 'f-gp4', readable: false, hiddenFrom: T0 - H, end: T0 + H, restoreAt
    });
    const conv = 'gp4';
    const secretMsg = `我的秘密是 ${SECRET}`;
    await h.request({ model: 'm', input: [msg(secretMsg)] }, conv);

    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: [msg(secretMsg), msg('现在呢')] }, conv);
    const during = lastSent(h);
    const duringAll = `${JSON.stringify(h.fake.state.calls.at(-1).headers)}\n${JSON.stringify(during)}`;
    assert.equal(duringAll.includes(STATE_LABEL), false, '关闭自动投递后不得出现 [Proof 状态]');
    assert.equal(duringAll.includes(AGENT_STATE_USE_POLICY), false, 'injection off 不投动态状态，也不夹带 policy 当状态');
    const ctxHints = ['舒服、轻快', '精神和注意', '处理细节和临场判断'];
    const offSlot = tailSlot(during);
    for (const needle of ctxHints) {
      assert.equal(offSlot.includes(needle), false, `injection off 不得送 stateHints：${needle}`);
    }
    assert.equal(duringAll.includes(SECRET), false, 'blackout 仍过滤 hidden transcript');

    h.clock.set(restoreAt + 1);
    eng.settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: [msg(secretMsg), msg('现在呢')] }, conv);
    const after = lastSent(h);
    const afterAll = JSON.stringify(after);
    assert.equal(afterAll.includes(STATE_LABEL), false, '恢复后仍不自动投 [Proof 状态]');
    assert.ok(tailSlot(after).includes(RECOVERY_LABEL), '已到点的恢复块仍按 recovery 规则工作');
    assert.ok(tailSlot(after).includes(SECRET), 'raw 仍在时恢复块可取回原文');
    assert.equal(JSON.stringify(after.input ?? []).includes(SECRET), false, '不原位回填');
  } finally {
    await h.stop();
  }
});

test('G-P5 三层不混线', async () => {
  const h = await build();
  try {
    const eng = h.engine();
    eng.setStateInjection(true);
    // 200ml 伏特加 ≈ 6.3 杯：一小时后体内仍有状态，可与恢复块同屏。
    eng.sipAll(buildFromParts('测试杯', [{ id: '伏特加', volume: 200 }], { id: 'cup-gp5', kind: 'custom', listed: false, totalMouths: 2 }), T0);
    const restoreAt = T0 + H;
    eng.state.fragmentBatches.push({
      id: 'f-gp5', readable: false, hiddenFrom: T0 - H, end: T0 + H, restoreAt
    });
    const conv = 'gp5';
    const token = 'GP5_RECOVERY_TOKEN';
    await h.request({ model: 'm', input: [msg(token)] }, conv);
    await h.request({ model: 'm', input: [msg(token), msg('继续')] }, conv);
    h.clock.set(restoreAt + 1);
    eng.settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: [msg(token), msg('继续')] }, conv);
    const sent = lastSent(h);
    const slot = tailSlot(sent);
    assert.ok(slot.includes(AGENT_STATE_USE_POLICY), '有稳定 host policy');
    assert.ok(slot.includes(STATE_LABEL), '有当前 Proof state');
    assert.ok(slot.includes(RECOVERY_LABEL), '有 eligible recovery');
    assert.equal(countNeedle(slot, AGENT_STATE_USE_POLICY), 1);
    assert.equal(countNeedle(slot, STATE_LABEL), 1);
    const state = proofStateBlock(sent);
    const recovery = recoveryBlock(sent);
    assert.equal(state.includes(AGENT_STATE_USE_POLICY), false, 'policy 不进状态块');
    assert.equal(state.includes(RECOVERY_LABEL), false, 'recovery 不进状态块');
    assert.equal(state.includes(token), false, '恢复正文不进状态块');
    assert.equal(recovery.includes(AGENT_STATE_USE_POLICY), false, 'policy 不进恢复块');
    assert.equal(recovery.includes(STATE_LABEL), false, '状态块不进恢复块');
    assert.ok(recovery.includes(token), '恢复块只承载记忆恢复');
    const policyIdx = slot.indexOf(AGENT_STATE_USE_POLICY);
    const recIdx = slot.indexOf(RECOVERY_LABEL);
    const stIdx = slot.indexOf(STATE_LABEL);
    assert.ok(policyIdx >= 0 && recIdx > policyIdx && stIdx > recIdx, '顺序：policy → recovery → state');

    const ledger = JSON.parse(await h.ledgerRaw());
    const rec = Object.values(ledger.conversations).find((c) => c.conversationId === conv);
    const markers = rec?.recoveries ?? [];
    assert.ok(markers.length >= 1);
    const rawLedger = await h.ledgerRaw();
    assert.equal(rawLedger.includes(AGENT_STATE_USE_POLICY), false, 'state policy 不被 ledger 记录');
    for (const hint of (eng.currentInjection(h.clock.now())?.stateHints || [])) {
      assert.equal(rawLedger.includes(hint), false, 'stateHints 不被 ledger 记录');
    }
  } finally {
    await h.stop();
  }
});

test('G-P6 具体表现由 Agent 决定：注入文本无硬编码行为脚本', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(true);
    drinkMenu(h.engine(), '威士忌', T0);
    await h.request({ model: 'm', input: [msg('说句话')] }, 'gp6');
    const slot = tailSlot(lastSent(h));
    const injected = `${AGENT_STATE_USE_POLICY}\n${proofStateBlock(lastSent(h))}`;
    for (const banned of SCRIPT_BANS) {
      assert.equal(injected.includes(banned), false, banned);
      assert.equal(slot.includes(banned), false, `slot:${banned}`);
    }
  } finally {
    await h.stop();
  }
});

test('MERGE-1 stable host policy 与 STATE_FRAME_NOTE 是两个独立常量', () => {
  assert.notEqual(AGENT_STATE_USE_POLICY, STATE_FRAME_NOTE);
  assert.ok(AGENT_STATE_USE_POLICY.includes('{{user}}'));
  assert.equal(STATE_FRAME_NOTE.includes('{{user}}'), false, 'soft-push framing 不承担宿主使用契约');
  assert.equal(AGENT_STATE_USE_POLICY.includes('以下不是台词'), false);
  assert.ok(STATE_FRAME_NOTE.includes('从里面推了你一下'), 'soft-push framing 保持 canonical 的内在推动语义');
  const policyMut = `${AGENT_STATE_USE_POLICY}X`;
  assert.equal(STATE_FRAME_NOTE.includes('X'), false);
  assert.notEqual(policyMut, STATE_FRAME_NOTE);
});

test('MERGE-2 Gateway 状态块与 canonical buildAgentTurnContext 一致', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(true);
    drinkMenu(h.engine(), '威士忌', T0);
    await h.request({ model: 'm', input: [msg('核对同源')] }, 'merge2');
    const sent = lastSent(h);
    const fromGateway = proofStateBlock(sent);
    const canonical = buildAgentTurnContext(h.engine(), 'charb', h.clock.now());
    assert.equal(fromGateway, canonical.block.text, '不得存在第二套 stateHints 算法');
    assert.equal(canonical.context.text, canonical.block.text);
    assert.ok(canonical.stateHints.length > 0, 'canonical context 同时返回语义 hints');
    assert.equal(fromGateway.includes(AGENT_STATE_USE_POLICY), false);
    assert.equal(fromGateway.includes(STATE_FRAME_NOTE), false);
    assert.equal('effects' in canonical, false, 'Agent-facing 不回退六轴诊断表');
  } finally {
    await h.stop();
  }
});
