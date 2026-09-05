// 真实断片遮蔽与恢复源选择 —— 专项测试（用户设计）。
//
// 本单契约：
//   · 遮蔽 = 真实 context visibility，hidden fragment 从最终 request 完全移除；
//   · 恢复 = append-only 尾部追加，[Proof 恢复片段]；
//   · 恢复源选择：原始 hidden transcript 仍在 → 逐字恢复（受 Proof 可见度裁剪）；
//     已被 compression 移除 → 退化为 Proof records / digest 的低分辨率事实；
//   · 原文存在 ≠ 一定全部恢复：Proof 的 resolution/ratio/stages 决定可恢复范围；
//   · Gateway 账本零正文持久化，只记 (fragmentId, stage) 发射标记。
//
// 关键前提：被遮消息必须在早前某轮以“尾部”经网关登记过（firstSeenAt 落入窗口），后续才可命中遮蔽。
// 假时钟 + 进程内网关 + 真实 HTTP + 本地假上游；live-runtime E2E 不在本文件（诚实标注）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProofEngine } from '../../engine/src/engine/ProofEngine.js';
import { realPack } from '../../engine/src/content/realPack.js';
import { createGateway } from '../gateway/index.mjs';
import { handleModelEndpoint } from '../gateway/handler.mjs';
import { applyPlan } from '../gateway/adapters.mjs';
import { transformGatewayRequest, selectRecoverySource, fragmentCandidates } from '../gateway/transform.mjs';
import { createLedger } from '../gateway/ledger.mjs';
import { makeTempDir, removeTempDir, createClock } from './lib/gatewayEnv.mjs';

const H = 3600000;
const T0 = Date.UTC(2026, 8, 2, 15, 0, 0);
const SECRET = 'BLACKOUT_SECRET_7F31';
const LABEL = '[Proof 恢复片段]';

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

/**
 * 起一套进程内网关 + HTTP 服务。
 * respawn() 复用同一个 dataDir / clock / engine，用于「Gateway restart」场景。
 */
async function build(opts = {}) {
  const dir = opts.dir ?? await makeTempDir('gw-br-');
  const clock = opts.clock ?? createClock(T0);
  const engines = opts.engines ?? new Map([['charb', new ProofEngine(null, realPack)]]);
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
  const engine = () => engines.get('charb');
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
  const ledgerRaw = () => readFile(join(dir, 'gateway-ledger.json'), 'utf8').catch(() => '');
  const handle = {
    gateway, engine, clock, dir, fake, base, key, request, ledgerRaw,
    respawn: () => build({ dir, clock, engines, fake }),
    stop: async () => {
      srv.close();
      if (!opts.fake) await fake.close();
      if (!opts.dir) await removeTempDir(dir);
    }
  };
  return handle;
}

function msg(text) {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] };
}
function inputOf(...texts) {
  return texts.map(msg);
}

// ---------------- 断言工具 ----------------

function lastCall(h) {
  return h.fake.state.calls.at(-1);
}
function lastSent(h) {
  return JSON.parse(lastCall(h).rawText);
}

/**
 * 最终 request 的**全部可序列化文本**：headers + 整个 body。
 * 不只是 messages——隐蔽泄漏（debug / metadata / injection 字段）也一并覆盖。
 */
function scanAll(sent, h = null) {
  const body = JSON.stringify(sent);
  if (!h) return body;
  return `${JSON.stringify(lastCall(h).headers)}\n${body}`;
}
/** 模型实际看到的「消息/历史」槽。 */
function historyText(sent) {
  return JSON.stringify(sent.input ?? sent.messages ?? []);
}
/** 恢复块 / 状态注入所在的尾部槽。 */
function tailSlotText(sent) {
  const slot = typeof sent.instructions === 'string' ? sent.instructions
    : (typeof sent.system === 'string' ? sent.system : '');
  return slot;
}
/** 把尾部槽按恢复标签切开，返回每个恢复块的正文（顺序稳定）。 */
function recoveryBlocksOf(sent) {
  const slot = tailSlotText(sent);
  return slot.split(LABEL).slice(1).map((part) => part.trim());
}
function countLabel(haystack) {
  return (haystack.match(/\[Proof 恢复片段\]/g) || []).length;
}
async function ledgerMarkers(h, conv) {
  const ledger = JSON.parse(await h.ledgerRaw());
  const rec = Object.values(ledger.conversations).find((c) => c.conversationId === conv);
  return rec?.recoveries ?? [];
}

