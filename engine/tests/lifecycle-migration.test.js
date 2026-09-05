// 生命周期接口约定§11：旧状态迁移、重启一致性、并发与幂等清理。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine, realPack, buildFromParts } from '../src/index.js';
import { migrateBlackoutBatch, resolveLifecycleConfig, pruneTransient } from '../src/core/lifecycle.js';
import { buildAgentTurnContext } from '../src/runtime/agentTurnContext.js';

const H = 3600000;
const T0 = Date.UTC(2026, 8, 2, 10, 0, 0);
const cfg = resolveLifecycleConfig({});

function drink(eng, ml = 200, now = T0, id = 'cup-1') {
  const cup = buildFromParts('测试杯', [{ id: '伏特加', volume: ml }], { id, kind: 'custom', listed: false });
  return eng.sipAll(cup, now);
}

test('迁移：旧断片批缺 id/restoreAt/mode，装载时补齐', () => {
  const legacy = {
    lastSettle: T0,
    fragmentBatches: [{ start: T0 - 5 * H, end: null, readable: false }]
  };
  const eng = new ProofEngine(legacy, realPack);
  const batch = eng.state.fragmentBatches[0];
  assert.ok(batch.id, '必须补出 blackoutId');
  assert.equal(batch.restoreAt, T0 - 5 * H + cfg.blackoutRecoveryMs);
  assert.equal(batch.hiddenFrom, T0 - 5 * H);
  assert.equal(batch.mode, 'soft');
  assert.equal(batch.enabled, true);
});

test('迁移：幂等，重复迁移不改变 restoreAt', () => {
  const raw = { start: T0, end: null, readable: false };
  const once = migrateBlackoutBatch(raw, cfg);
  const twice = migrateBlackoutBatch(once, cfg);
  assert.equal(twice.restoreAt, once.restoreAt);
  assert.equal(twice.id, once.id);
});

test('迁移：旧状态没有 revision / drinkEvents 时给出安全默认', () => {
  const eng = new ProofEngine({ lastSettle: T0, c: 1.2 }, realPack);
  assert.equal(eng.state.revision, 0);
  assert.deepEqual(eng.state.drinkEvents, []);
  assert.equal(eng.state.resetBoundary, null);
  assert.equal(eng.state.schemaVersion, 2);
  assert.equal(eng.state.c, 1.2, '旧数据不得被迁移丢掉');
});

test('迁移：export 带版本号', () => {
  const eng = new ProofEngine(null, realPack);
  assert.equal(eng.exportState().schemaVersion, 2);
});

test('迁移：缺少归属的旧状态不得被猜给某个 Agent', () => {
  // 引擎本身不持有 agentId：归属由服务端的键空间决定。
  const eng = new ProofEngine({ lastSettle: T0 }, realPack);
  assert.ok(!('agentId' in eng.exportState()), '状态包不得自带 agentId，避免导入时冒名');
});

test('重启：export→restore 后同一时刻状态等价', () => {
  const eng = new ProofEngine(null, realPack);
  drink(eng, 240, T0);
  const at = T0 + 3 * H;
  const before = eng.evaluate(at).state;
  const restored = ProofEngine.restoreState(eng.exportState(), realPack);
  const after = restored.evaluate(at).state;
  for (const axis of ['愉悦', '唤醒', '精度', '亲近', '守门', '欲望']) {
    assert.equal(after[axis], before[axis], `${axis} 必须一致`);
  }
});

test('清理：pruneTransient 幂等，重复运行不再改变状态', () => {
  const eng = new ProofEngine(null, realPack);
  drink(eng, 240, T0);
  const far = T0 + 100 * H;
  assert.equal(pruneTransient(eng.state, far, cfg), true);
  eng.state.lastSettle = far;
  assert.equal(pruneTransient(eng.state, far, cfg), false, '第二次没有可清的东西');
});

test('清理：不删除历史记录与递出记录', () => {
  const eng = new ProofEngine(null, realPack);
  drink(eng, 240, T0);
  const recordsBefore = eng.state.records.length;
  eng.settle(T0 + 100 * H);
  assert.equal(eng.state.records.length, recordsBefore, '历史记录必须保留');
});

test('并发：多次读取与 reset 交错，不产生半旧半新的投影', () => {
  const eng = new ProofEngine(null, realPack);
  eng.setStateInjection(true);
  drink(eng, 240, T0);
  const at = T0 + H;
  const before = buildAgentTurnContext(eng, 'chara', at);
  assert.equal(before.active, true);
  eng.reset('连宿醉一起清', at);
  const readings = [
    buildAgentTurnContext(eng, 'chara', at),
    buildAgentTurnContext(eng, 'chara', at),
    buildAgentTurnContext(eng, 'chara', at)
  ];
  for (const reading of readings) {
    assert.equal(reading.active, false);
    assert.equal(reading.revision, readings[0].revision, 'revision 必须稳定');
    assert.deepEqual(reading.stateHints, []);
  }
});

test('并发：任意 Agent 数量下命名空间不串线', () => {
  const engines = new Map(['a', 'b', 'c', 'd'].map((id) => [id, new ProofEngine(null, realPack)]));
  drink(engines.get('a'), 300, T0, 'cup-a');
  for (const [id, eng] of engines) {
    const ctx = buildAgentTurnContext(eng, id, T0);
    assert.equal(ctx.agentId, id);
    if (id !== 'a') assert.equal(ctx.revision, 0, `${id} 不得被 a 的饮用影响`);
  }
  assert.ok(engines.get('a').state.revision > 0);
});
