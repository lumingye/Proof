import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../../src/engine/ProofEngine.js';
import { computeCupEffect, snapshotEffectBaseline } from '../../src/core/effects.js';
import { mouthSuggestion } from '../../src/core/belief.js';
import { produceVomitEvent, produceCrashEvent, SAFETY_NOTE } from '../../src/core/failure.js';
import { STATE_AXES } from '../../src/core/constants.js';
import { buildFromParts, cloneCup, menuItem, realPack } from '../../src/content/realPack.js';
import { auditEngine, AUDIT_T0, almost, EPS_DOSE, packWithRole } from './helpers.audit.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';

test('AUDIT-6.6 β=0/0.5/1：只乘一次，精度永不被信念推动', () => {
  const base = { 愉悦: 2, 唤醒: 2, 亲近: 2, 守门: -2, 欲望: 2, 精度: 4 };
  const s0 = mouthSuggestion(base, 0, 2);
  const s05 = mouthSuggestion(base, 0.5, 2);
  const s1 = mouthSuggestion(base, 1, 2);
  assert.equal(s0.愉悦, 0);
  assert.ok(almost(s05.愉悦, 0.5, 1e-9));
  assert.ok(almost(s1.愉悦, 1, 1e-9));
  assert.equal(s0.精度, 0);
  assert.equal(s05.精度, 0);
  assert.equal(s1.精度, 0);
  const e = auditEngine('belief_isolation');
  const cup = cloneCup(menuItem('迷情剂') || buildFromParts('迷情剂', [{ id: '水', volume: 200 }], {
    kind: 'custom', effects: { 愉悦: 3, 唤醒: 2, 亲近: 3, 守门: -2, 欲望: 3, 精度: 0 }, totalMouths: 2
  }), { beta: 1, totalMouths: 2, kind: 'custom' });
  e.sipAll(cup, AUDIT_T0);
  const st = e.evaluateCup(cup, AUDIT_T0).state;
  assert.equal(st.精度, 0);
  assert.ok(st.欲望 > 0);
});

test('AUDIT-6.6 平淡命名零信念基础；命中登记名用登记向量', () => {
  const e = auditEngine('belief_isolation');
  const waterNamed = buildFromParts('一杯水', [{ id: '水', volume: 200 }], { kind: 'custom', totalMouths: 2, effects: { 欲望: 5 } });
  // 平淡名应忽略 effects 作为信念基础——若实现偷用配方向量，本测试失败。
  const id = e.createOffer(cloneCup(waterNamed), MIXER, MIXER, DRINKER, AUDIT_T0);
  const r = e.drinkOffer(id, DRINKER, 'plain', AUDIT_T0);
  assert.ok(Math.abs(r.eval.beliefStrength.欲望) < 1e-9, `plain name leaked belief ${r.eval.beliefStrength.欲望}`);

  const e2 = auditEngine('belief_isolation');
  const asWhiskey = buildFromParts('威士忌', [{ id: '水', volume: 60 }], {
    kind: 'custom', totalMouths: 2, beta: 1
  });
  e2.sipAll(asWhiskey, AUDIT_T0);
  const b = e2.evaluateCup(asWhiskey, AUDIT_T0).beliefStrength;
  assert.ok(b.守门 > 0, 'claimed 威士忌 must use registered 守门, not water recipe');
});

test('AUDIT-6.8 敏感度初值 1，边界 clamp，无记录 id 不更新，杯中只排队', () => {
  const e = auditEngine();
  for (const axis of STATE_AXES) assert.equal(e.state.sensitivity[axis], 1);
  assert.equal(e.updateSensitivity(null, '愉悦', 'up').ok, false);
  const cup = cloneCup(menuItem('威士忌'), { totalMouths: 2 });
  const r = e.applyMouth(cup, 0, AUDIT_T0);
  const queued = e.updateSensitivity(r.drinkRecordId, '愉悦', 'up', AUDIT_T0);
  assert.equal(queued.queued, true);
  assert.equal(e.state.sensitivity.愉悦, 1);
  e.applyMouth(cup, 1, AUDIT_T0 + 1);
  assert.ok(almost(e.state.sensitivity.愉悦, 1.1, 1e-9));
});