/** 常用片段：默认软断片（mode 缺省 → soft → full）。 */
function pushFragment(engine, { id, hiddenFrom, end, restoreAt, recovery = null }) {
  const batch = { id, readable: false, hiddenFrom, end, restoreAt };
  if (recovery) batch.recovery = recovery;
  engine.state.fragmentBatches.push(batch);
  return batch;
}

// ---------------- 遮蔽（既有契约，本单不得退化） ----------------

test('BR-1 真实遮蔽：secret 在断片轮完全不可见（全 request 扫描）', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    pushFragment(h.engine(), { id: 'f-br1', hiddenFrom: T0 - H, end: T0 + H, restoreAt: T0 + 60 * H });
    const conv = 'br1';
    await h.request({ model: 'm', input: inputOf(`我的秘密是 ${SECRET}`) }, conv);
    h.fake.state.calls.length = 0;
    const second = await h.request({ model: 'm', input: inputOf(`我的秘密是 ${SECRET}`, '现在呢') }, conv);
    assert.equal(second.status, 200);
    const sent = lastSent(h);
    assert.equal(scanAll(sent, h).includes(SECRET), false, 'secret 不得进入最终模型请求的任何字段（headers+body 全扫）');
    assert.ok(!scanAll(sent).includes('[Proof 断片]'), '无原位占位');
    assert.ok(historyText(sent).includes('现在呢'), '当前轮可见');
  } finally {
    await h.stop();
  }
});

test('BR-2 持续遮蔽字节稳定：时间推进下遮蔽结果逐字不变', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    pushFragment(h.engine(), { id: 'f-br2', hiddenFrom: T0 - H, end: T0 + 24 * H, restoreAt: T0 + 60 * H });
    const conv = 'br2';
    await h.request({ model: 'm', input: inputOf(`${SECRET} 部分`) }, conv);
    const payload = () => ({ model: 'm', input: inputOf(`${SECRET} 部分`, '同文尾') });
    await h.request(payload(), conv);
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const bodyA = h.fake.state.calls.at(-1).rawText;
    assert.equal(bodyA.includes(SECRET), false, '遮蔽生效');
    h.clock.set(h.clock.now() + 5 * H);
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const bodyB = h.fake.state.calls.at(-1).rawText;
    assert.equal(bodyA, bodyB, '持续遮蔽逐字节稳定（无动态倒计时/占位改写）');
  } finally {
    await h.stop();
  }
});

test('BR-3 恢复 append-only：到点后原文不回填原位、恢复块只追加一次', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    pushFragment(h.engine(), { id: 'f-br3', hiddenFrom: T0 - H, end: T0 + H, restoreAt });
    const conv = 'br3';
    await h.request({ model: 'm', input: inputOf(`${SECRET} 阶段一`) }, conv);
    const payload = () => ({ model: 'm', input: inputOf(`${SECRET} 阶段一`, '继续吗') });
    await h.request(payload(), conv);
    h.clock.set(restoreAt + 1000);
    h.engine().settle(h.clock.now());
    await h.request(payload(), conv);
    const sent = lastSent(h);
    assert.equal(historyText(sent).includes(SECRET), false, '原文不回填原位（消息槽中没有 secret）');
    assert.ok(tailSlotText(sent).includes(LABEL), '恢复以尾部追加块给出');
    assert.ok(historyText(sent).includes('继续吗'), '可见历史照常');
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const sent2 = lastSent(h);
    assert.equal(countLabel(scanAll(sent2)), 1, '恢复块不重复追加');
    assert.equal(scanAll(sent), scanAll(sent2), '恢复后逐轮字节稳定（旧块不被改写）');
  } finally {
    await h.stop();
  }
});

