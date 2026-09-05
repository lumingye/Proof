// 普通模式跨天状态生命周期、断片恢复与 Agent 隔离测试。
// 全部使用 fake clock，禁止真实等待。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine, realPack, buildFromParts } from '../src/index.js';
import {
  DEFAULT_BLACKOUT_RECOVERY_HOURS,
  BLACKOUT_RECOVER_MS,
  resolveLifecycleConfig,
  dayKey,
  blackoutVisibility
} from '../src/core/lifecycle.js';
import { buildAgentTurnContext } from '../src/runtime/agentTurnContext.js';

const H = 3600000;
const T0 = Date.UTC(2026, 8, 2, 10, 0, 0);

function engine() {
  return new ProofEngine(null, realPack);
}

function drink(eng, ml = 200, abv = 40, now = T0, id = 'cup-1') {
  const cup = buildFromParts('测试杯', [{ id: '伏特加', volume: ml }], { id, kind: 'custom', listed: false });
  return eng.sipAll(cup, now);
}

// ---------- 配置 ----------

test('配置：默认断片恢复 60 小时，且与 BLACKOUT_RECOVER_MS 一致', () => {
  assert.equal(DEFAULT_BLACKOUT_RECOVERY_HOURS, 60);
  assert.equal(BLACKOUT_RECOVER_MS, 60 * H);
});

test('配置：默认时区 Asia/Shanghai，TTL 72 小时', () => {
  const cfg = resolveLifecycleConfig({});
  assert.equal(cfg.timezone, 'Asia/Shanghai');
  assert.equal(cfg.transientTtlHours, 72);
  assert.equal(cfg.blackoutEnabled, true);
  assert.equal(cfg.blackoutRecoveryHours, 60);
});

test('配置：可覆盖 48/72 小时恢复时间', () => {
  assert.equal(resolveLifecycleConfig({ PROOF_BLACKOUT_RECOVERY_HOURS: '48' }).blackoutRecoveryHours, 48);
  assert.equal(resolveLifecycleConfig({ PROOF_BLACKOUT_RECOVERY_HOURS: '72' }).blackoutRecoveryHours, 72);
});

test('配置：非法值必须报错，不得静默回退', () => {
  assert.throws(() => resolveLifecycleConfig({ PROOF_TRANSIENT_STATE_TTL_HOURS: '-1' }), /PROOF_TRANSIENT_STATE_TTL_HOURS/);
  assert.throws(() => resolveLifecycleConfig({ PROOF_BLACKOUT_RECOVERY_HOURS: 'abc' }), /PROOF_BLACKOUT_RECOVERY_HOURS/);
  assert.throws(() => resolveLifecycleConfig({ PROOF_STATE_TIMEZONE: 'Not/AZone' }), /PROOF_STATE_TIMEZONE/);
});

// ---------- 日分桶与跨午夜 ----------

test('日分桶：按 Asia/Shanghai 划分，不用服务器本地时区', () => {
  // UTC 2026-09-02 16:30 → 上海 2026-09-03 00:30
  const t = Date.UTC(2026, 8, 2, 16, 30);
  assert.equal(dayKey(t, 'Asia/Shanghai'), '2026-09-03');
  assert.equal(dayKey(t, 'UTC'), '2026-09-02');
});

test('跨午夜：23:50 饮酒，次日 01:00 状态仍然有效，不被午夜归零', () => {
  const eng = engine();
  const late = Date.UTC(2026, 8, 2, 15, 50); // 上海 23:50
  drink(eng, 200, 40, late);
  const before = eng.evaluate(late).state;
  assert.ok(Math.abs(before.精度) > 0, '喝完应当有精度变化');
  const after = eng.evaluate(late + 70 * 60 * 1000).state; // 上海次日 01:00
  assert.ok(Math.abs(after.精度) > 0, '跨过午夜不得归零');
});

// ---------- 临时状态 TTL ----------

test('TTL：超过 72 小时的临时状态不再参与计算', () => {
  const eng = engine();
  drink(eng, 300, 40, T0);
  assert.ok(eng.evaluate(T0).state.精度 < 0);
  const far = T0 + 73 * H;
  const s = eng.settle(far);
  assert.equal(s.c, 0, '超过 TTL 后酒精负荷必须归零');
  assert.deepEqual(s.hangoverSnapshots, [], '超过 TTL 后宿醉不再参与');
});

test('TTL：清理临时状态不删除长期敏感度', () => {
  const eng = engine();
  eng.state.sensitivity.愉悦 = 1.5;
  drink(eng, 300, 40, T0);
  eng.settle(T0 + 73 * H);
  assert.equal(eng.state.sensitivity.愉悦, 1.5);
});

// ---------- 断片 ----------