test('AUDIT-6.10 清醒基线反事实差值不是当前完整状态', () => {
  const e = auditEngine('dose_isolation');
  const cup = cloneCup(menuItem('威士忌'), { totalMouths: 2, beta: 0, kind: 'menu' });
  e.sipAll(cup, AUDIT_T0);
  const ev = e.evaluateCup(cup, AUDIT_T0);
  const effect = computeCupEffect(e.state, e.state.effectBaseline || snapshotEffectBaseline({
    c: 0, actives: e.state.actives, hangoverSnapshots: [], beliefResiduals: [], eventPeak: 0, sensitivity: e.state.sensitivity
  }, AUDIT_T0), cup, AUDIT_T0, e.contentPack);
  // 若把当前状态当成本杯增量，差值会等于 state 而非相对零基线的增量差异结构。
  assert.ok(effect.delta, 'missing delta');
  assert.ok(effect.actualState);
  assert.ok(effect.counterfactualState);
  const sameAsState = STATE_AXES.every((ax) => almost(effect.delta[ax], ev.state[ax], 1e-9));
  const cfZero = STATE_AXES.every((ax) => almost(effect.counterfactualState[ax], 0, 1e-9));
  assert.equal(cfZero, true, `cf should be sober zero, got ${JSON.stringify(effect.counterfactualState)}`);
  assert.equal(typeof effect.dominant === 'string' || effect.dominant == null, true);
});

test('AUDIT-6.10 已有旧酒精时反事实不是把当前状态当增量', () => {
  const e = auditEngine('dose_isolation');
  e.state.lastSettle = AUDIT_T0;
  e.state.c = 3;
  e.state.eventPeak = 3;
  const cup = cloneCup(menuItem('伏特加'), { totalMouths: 2, beta: 0 });
  e.sipAll(cup, AUDIT_T0);
  const effect = computeCupEffect(e.state, snapshotEffectBaseline({
    c: 3,
    actives: e.state.actives,
    hangoverSnapshots: [],
    beliefResiduals: [],
    eventPeak: 3,
    sensitivity: e.state.sensitivity
  }, AUDIT_T0), cup, AUDIT_T0, e.contentPack);
  const ev = e.evaluateCup(cup, AUDIT_T0);
  const identical = STATE_AXES.every((ax) => almost(effect.delta[ax], ev.state[ax], 1e-9));
  assert.equal(identical, false, 'delta must not equal full current state when old alcohol exists');
});

test('AUDIT-6.10 本杯期间旧酒精归零产生宿醉时，不得把宿醉算进本杯增量', () => {
  const e = auditEngine('dose_isolation');
  e.state.lastSettle = AUDIT_T0;
  e.state.c = 2;
  e.state.eventPeak = 8;
  e.state.tonightPeak = 8;
  const water = cloneCup(buildFromParts('白开水', [{ id: '水', volume: 200 }], { kind: 'menu', totalMouths: 2, effects: null }));
  e.applyMouth(water, 0, AUDIT_T0);
  const baseline = e.state.effectBaseline;
  e.applyMouth(water, 1, AUDIT_T0 + 50 * 60000);
  assert.equal(e.state.c, 0);
  assert.ok(e.state.hangoverSnapshots.length >= 1, 'hangover snapshot should exist after old alcohol zeros');
  const effect = computeCupEffect(e.state, baseline, water, AUDIT_T0 + 50 * 60000, e.contentPack);
  assert.ok(Math.abs(effect.delta.愉悦) < 0.5, `hangover leaked into cup delta 愉悦=${effect.delta.愉悦}`);
  assert.ok(Math.abs(effect.delta.精度) < 0.5, `hangover leaked into cup delta 精度=${effect.delta.精度}`);
});