test('BR-4 渐进恢复：两个批次按恢复点各自追加为独立稳定块', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const early = T0 + 60 * H;
    const late = T0 + 120 * H;
    pushFragment(h.engine(), { id: 'f-br4-a', hiddenFrom: T0 - 2 * H, end: T0 - H, restoreAt: early });
    pushFragment(h.engine(), { id: 'f-br4-b', hiddenFrom: T0 + H, end: T0 + 2 * H, restoreAt: late });
    const conv = 'br4';
    h.clock.set(T0 - 2 * H + 1000);
    await h.request({ model: 'm', input: inputOf('甲批甲') }, conv);
    h.clock.set(T0 + H + 1000);
    await h.request({ model: 'm', input: inputOf('乙批乙') }, conv);
    const payload = () => ({ model: 'm', input: inputOf('甲批甲', '乙批乙', '现在如何') });
    await h.request(payload(), conv);

    h.clock.set(early + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const c1 = lastSent(h);
    assert.equal(countLabel(scanAll(c1)), 1, '第一批恢复先到');
    assert.equal(historyText(c1).includes('甲批甲'), false, '原文仍不回填原位');
    assert.ok(tailSlotText(c1).includes('甲批甲'), '第一批以追加块恢复');
    assert.equal(tailSlotText(c1).includes('乙批乙'), false, '第二批尚未到点，不提前恢复');

    h.clock.set(late + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const c2 = lastSent(h);
    assert.equal(countLabel(scanAll(c2)), 2, '两批各自独立恢复块');
    const blocks = recoveryBlocksOf(c2);
    assert.equal(historyText(c2).includes('乙批乙'), false, '原文不回填原位');
    assert.ok(blocks[0].includes('甲批甲'), '第一块仍是甲（未被改写）');
    assert.ok(blocks[1].includes('乙批乙'), '第二块是乙（append-only）');
  } finally {
    await h.stop();
  }
});

test('BR-5 恢复账本零正文：只存发射标记，正文/digest 之外不留任何 transcript', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    pushFragment(h.engine(), { id: 'f-br5', hiddenFrom: T0 - H, end: T0 + H, restoreAt });
    const conv = 'br5';
    await h.request({ model: 'm', input: inputOf(`${SECRET} 记得吗`) }, conv);
    const payload = () => ({ model: 'm', input: inputOf(`${SECRET} 记得吗`, '再来') });
    await h.request(payload(), conv);
    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    await h.request(payload(), conv);

    const raw = await h.ledgerRaw();
    assert.equal(raw.includes(SECRET), false, '账本全文不含 secret');
    const markers = await ledgerMarkers(h, conv);
    assert.equal(markers.length, 1, '恢复标记已持久化');
    assert.equal(markers[0].key, 'f-br5#1');
    assert.equal(markers[0].source, 'raw', '原文仍在 → 以 raw 源发射');
    assert.equal(markers[0].text, undefined, '账本不存正文');
    assert.equal(Object.prototype.hasOwnProperty.call(markers[0], 'text'), false, '连 text 字段都不存在');
    assert.ok(markers[0].digest && /^[a-f0-9]{64}$/.test(markers[0].digest), '只留渲染结果的 sha256 指纹');
    assert.equal(markers[0].count, 1, '恢复条数作为元数据保留');

    // “重启”：同 dir 新开 ledger 读者读同一标记（不重复）
    const ledger2 = createLedger({ dataDir: h.dir, now: () => h.clock.now() });
    const stack = await ledger2.recoveries('charb', conv);
    assert.equal(stack.length, 1);
    assert.equal(stack[0].key, 'f-br5#1');
  } finally {
    await h.stop();
  }
});

