// 共享变换管线（里程碑 1）测试：硬断片过滤、tool 成组、系统保留、当前轮放行、注入。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../../engine/src/engine/ProofEngine.js';
import { realPack, buildFromParts } from '../../engine/src/content/realPack.js';
import { createLedger } from '../gateway/ledger.mjs';
import { transformGatewayRequest, decideFilterPlan, hiddenAtForBatches, placeholderText } from '../gateway/transform.mjs';
import { makeTempDir, removeTempDir } from './lib/gatewayEnv.mjs';

const H = 3600000;
const T0 = Date.UTC(2026, 8, 2, 10, 0, 0);

function drinkToBlackout(eng, at = T0, ml = 900) {
  const cup = buildFromParts('测试杯', [{ id: '伏特加', volume: ml }], { id: 'cup-b', kind: 'custom', listed: false });
  return eng.sipAll(cup, at);
}

function chatMessages() {
  return [
    { role: 'system', content: '你是阿卡姆酒吧的酒保。' },
    { role: 'user', content: '再来一杯。' },
    { role: 'assistant', content: '好，慢点喝。' },
    { role: 'user', content: '我现在感觉如何？' } // 当前轮
  ];
}

test('TF1 decideFilterPlan：系统保留、窗口内普通历史成组隐藏、tail 放行', () => {
  const meta = [
    { index: 0, role: 'system', contentHash: 's' },
    { index: 1, role: 'user', contentHash: 'a' },
    { index: 2, role: 'assistant', contentHash: 'b', hasToolCalls: false },
    { index: 3, role: 'user', contentHash: 'c' }
  ];
  const plan = decideFilterPlan(meta, {
    firstSeenAtOf: (item) => (item.index === 3 ? null : T0),
    hiddenAt: (t) => t === T0,
    tailIndex: 3
  });
  assert.deepEqual(plan.keep, [0, 3]);
  assert.equal(plan.hideGroups.length, 2); // user1 与 assistant1 各自隐藏
  assert.deepEqual(plan.hideGroups[0].indexes, [1]);
  assert.deepEqual(plan.hideGroups[1].indexes, [2]);
});

test('TF2 tool call 与其 tool result 成组整体处理（规则 34）', () => {
  const meta = [
    { index: 0, role: 'user', contentHash: 'u', hasToolCalls: false },
    { index: 1, role: 'assistant', contentHash: 'a1', hasToolCalls: true, toolCalls: [{ id: 'call_1' }] },
    { index: 2, role: 'tool', contentHash: 't1', toolCallId: 'call_1', hasToolCalls: false },
    { index: 3, role: 'user', contentHash: 'u2', hasToolCalls: false }
  ];
  const plan = decideFilterPlan(meta, {
    firstSeenAtOf: (item) => (item.index === 3 ? null : T0),
    hiddenAt: (t) => t === T0,
    tailIndex: 3
  });
  assert.deepEqual(plan.keep, [3]);
  const grouped = plan.hideGroups.map((g) => g.indexes.join(','));
  assert.ok(grouped.includes('1,2'), `assistant 与其 tool result 必须一起隐藏，实际分组：${JSON.stringify(grouped)}`);
  assert.ok(!grouped.includes('2'), 'tool result 不得单独成组');
});

test('TF2b 当前 tool result 位于 tail 时整组放行，客观事件不得在模型看见前被断片删除', () => {
  const meta = [
    { index: 0, role: 'assistant', contentHash: 'call', hasToolCalls: true, toolCalls: [{ id: 'call_1' }] },
    { index: 1, role: 'tool', contentHash: 'result-with-vomit', toolCallId: 'call_1', hasToolCalls: false }
  ];
  const plan = decideFilterPlan(meta, {
    firstSeenAtOf: () => T0,
    hiddenAt: () => true,
    tailIndex: 1
  });
  assert.deepEqual(plan.keep, [0, 1]);
  assert.deepEqual(plan.hideGroups, []);
});

test('TF3 hiddenAtForBatches：readable/restoreAt 权威判定，不隐藏窗口外', () => {
  const batches = [
    { readable: false, hiddenFrom: T0, end: T0 + H, restoreAt: T0 + 60 * H },
    { readable: true, hiddenFrom: T0, end: null, restoreAt: T0 + 60 * H }
  ];
  const hiddenAt = hiddenAtForBatches(batches, T0 + 2 * H);
  assert.equal(hiddenAt(T0 + 1000), true, '落在不可读批内');
  assert.equal(hiddenAt(T0 + H + 1000), false, '超过 end 不可读窗口外');
  assert.equal(hiddenAt(T0 - 1), false);
});