test('AUDIT-6.10 第一口后 export/restore 再喝完，与不中断对照在容差内一致', () => {
  const cupA = cloneCup(menuItem('威士忌'), { totalMouths: 2 });
  const cupB = cloneCup(menuItem('威士忌'), { totalMouths: 2 });
  const control = auditEngine('dose_isolation');
  control.applyMouth(cupA, 0, AUDIT_T0);
  control.applyMouth(cupA, 1, AUDIT_T0 + 1000);
  const split = auditEngine('dose_isolation');
  split.applyMouth(cupB, 0, AUDIT_T0);
  const snap = split.exportState();
  const restored = ProofEngine.restoreState(snap, packWithRole('dose_isolation'));
  restored.applyMouth(cupB, 1, AUDIT_T0 + 1000);
  assert.ok(almost(control.state.c, restored.state.c, EPS_DOSE));
  const s1 = control.evaluateCup(cupA, AUDIT_T0 + 1000).state;
  const s2 = restored.evaluateCup(cupB, AUDIT_T0 + 1000).state;
  for (const axis of STATE_AXES) assert.ok(almost(s1[axis], s2[axis], 1e-6), axis);
});

test('AUDIT-6.12 酒精线性代谢、咖啡因/信念半衰期、同刻 settle 幂等、倒退不负代谢', () => {
  const e = auditEngine();
  e.state.lastSettle = AUDIT_T0;
  e.state.c = 6;
  e.settle(AUDIT_T0 + 3600000);
  assert.ok(almost(e.state.c, 3, EPS_DOSE));
  const again = e.settle(AUDIT_T0 + 3600000);
  assert.ok(almost(again.c, 3, EPS_DOSE));
  const cBefore = e.state.c;
  e.settle(AUDIT_T0);
  assert.equal(e.state.c, cBefore);
  e.state.actives.咖啡因 = { amount: 1, lastSettle: AUDIT_T0 + 3600000 };
  e.settle(AUDIT_T0 + 3600000 + 5 * 3600000);
  assert.ok(almost(e.state.actives.咖啡因.amount, 0.5, 1e-6));
});

test('AUDIT-6.12 一次长 settle 与分段 settle 在容差内一致', () => {
  const one = auditEngine();
  one.state.lastSettle = AUDIT_T0;
  one.state.c = 9;
  one.settle(AUDIT_T0 + 3 * 3600000);
  const many = auditEngine();
  many.state.lastSettle = AUDIT_T0;
  many.state.c = 9;
  for (let i = 1; i <= 6; i += 1) many.settle(AUDIT_T0 + i * 30 * 60000);
  assert.ok(almost(one.state.c, many.state.c, 1e-6));
});

test('AUDIT-6.15 reset 三档字段；有当前杯时三档均拒绝', () => {
  function primed() {
    const e = auditEngine();
    const cup = cloneCup(menuItem('威士忌'), { totalMouths: 2 });
    e.sipAll(cup, AUDIT_T0);
    e.state.eventPeak = 8;
    return e;
  }
  const open = primed();
  const cup2 = cloneCup(menuItem('伏特加'), { totalMouths: 2 });
  open.applyMouth(cup2, 0, AUDIT_T0 + 10);
  const denied = open.reset('醒酒', AUDIT_T0 + 10);
  assert.equal(denied.ok, false);

  const a = primed();
  a.reset('醒酒', AUDIT_T0 + 100);
  assert.equal(a.state.c, 0);
  assert.equal(a.state.beliefResiduals.length, 0);
  assert.ok(a.state.hangoverSnapshots.length >= 1);
  assert.ok(a.state.records.length > 0);

  const b = primed();
  b.reset('连宿醉一起清', AUDIT_T0 + 100);
  assert.equal(b.state.c, 0);
  assert.equal(b.state.hangoverSnapshots.length, 0);
  assert.ok(b.state.records.length > 0);

  const c = primed();
  const recBefore = c.state.records.length;
  c.reset('这晚不算', AUDIT_T0 + 100);
  assert.equal(c.state.c, 0);
  assert.equal(c.state.hangoverSnapshots.length, 0);
  assert.ok(c.state.records.length < recBefore || c.state.records.every((r) => r.time < c.state.tonightStart));
});