test('BR-6 遮蔽后可见历史不含隐藏内容（transform 级）', async () => {
  const dir = await makeTempDir('gw-br6-');
  try {
    const clock = createClock(T0);
    const ledger = createLedger({ dataDir: dir, now: clock.now });
    const engine = new ProofEngine(null, realPack);
    engine.setStateInjection(false);
    pushFragment(engine, { id: 'f-br6', hiddenFrom: T0 - H, end: T0 + H, restoreAt: T0 + 60 * H });
    await ledger.register('charb', 'c6', { role: 'user', content: `${SECRET} 内容`, at: T0 });
    const messages = [
      { role: 'user', content: `${SECRET} 内容` },
      { role: 'user', content: '现在' }
    ];
    const res = await transformGatewayRequest({ engine, agentId: 'charb', now: T0 + 1000, messages, conversationId: 'c6', ledger, requestId: 'br6' });
    const filtered = applyPlan(messages, res.plan);
    const visible = filtered.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    assert.equal(visible.includes(SECRET), false, '遮蔽后的可见内容不含 secret');
    assert.equal(res.recoveryText, null, '断片未到点，无任何恢复块（含 transform 结果也不夹带原文）');
  } finally {
    await removeTempDir(dir);
  }
});

// ---------------- BR-7A / BR-7B：secret 契约拆分 ----------------

test('BR-7A 无压缩时真实恢复：secret 断片期全不可见，到点后在恢复块中回来', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    pushFragment(h.engine(), { id: 'f-br7a', hiddenFrom: T0 - H, end: T0 + H, restoreAt });
    const conv = 'br7a';
    const secretMsg = `我的秘密是 ${SECRET}`;
    await h.request({ model: 'm', input: inputOf(secretMsg) }, conv);

    // 断片期：全 request 扫描
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: inputOf(secretMsg, '现在') }, conv);
    const during = lastSent(h);
    assert.equal(scanAll(during, h).includes(SECRET), false, '断片期：secret 不出现在最终 request 的任何字段（headers+body 全扫）');
    assert.equal(historyText(during).includes(SECRET), false, '断片期：消息槽不可见');
    assert.equal(tailSlotText(during).includes(SECRET), false, '断片期：状态/恢复槽也不可见');

    // 到点恢复：raw transcript 仍在 → 真实恢复
    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: inputOf(secretMsg, '现在') }, conv);
    const after = lastSent(h);
    assert.equal(historyText(after).includes(SECRET), false, '恢复后：原位仍不回填');
    assert.ok(tailSlotText(after).includes(LABEL), '恢复块已追加');
    assert.ok(tailSlotText(after).includes(SECRET), 'secret 在 [Proof 恢复片段] 中重新出现');
    const occurrences = scanAll(after, h).split(SECRET).length - 1;
    assert.equal(occurrences, 1, 'secret 只以恢复块形式出现一次，无原位 + 恢复双份');
  } finally {
    await h.stop();
  }
});

test('BR-7B 压缩后只能低分辨率恢复：secret 不得凭空重现，只给 Proof 事实', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    h.engine().state.drinkEvents.push({ eventId: 'ev-b', cupId: 'cup-b', consumedAt: T0 + 1000, standardDrinks: 2 });
    h.engine().state.records.push({ id: 'drink-b', type: '喝下', time: T0 + 1000, drunk: true });
    pushFragment(h.engine(), { id: 'f-br7b', hiddenFrom: T0 - H, end: T0 + H, restoreAt });
    const conv = 'br7b';
    const secretMsg = `我的秘密是 ${SECRET}`;
    await h.request({ model: 'm', input: inputOf(secretMsg) }, conv);

    // 断片期：compression 输入 = 已过滤的可见历史，看不到 secret
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: inputOf(secretMsg, '现在') }, conv);
    const during = lastSent(h);
    assert.equal(scanAll(during, h).includes(SECRET), false, '断片期：compression 输入看不到 secret');

    // 到点：宿主已把旧 raw transcript 压缩掉，只回传摘要
    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: inputOf('（更早的对话已被压缩为摘要）', '继续') }, conv);
    const after = lastSent(h);
    assert.equal(scanAll(after, h).includes(SECRET), false, 'secret 不得凭空重新出现');
    assert.ok(tailSlotText(after).includes(LABEL), '恢复块仍然给出');
    assert.ok(tailSlotText(after).includes('1 杯'), `只给 Proof 记录里真实存在的事实: ${tailSlotText(after).slice(0, 300)}`);
    const markers = await ledgerMarkers(h, conv);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].source, 'proof', '原始 transcript 已不在 → 退化为 Proof 源');
    const ledgerText = await h.ledgerRaw();
    assert.equal(ledgerText.includes(SECRET), false, '账本零正文');
  } finally {
    await h.stop();
  }
});