test('断片：开启时按 restoreAt 恢复，不再靠酒醒归还', () => {
  const eng = engine();
  drink(eng, 900, 40, T0); // 足以触发断片
  const batch = eng.state.fragmentBatches[0];
  assert.ok(batch, '应当产生断片批');
  assert.equal(typeof batch.id, 'string');
  assert.equal(batch.restoreAt, batch.start + BLACKOUT_RECOVER_MS);
  assert.equal(batch.readable, false);

  // 酒早就醒了，但没到 restoreAt：仍不可读
  eng.settle(T0 + 20 * H);
  assert.equal(eng.state.fragmentBatches[0].readable, false, '酒醒不再等于归还');
});

test('断片：到达 restoreAt 自动恢复，不需要再喝或手动操作', () => {
  const eng = engine();
  drink(eng, 900, 40, T0);
  const batch = eng.state.fragmentBatches[0];
  eng.settle(batch.restoreAt + 1);
  assert.equal(eng.state.fragmentBatches[0].readable, true);
});

test('断片：重复读取不得把 restoreAt 往后延', () => {
  const eng = engine();
  drink(eng, 900, 40, T0);
  const first = eng.state.fragmentBatches[0].restoreAt;
  for (let i = 1; i <= 5; i += 1) eng.settle(T0 + i * H);
  assert.equal(eng.state.fragmentBatches[0].restoreAt, first);
});

test('断片：内容仍在存储中，只是不可读', () => {
  const eng = engine();
  drink(eng, 900, 40, T0);
  assert.ok(eng.state.records.length > 0, '记录必须保留');
  const vis = blackoutVisibility(eng.state, T0 + H);
  assert.equal(vis.active, true);
  assert.equal(vis.hiddenUntil, eng.state.fragmentBatches[0].restoreAt);
});

test('断片：关闭时永不触发', () => {
  const eng = new ProofEngine(null, realPack, { lifecycle: { blackoutEnabled: false } });
  drink(eng, 900, 40, T0);
  assert.equal(eng.state.fragmentBatches.length, 0);
});

test('断片：自定义 48 小时生效', () => {
  const eng = new ProofEngine(null, realPack, { lifecycle: { blackoutRecoveryHours: 48 } });
  drink(eng, 900, 40, T0);
  const batch = eng.state.fragmentBatches[0];
  assert.equal(batch.restoreAt, batch.start + 48 * H);
});

test('断片：export/restore 之后恢复时间不变', () => {
  const eng = engine();
  drink(eng, 900, 40, T0);
  const restoreAt = eng.state.fragmentBatches[0].restoreAt;
  const restored = ProofEngine.restoreState(eng.exportState(), realPack);
  assert.equal(restored.state.fragmentBatches[0].restoreAt, restoreAt);
});

// ---------- reset ----------

test('reset：立即解除当前断片（三种模式都要）', () => {
  for (const mode of ['醒酒', '连宿醉一起清', '这晚不算']) {
    const eng = engine();
    drink(eng, 900, 40, T0);
    assert.equal(eng.state.fragmentBatches[0].readable, false);
    eng.reset(mode, T0 + H);
    const vis = blackoutVisibility(eng.state, T0 + H);
    assert.equal(vis.active, false, `${mode} 之后不应仍在断片中`);
  }
});

test('reset：保留长期敏感度', () => {
  const eng = engine();
  eng.state.sensitivity.欲望 = 2;
  drink(eng, 200, 40, T0);
  eng.reset('连宿醉一起清', T0 + H);
  assert.equal(eng.state.sensitivity.欲望, 2);
});

test('reset：写下边界，revision 增加', () => {
  const eng = engine();
  const before = eng.state.revision;
  drink(eng, 200, 40, T0);
  const afterDrink = eng.state.revision;
  assert.ok(afterDrink > before, '饮用应当推进 revision');
  eng.reset('醒酒', T0 + H);
  assert.ok(eng.state.revision > afterDrink, 'reset 应当推进 revision');
  assert.equal(eng.state.resetBoundary.at, T0 + H);
});

test('reset：重复 reset 幂等（状态不再变化）', () => {
  const eng = engine();
  drink(eng, 200, 40, T0);
  eng.reset('醒酒', T0 + H);
  const snapshot = JSON.stringify({ ...eng.exportState(), revision: 0 });
  eng.reset('醒酒', T0 + H);
  assert.equal(JSON.stringify({ ...eng.exportState(), revision: 0 }), snapshot);
});

test('reset：重启（export→restore）后效果不复活', () => {
  const eng = engine();
  drink(eng, 300, 40, T0);
  eng.reset('连宿醉一起清', T0 + H);
  const restored = ProofEngine.restoreState(eng.exportState(), realPack);
  assert.equal(restored.settle(T0 + H).c, 0);
});

test('reset：restore 旧包不能越过 reset 边界复活旧状态', () => {
  const eng = engine();
  drink(eng, 300, 40, T0);
  const stale = eng.exportState();          // reset 之前导出的旧包
  eng.reset('连宿醉一起清', T0 + H);
  const boundary = eng.state.resetBoundary;
  const restored = ProofEngine.restoreState(stale, realPack, { resetBoundary: boundary });
  assert.equal(restored.settle(T0 + 2 * H).c, 0, '旧包不得把 reset 掉的酒精带回来');
});