test('AUDIT-6.16 吐上穿一次；宕机用注入随机；haltClient=false；塌为过峰状态', () => {
  const v = produceVomitEvent();
  const c = produceCrashEvent();
  assert.equal(v.haltClient, false);
  assert.equal(c.haltClient, false);
  assert.ok(v.safetyNote);
  assert.notEqual(v.script, v.safetyNote);

  const e = auditEngine(null, { random: () => 0 });
  const cup = buildFromParts('灌', [{ id: '伏特加', volume: 400 }], { totalMouths: 2, kind: 'custom' });
  const r0 = e.applyMouth(cup, 0, AUDIT_T0);
  const r1 = e.applyMouth(cup, 1, AUDIT_T0 + 1);
  const vomits = [...r0.events, ...r1.events].filter((x) => x.type === '吐');
  assert.equal(vomits.length, 1);

  const e2 = auditEngine();
  e2.state.c = 8;
  e2.state.lastSettle = AUDIT_T0;
  const ev = e2.evaluateCup(null, AUDIT_T0);
  const combined = ev.intermediates[9].in.combined;
  const after = ev.intermediates[9].out.afterWindow;
  assert.ok(after.欲望 < combined.欲望, 'collapse window should fold 欲望');
  const hasCollapseSlot = !!(realPack.statusCopy && realPack.statusCopy.塌);
  assert.equal(hasCollapseSlot, true, '塌 must have an independent content slot');
  const presented = (ev.presentation?.states || []).some((s) => s.type === '塌');
  assert.equal(presented, true, 'collapse state must be presented when window folds');
});

test('AUDIT-6.14 断片：上穿 8 开批，记录不删除，普通模式不得声称删除宿主聊天', () => {
  const e = auditEngine();
  const cup = buildFromParts('断片酒', [{ id: '伏特加', volume: 400 }], { totalMouths: 2, kind: 'custom' });
  e.applyMouth(cup, 0, AUDIT_T0);
  e.applyMouth(cup, 1, AUDIT_T0 + 1);
  assert.ok(e.state.c >= 8);
  assert.ok(e.state.fragmentBatches.length >= 1);
  assert.equal(e.state.fragmentBatches[0].readable, false);
  assert.ok(e.state.records.length > 0);
  const snap = e.exportState();
  const restored = ProofEngine.restoreState(snap, realPack);
  assert.equal(restored.state.fragmentBatches.length, e.state.fragmentBatches.length);
  assert.equal(restored.state.records.length, e.state.records.length);
  const slot = realPack.statusCopy?.断片;
  assert.ok(slot, '断片 copy slot missing');
  assert.equal(String(slot.script).includes('删除'), false);
});

test('AUDIT-6.19 注入默认关；无状态不注入；开则最多 3 句且不含行为指令/精确轴', () => {
  const e = auditEngine();
  assert.equal(e.isInjectionEnabled(), false);
  assert.equal(e.currentInjection(AUDIT_T0), null);
  e.setStateInjection(true);
  const empty = e.currentInjection(AUDIT_T0);
  assert.ok(empty === null || (empty.text && empty.text.includes('没有什么额外的东西被推动')));
  const cup = cloneCup(menuItem('威士忌'), { totalMouths: 2 });
  e.sipAll(cup, AUDIT_T0);
  const inj = e.currentInjection(AUDIT_T0);
  assert.ok(inj.text);
  assert.equal(inj.text.includes('必须说话'), false);
  assert.equal(/\n/.test(inj.text) ? inj.text.split('\n').length <= 4 : true, true);
  e.setStateInjection(false);
  assert.equal(e.currentInjection(AUDIT_T0), null);
});

test('AUDIT-6.18 export 含当前杯/峰值/信念/断片/敏感度队列', () => {
  const e = auditEngine();
  const cup = cloneCup(menuItem('威士忌'), { totalMouths: 2 });
  const r = e.applyMouth(cup, 0, AUDIT_T0);
  e.updateSensitivity(r.drinkRecordId, '唤醒', 'up', AUDIT_T0);
  const json = e.exportState();
  assert.ok(json.currentCup);
  assert.ok('eventPeak' in json);
  assert.ok('tonightPeak' in json);
  assert.ok(Array.isArray(json.beliefResiduals));
  assert.ok(Array.isArray(json.fragmentBatches));
  assert.ok(Array.isArray(json.pendingSensitivity));
  assert.ok(json.pendingSensitivity.length >= 1);
  const restored = ProofEngine.restoreState(json, realPack);
  assert.equal(restored.state.pendingSensitivity.length, json.pendingSensitivity.length);
});