// ---------------- R-A / R-B / R-C / R-D ----------------

test('R-A 完整恢复：无压缩时从 raw transcript 逐字恢复（source=raw）', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    pushFragment(h.engine(), { id: 'f-ra', hiddenFrom: T0 - H, end: T0 + H, restoreAt });
    const conv = 'ra';
    const tokenA = 'RAW_RECOVER_TOKEN_A1';
    await h.request({ model: 'm', input: inputOf(tokenA) }, conv);
    const payload = () => ({ model: 'm', input: inputOf(tokenA, '现在') });

    await h.request(payload(), conv);
    const during = lastSent(h);
    assert.equal(scanAll(during, h).includes(tokenA), false, '断片期：原文不可见');

    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const after = lastSent(h);
    assert.equal(historyText(after).includes(tokenA), false, '不原位回填');
    const blocks = recoveryBlocksOf(after);
    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].includes(tokenA), '完整恢复：原始片段回到 [Proof 恢复片段]');
    const markers = await ledgerMarkers(h, conv);
    assert.equal(markers[0].source, 'raw');
    assert.equal(markers[0].count, 1);
    assert.equal((await h.ledgerRaw()).includes(tokenA), false, 'Gateway 不保存正文');
  } finally {
    await h.stop();
  }
});

test('R-B 降质恢复：压缩移除 raw 后只给 Proof 事实（source=proof，不伪造原文）', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    h.engine().state.drinkEvents.push({ eventId: 'ev-rb', cupId: 'cup-rb', consumedAt: T0 + 2000, standardDrinks: 3 });
    h.engine().state.records.push({ id: 'drink-rb', type: '喝下', time: T0 + 2000, drunk: true });
    pushFragment(h.engine(), { id: 'f-rb', hiddenFrom: T0 - H, end: T0 + H, restoreAt });
    const conv = 'rb';
    const tokenB = 'RAW_RECOVER_TOKEN_B1';
    await h.request({ model: 'm', input: inputOf(tokenB) }, conv);
    await h.request({ model: 'm', input: inputOf(tokenB, '现在') }, conv);

    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    // 压缩后的 candidate history：旧 raw transcript 已不在
    await h.request({ model: 'm', input: inputOf('（摘要：聊过一些事）', '继续') }, conv);
    const after = lastSent(h);
    assert.equal(scanAll(after, h).includes(tokenB), false, '不得伪造/重建已不存在的逐字原文');
    const blocks = recoveryBlocksOf(after);
    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].includes('1 杯'), '只给 Proof 记录中真实存在的事实');
    const markers = await ledgerMarkers(h, conv);
    assert.equal(markers[0].source, 'proof');
    assert.equal(markers[0].count, 0);
  } finally {
    await h.stop();
  }
});

test('R-C 渐进完整恢复：raw 仍在时 stage1=A、stage2=B，A 不被改写', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    pushFragment(h.engine(), {
      id: 'f-rc', hiddenFrom: T0 - H, end: T0 + H, restoreAt,
      recovery: { resolution: 'full', stages: 2 }
    });
    const conv = 'rc';
    const partA = '渐进片段甲';
    const partB = '渐进片段乙';
    await h.request({ model: 'm', input: inputOf(partA) }, conv);            // A @ T0
    h.clock.set(T0 + 1000);
    await h.request({ model: 'm', input: inputOf(partA, partB) }, conv);      // B @ T0+1000
    const payload = () => ({ model: 'm', input: inputOf(partA, partB, '现在') });
    await h.request(payload(), conv);

    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const s1 = lastSent(h);
    const b1 = recoveryBlocksOf(s1);
    assert.equal(b1.length, 1, 'stage 1 先到');
    assert.ok(b1[0].includes(partA) && !b1[0].includes(partB), 'stage 1 只给 A');

    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const s2 = lastSent(h);
    const b2 = recoveryBlocksOf(s2);
    assert.equal(b2.length, 2, 'stage 2 追加');
    assert.equal(b2[0], b1[0], 'A 块逐字不变（不得第二轮改写成 A+B）');
    assert.ok(b2[1].includes(partB), 'stage 2 只给 B');
    assert.equal(historyText(s2).includes(partA), false, '原位仍不回填');
    const markers = await ledgerMarkers(h, conv);
    assert.deepEqual(markers.map((m) => m.key), ['f-rc#1', 'f-rc#2']);
  } finally {
    await h.stop();
  }
});