// ---------- 多杯累计 ----------

test('多杯：同日两杯相加，第二杯不覆盖第一杯', () => {
  const a = engine();
  drink(a, 200, 40, T0, 'c1');
  const oneCup = a.state.c;
  const b = engine();
  drink(b, 200, 40, T0, 'c1');
  drink(b, 200, 40, T0, 'c2');
  assert.ok(b.state.c > oneCup, '两杯必须多于一杯');
});

test('多杯：事件式记录，各自带结束时间', () => {
  const eng = engine();
  drink(eng, 200, 40, T0, 'c1');
  drink(eng, 200, 40, T0 + H, 'c2');
  const events = eng.lifecycleEvents();
  assert.equal(events.length, 2);
  for (const ev of events) {
    assert.ok(ev.eventId, '事件必须有 eventId');
    assert.ok(ev.consumedAt, '事件必须有 consumedAt');
    assert.ok(ev.expiresAt > ev.consumedAt, '事件必须有结束时间');
  }
  assert.notEqual(events[0].expiresAt, events[1].expiresAt, '不同时间的杯子分别过期');
});

// ---------- 注入投影 ----------

test('投影：未激活时返回紧凑结果', () => {
  const eng = engine();
  eng.setStateInjection(true);
  const ctx = buildAgentTurnContext(eng, 'chara', T0);
  assert.equal(ctx.active, false);
  assert.equal(ctx.shouldFetch, false);
  assert.equal(typeof ctx.revision, 'number');
  assert.deepEqual(ctx.stateHints, []);
  // 什么都没喝过：不给空注入（空状态约定）。
  assert.equal(ctx.injected, false);
  assert.equal(ctx.block, null);
});

test('投影：饮用后重新激活，revision 增加', () => {
  const eng = engine();
  eng.setStateInjection(true);
  const before = buildAgentTurnContext(eng, 'chara', T0).revision;
  drink(eng, 200, 40, T0);
  const after = buildAgentTurnContext(eng, 'chara', T0);
  assert.equal(after.active, true);
  assert.equal(after.shouldFetch, true);
  assert.ok(after.revision > before);
  assert.equal(after.day, dayKey(T0, 'Asia/Shanghai'));
  assert.ok(after.expiresAt > T0);
});

test('投影：同一 revision 重复获取不产生副作用', () => {
  const eng = engine();
  eng.setStateInjection(true);
  drink(eng, 200, 40, T0);
  const a = buildAgentTurnContext(eng, 'chara', T0);
  const b = buildAgentTurnContext(eng, 'chara', T0);
  assert.equal(a.revision, b.revision);
  assert.deepEqual(a.stateHints, b.stateHints);
});

test('投影：reset 之后 active=false、shouldFetch=false', () => {
  const eng = engine();
  eng.setStateInjection(true);
  drink(eng, 200, 40, T0);
  eng.reset('连宿醉一起清', T0 + H);
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + H);
  assert.equal(ctx.active, false);
  assert.equal(ctx.shouldFetch, false);
});

test('投影：断片信息以软断片形式出现，且标明限制', () => {
  const eng = engine();
  eng.setStateInjection(true);
  drink(eng, 900, 40, T0);
  const ctx = buildAgentTurnContext(eng, 'chara', T0 + H);
  assert.equal(ctx.blackout.active, true);
  assert.equal(ctx.blackout.soft, true);
  assert.ok(ctx.blackout.restoreAt > T0);
});

test('投影：不泄露喝前效果', () => {
  const eng = engine();
  eng.setStateInjection(true);
  const ctx = buildAgentTurnContext(eng, 'chara', T0);
  assert.equal(ctx.active, false);
  assert.ok(!('claimedEffects' in ctx));
});

// ---------- 性质 ----------

test('性质：任意事件顺序下精度不会变成正值', () => {
  const eng = engine();
  const times = [T0, T0 + 2 * H, T0 + H, T0 + 5 * H, T0 + 3 * H];
  for (const [i, t] of times.entries()) {
    if (t >= eng.state.lastSettle) drink(eng, 60, 40, t, `c${i}`);
    assert.ok(eng.evaluate(Math.max(t, eng.state.lastSettle)).state.精度 <= 0);
  }
});

test('性质：export→restore 之后同一时刻投影等价', () => {
  const eng = engine();
  eng.setStateInjection(true);
  drink(eng, 250, 40, T0);
  const at = T0 + 2 * H;
  const before = buildAgentTurnContext(eng, 'chara', at);
  const restored = ProofEngine.restoreState(eng.exportState(), realPack);
  restored.setStateInjection(true);
  const after = buildAgentTurnContext(restored, 'chara', at);
  assert.deepEqual(after.stateHints, before.stateHints);
  assert.equal(after.active, before.active);
  assert.equal(after.day, before.day);
});