test('TF4 端到端：断片窗口内的历史被封存、当前轮可见、系统保留、正文不落盘', async () => {
  const dir = await makeTempDir('gw-tf-');
  const ledger = createLedger({ dataDir: dir, now: () => T0 + 5 * 60_000 });
  try {
    const eng = new ProofEngine(null, realPack);
    drinkToBlackout(eng, T0);
    // 本用例只钉“断片硬过滤”，隔离自动投递（默认开）的影响：
    eng.setStateInjection(false);
    // 登记历史（窗口内首见时间 T0）
    await ledger.register('charb', 'c1', { role: 'user', content: '再来一杯。', at: T0 });
    await ledger.register('charb', 'c1', { role: 'assistant', content: '好，慢点喝。', at: T0 });

    const result = await transformGatewayRequest({
      engine: eng,
      agentId: 'charb',
      now: T0 + 5 * 60_000,
      messages: chatMessages(),
      conversationId: 'c1',
      ledger,
      requestId: 'req-2'
    });

    assert.equal(result.plan.keep.includes(0), true, 'system 保留');
    assert.equal(result.plan.keep.includes(3), true, '当前轮 user 放行');
    const hiddenIndexes = result.plan.hideGroups.flatMap((g) => g.indexes).sort((a, b) => a - b);
    assert.deepEqual(hiddenIndexes, [1, 2], '窗口内历史被隐藏');
    assert.equal(result.block, null, '未开注入：无块');
  } finally {
    await removeTempDir(dir);
  }
});

test('TF5 当前轮消息本轮始终可见：即使其文本与窗口内历史相同也按 tail 放行', async () => {
  const dir = await makeTempDir('gw-tf5-');
  const ledger = createLedger({ dataDir: dir, now: () => T0 + 60_000 });
  try {
    const eng = new ProofEngine(null, realPack);
    drinkToBlackout(eng, T0);
    // 历史里已有一次「再来一杯。」
    await ledger.register('charb', 'c1', { role: 'user', content: '再来一杯。', at: T0 });

    const messages = [
      { role: 'system', content: '你是酒保。' },
      { role: 'user', content: '再来一杯。' }, // 历史
      { role: 'user', content: '再来一杯。' }  // 当前轮（同文）
    ];
    const result = await transformGatewayRequest({
      engine: eng, agentId: 'charb', now: T0 + 60_000,
      messages, conversationId: 'c1', ledger, requestId: 'req-x'
    });
    assert.deepEqual(result.plan.keep, [0, 2]);
    assert.deepEqual(result.plan.hideGroups.map((g) => g.indexes[0]), [1]);
  } finally {
    await removeTempDir(dir);
  }
});

test('TF6 开启注入且有状态时带 block；revision 取自投影', async () => {
  const dir = await makeTempDir('gw-tf6-');
  const ledger = createLedger({ dataDir: dir, now: () => T0 + 10 * 60_000 });
  try {
    const eng = new ProofEngine(null, realPack);
    // 一杯 200ml 40% ≈ 6.3 杯：有推力但不到断片线 8
    const cup = buildFromParts('测试杯', [{ id: '伏特加', volume: 200 }], { id: 'cup-s', kind: 'custom', listed: false });
    eng.sipAll(cup, T0);
    eng.setStateInjection(true);
    const result = await transformGatewayRequest({
      engine: eng, agentId: 'charb', now: T0 + 10 * 60_000,
      messages: chatMessages(), conversationId: 'c1', ledger, requestId: 'req-6'
    });
    assert.equal(result.injected, true);
    assert.ok(result.block.text.startsWith('[Proof 状态]'));
    assert.equal(typeof result.revision, 'number');
  } finally {
    await removeTempDir(dir);
  }
});

test('TF7 无状态：不注入、不产生额外文本 token', async () => {
  const dir = await makeTempDir('gw-tf7-');
  const ledger = createLedger({ dataDir: dir, now: () => T0 });
  try {
    const eng = new ProofEngine(null, realPack);
    eng.setStateInjection(true);
    const result = await transformGatewayRequest({
      engine: eng, agentId: 'charb', now: T0,
      messages: [{ role: 'user', content: '晚上好' }], conversationId: 'c1', ledger, requestId: 'req-7'
    });
    assert.equal(result.active, false);
    assert.equal(result.block, null);
    assert.deepEqual(result.plan.hideGroups, []);
    assert.equal(placeholderText().startsWith('[Proof 断片]'), true);
  } finally {
    await removeTempDir(dir);
  }
});