test('R-D Gateway restart：已恢复的 stage 不重复，重启后只追加后续 stage', async () => {
  const h = await build();
  const restarted = [];
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    pushFragment(h.engine(), {
      id: 'f-rd', hiddenFrom: T0 - H, end: T0 + H, restoreAt,
      recovery: { resolution: 'full', stages: 2 }
    });
    const conv = 'rd';
    const partA = '重启前片段甲';
    const partB = '重启后片段乙';
    await h.request({ model: 'm', input: inputOf(partA) }, conv);
    h.clock.set(T0 + 1000);
    await h.request({ model: 'm', input: inputOf(partA, partB) }, conv);
    const payload = () => ({ model: 'm', input: inputOf(partA, partB, '现在') });
    await h.request(payload(), conv);

    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const before = recoveryBlocksOf(lastSent(h));
    assert.equal(before.length, 1, '重启前已发射 stage 1');

    // —— Gateway restart：同 dataDir / 同 engine / 同时钟，全新进程内实例 ——
    const h2 = await h.respawn();
    restarted.push(h2);
    h2.fake.state.calls.length = 0;
    await h2.request(payload(), conv);
    const afterRestart = recoveryBlocksOf(lastSent(h2));
    assert.equal(afterRestart.length, 2, '重启后只追加 stage 2');
    assert.equal(afterRestart[0], before[0], 'stage 1 不重复、不改写');
    assert.ok(afterRestart[1].includes(partB), 'stage 2 内容为 B');

    h2.fake.state.calls.length = 0;
    await h2.request(payload(), conv);
    const third = recoveryBlocksOf(lastSent(h2));
    assert.equal(third.length, 2, '后续轮次不再追加');
    const markers = await ledgerMarkers(h2, conv);
    assert.deepEqual(markers.map((m) => m.key), ['f-rd#1', 'f-rd#2'], '发射标记重启后仍幂等');
  } finally {
    for (const handle of restarted) await handle.stop();
    await h.stop();
  }
});

// ---------------- C-3：恢复后再压缩 ----------------

test('C-3 恢复后再压缩：恢复块按普通可见 context 参与压缩，不重读原文、不重复追加', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    pushFragment(h.engine(), { id: 'f-c3', hiddenFrom: T0 - H, end: T0 + H, restoreAt });
    const conv = 'c3';
    const secretMsg = `压缩前说过的 ${SECRET}`;
    await h.request({ model: 'm', input: inputOf(secretMsg) }, conv);
    await h.request({ model: 'm', input: inputOf(secretMsg, '现在') }, conv);

    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: inputOf(secretMsg, '现在') }, conv);
    const recovered = lastSent(h);
    assert.equal(recoveryBlocksOf(recovered).length, 1, '已追加恢复块');
    assert.ok(tailSlotText(recovered).includes(SECRET), '恢复时原文仍在 → 真实恢复');
    const fragmentCount = h.engine().state.fragmentBatches.length;
    const markersBefore = await ledgerMarkers(h, conv);
    assert.equal(markersBefore.length, 1);

    // —— 随后触发 compression：宿主只回传摘要，raw transcript 出局 ——
    h.fake.state.calls.length = 0;
    await h.request({ model: 'm', input: inputOf('（更早的对话已压缩为摘要）', '继续') }, conv);
    const after = lastSent(h);
    const blocks = recoveryBlocksOf(after);
    assert.equal(blocks.length, 1, '恢复块不重复追加，也不因压缩产生第二个');
    assert.equal(h.engine().state.fragmentBatches.length, fragmentCount, '不重新生成另一个 fragment');
    assert.equal(scanAll(after, h).includes(SECRET), false, '不再读取原始 hidden transcript（原文已随压缩出局）');
    const markersAfter = await ledgerMarkers(h, conv);
    assert.equal(markersAfter.length, 1, '恢复标记不新增');
    assert.deepEqual(markersAfter[0].key, markersBefore[0].key);
    assert.ok(tailSlotText(after).includes(LABEL), '恢复事实仍按普通可见 context 存在');
  } finally {
    await h.stop();
  }
});

// ---------------- 软 / 硬断片共用同一机制 ----------------

test('R-E 硬断片：raw transcript 仍在，也只给 Proof 事实（原文存在 ≠ 全部恢复）', async () => {
  const h = await build();
  try {
    h.engine().setStateInjection(false);
    const restoreAt = T0 + 60 * H;
    h.engine().state.drinkEvents.push({ eventId: 'ev-re', cupId: 'cup-re', consumedAt: T0 + 1000, standardDrinks: 2 });
    h.engine().state.records.push({ id: 'drink-re', type: '喝下', time: T0 + 1000, drunk: true });
    // 同一个 fragment lifecycle（id / restoreAt / readable 完全一致），只有 mode 不同
    h.engine().state.fragmentBatches.push({ id: 'f-re', readable: false, hiddenFrom: T0 - H, end: T0 + H, restoreAt, mode: 'hard' });
    const conv = 're';
    const tokenE = 'HARD_BLACKOUT_TOKEN_E1';
    await h.request({ model: 'm', input: inputOf(tokenE) }, conv);
    const payload = () => ({ model: 'm', input: inputOf(tokenE, '现在') });
    await h.request(payload(), conv);

    h.clock.set(restoreAt + 1); h.engine().settle(h.clock.now());
    h.fake.state.calls.length = 0;
    await h.request(payload(), conv);
    const after = lastSent(h);
    assert.equal(scanAll(after, h).includes(tokenE), false, '硬断片：原文仍在也不得给逐字');
    const blocks = recoveryBlocksOf(after);
    assert.equal(blocks.length, 1, '恢复块照常给出（同一 fragment lifecycle）');
    assert.ok(blocks[0].includes('1 杯'), '只给 Proof 记下的少量事实');
    const markers = await ledgerMarkers(h, conv);
    assert.equal(markers[0].source, 'proof', '源选择退化为 proof');
    assert.equal(markers[0].key, 'f-re#1', '不因硬断片另造 fragment 状态机');
  } finally {
    await h.stop();
  }
});

// ---------------- 恢复源选择的纯函数契约 ----------------

test('恢复源优先级：raw 优先、proof 兜底；Proof 可见度可压制 raw', async () => {
  const batches = [{ id: 'f-x', hiddenFrom: 100, end: 200, restoreAt: 300, mode: 'soft', readable: false }];
  const meta = [{ index: 0, role: 'user', raw: { content: 'a' } }];
  const timeByIdx = new Map([[0, 150]]);
  const candidates = fragmentCandidates({ meta, timeByIdx, batches, batch: batches[0], tailIndex: 1 });
  assert.equal(candidates.length, 1, '按 stable fragment identity + 时间边界命中原片段');

  const soft = { resolution: 'full', ratio: 1, stages: 1 };
  const hard = { resolution: 'facts', ratio: 1, stages: 1 };
  assert.equal(selectRecoverySource({ candidates, visibility: soft }), 'raw', '原文仍在 + 允许逐字 → raw');
  assert.equal(selectRecoverySource({ candidates: [], visibility: soft }), 'proof', '原文已不在 → proof 兜底');
  assert.equal(selectRecoverySource({ candidates, visibility: hard }), 'proof', '硬断片：原文仍在也只给事实');
});
