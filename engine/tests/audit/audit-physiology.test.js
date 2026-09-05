import test from 'node:test';
import assert from 'node:assert/strict';
import { doseToPhysiology, mlToStandardDrinks, metabolize, chatOf } from '../../src/core/dose.js';
import { caffeineToPhysiology, metabolizeCaffeine, caffeineOfParts } from '../../src/core/active.js';
import { applyWindow } from '../../src/core/evaluate.js';
import { assembleEffectDescription, publicEffectDescription, phraseTier, parseShorthand } from '../../src/core/effects.js';
import { createHangoverSnapshot } from '../../src/core/hangover.js';
import { WINDOW_P, WINDOW_K, STATE_AXES, PHRASE_TIERS } from '../../src/core/constants.js';
import { effectLexicon, ingredients, buildFromParts, cloneCup, menuItem } from '../../src/content/realPack.js';
import { TEST_ROLES, almost, EPS_EXACT, EPS_DOSE, auditEngine, AUDIT_T0, axisRangeOk } from './helpers.audit.js';

function specPhys(c) {
  const chat = Math.min(c, 10);
  const precision = Math.max(-5, Math.min(0, -0.5 * chat));
  let arousal;
  let pleasure;
  if (chat <= 3) {
    arousal = 1.2 * chat;
    pleasure = 1.0 * chat;
  } else {
    arousal = 3.6 - 0.9 * (chat - 3);
    pleasure = 3.0 - 0.8 * (chat - 3);
  }
  return { 精度: precision, 唤醒: arousal, 愉悦: pleasure };
}

test('AUDIT-6.2 酒精生理曲线在全部指定采样点与 SPEC 一致', () => {
  const points = [0, 0.01, 1, 2.999, 3, 3.001, 6, 8, 9.999, 10, 10.001, 15, 20];
  for (const c of points) {
    const got = doseToPhysiology(c);
    const exp = specPhys(c);
    assert.ok(almost(got.精度, exp.精度, EPS_EXACT), `精度 c=${c} got=${got.精度}`);
    assert.ok(almost(got.唤醒, exp.唤醒, EPS_EXACT), `唤醒 c=${c}`);
    assert.ok(almost(got.愉悦, exp.愉悦, EPS_EXACT), `愉悦 c=${c}`);
    assert.ok(got.精度 <= 0, `精度 must be ≤0 at c=${c}`);
  }
  assert.ok(almost(doseToPhysiology(10).愉悦, doseToPhysiology(20).愉悦, EPS_EXACT));
  assert.equal(chatOf(20), 10);
  assert.equal(metabolize(2, 10), 0);
  assert.ok(doseToPhysiology(3.001).愉悦 < doseToPhysiology(3).愉悦);
});

test('AUDIT-6.2 真实 c 可超过 10，settle 不把数据层截成 10，也不产生负杯', () => {
  const e = auditEngine('dose_isolation');
  e.state.lastSettle = AUDIT_T0;
  e.state.c = 20;
  e.settle(AUDIT_T0);
  assert.equal(e.state.c, 20);
  e.settle(AUDIT_T0 + 3600000);
  assert.ok(almost(e.state.c, 17, EPS_DOSE));
  const ev = e.evaluateCup(null, AUDIT_T0 + 3600000);
  assert.ok(almost(ev.c, 17, EPS_DOSE));
  assert.ok(almost(ev.chat, 10, EPS_EXACT));
  e.settle(AUDIT_T0 + 20 * 3600000);
  assert.equal(e.state.c, 0);
});

test('AUDIT-6.3 30ml×40%≈0.95；加水不减少纯酒精；口数 ceil(V/45) 至少 2', () => {
  const neat = mlToStandardDrinks(30, 0.4);
  assert.ok(almost(neat, 0.9468, 1e-4), `got ${neat}`);
  const e = auditEngine('dose_isolation');
  const neatCup = buildFromParts('烈', [{ id: '伏特加', volume: 45 }], { kind: 'custom', totalMouths: 2 });
  const watered = buildFromParts('兑', [{ id: '伏特加', volume: 45 }, { id: '水', volume: 120 }], { kind: 'custom', totalMouths: 2 });
  assert.ok(almost(neatCup.standardDrinks, watered.standardDrinks, EPS_DOSE));
  e.sipAll(cloneCup(neatCup), AUDIT_T0);
  const cNeat = e.state.c;
  const e2 = auditEngine('dose_isolation');
  e2.sipAll(cloneCup(watered), AUDIT_T0);
  assert.ok(almost(e2.state.c, cNeat, EPS_DOSE));
  const beer = menuItem('啤酒');
  assert.ok(beer.totalMouths >= 2);
  assert.equal(beer.totalMouths, Math.max(2, Math.ceil(beer.totalVolume / 45)));
});

test('AUDIT-6.3 同一口重试不重复入体；未结束杯不能开第二杯；拒绝零副作用', () => {
  const e = auditEngine('dose_isolation');
  const cup = cloneCup(buildFromParts('烈', [{ id: '伏特加', volume: 45 }], { kind: 'custom', totalMouths: 2 }));
  const r1 = e.applyMouth(cup, 0, AUDIT_T0);
  const c1 = e.state.c;
  const r2 = e.applyMouth(cup, 0, AUDIT_T0 + 1);
  assert.equal(r2.skipped, true);
  assert.ok(almost(e.state.c, c1, EPS_DOSE));
  const cup2 = cloneCup(buildFromParts('烈2', [{ id: '伏特加', volume: 45 }], { kind: 'custom', totalMouths: 2 }));
  const blocked = e.applyMouth(cup2, 0, AUDIT_T0 + 2);
  assert.equal(blocked.ok, false);
  const e3 = auditEngine();
  const id = e3.createOffer(cloneCup(menuItem('威士忌')), 'mixer', 'mixer', 'drinker', AUDIT_T0);
  const before = { c: e3.state.c, cups: e3.state.cupsDrunk };
  e3.rejectOffer(id, 'drinker', AUDIT_T0);
  assert.equal(e3.state.c, before.c);
  assert.equal(e3.state.cupsDrunk, before.cups);
});

test('AUDIT-6.4 咖啡因只推愉悦/唤醒，不解酒，k=2/4 曲线正确', () => {
  const cafe2 = caffeineToPhysiology(2);
  const cafe2p = caffeineToPhysiology(2.001);
  const cafe4 = caffeineToPhysiology(4);
  const cafe6 = caffeineToPhysiology(6);
  assert.ok(almost(cafe2.唤醒, 2.4, EPS_EXACT));
  assert.ok(almost(cafe2.愉悦, 1.0, EPS_EXACT));
  assert.equal(cafe2.精度, 0);
  assert.equal(cafe2.欲望, 0);
  assert.ok(almost(cafe2p.唤醒, 2.4, EPS_EXACT));
  assert.ok(cafe2p.愉悦 < cafe2.愉悦);
  assert.ok(almost(cafe4.唤醒, cafe6.唤醒, EPS_EXACT));
  assert.equal(metabolizeCaffeine(0.04, 0), 0);
  const after5h = metabolizeCaffeine(1, 5);
  assert.ok(almost(after5h, 0.5, 1e-9));
  const em = menuItem('Espresso Martini');
  const k = caffeineOfParts(em.recipe, ingredients);
  assert.ok(almost(k, 1.3333333333, 1e-6), `k=${k}`);
});

test('AUDIT-6.4 纯冷萃 / 纯酒精 / EM / 顺序无关 golden', () => {
  const cold = buildFromParts('冷萃', [{ id: '浓缩咖啡', volume: 30 }], { kind: 'custom', totalMouths: 2 });
  const booze = buildFromParts('烈', [{ id: '伏特加', volume: 40 }], { kind: 'custom', totalMouths: 2 });
  const em = cloneCup(menuItem('Espresso Martini'), { totalMouths: 2, kind: 'custom' });

  const a = auditEngine('dose_isolation');
  a.sipAll(cloneCup(cold), AUDIT_T0);
  const ka = a.state.actives.咖啡因.amount;
  assert.ok(almost(ka, 1, EPS_DOSE));
  assert.equal(a.state.c, 0);
  const pa = a.evaluateCup(null, AUDIT_T0).physiology;
  assert.ok(almost(pa.精度, 0, EPS_EXACT));
  assert.ok(pa.唤醒 > 0);

  const b = auditEngine('dose_isolation');
  b.sipAll(cloneCup(booze), AUDIT_T0);
  assert.ok(b.state.c > 0);
  assert.ok((b.state.actives.咖啡因?.amount || 0) === 0);

  const c1 = auditEngine('dose_isolation');
  c1.sipAll(cloneCup(cold), AUDIT_T0);
  c1.sipAll(cloneCup(booze), AUDIT_T0 + 1);
  const c2 = auditEngine('dose_isolation');
  c2.sipAll(cloneCup(booze), AUDIT_T0);
  c2.sipAll(cloneCup(cold), AUDIT_T0 + 1);
  assert.ok(almost(c1.state.c, c2.state.c, EPS_DOSE));
  assert.ok(almost(c1.state.actives.咖啡因.amount, c2.state.actives.咖啡因.amount, EPS_DOSE));
  const s1 = c1.evaluateCup(null, AUDIT_T0 + 1).state;
  const s2 = c2.evaluateCup(null, AUDIT_T0 + 1).state;
  for (const axis of STATE_AXES) assert.ok(almost(s1[axis], s2[axis], EPS_DOSE), axis);

  const emE = auditEngine('dose_isolation');
  emE.sipAll(em, AUDIT_T0);
  assert.ok(emE.state.c > 0);
  assert.ok(emE.state.actives.咖啡因.amount > 1);
});

test('AUDIT-6.5 窗口只作用于欲望/亲近一次；相反守门得到相反推力', () => {
  const eps = 1e-6;
  assert.ok(almost(applyWindow(WINDOW_P - eps), WINDOW_P - eps, 1e-9));
  assert.ok(almost(applyWindow(WINDOW_P), WINDOW_P, 1e-9));
  const over = applyWindow(WINDOW_P + eps);
  assert.ok(over < WINDOW_P);
  const at5 = applyWindow(5);
  assert.ok(at5 < WINDOW_P);
  assert.ok(at5 < 0 || at5 < 5);
  const raw10 = 10;
  const win10 = applyWindow(raw10);
  assert.ok(win10 < 0, 'over-peak must be reverse thrust, not abs');
  assert.ok(almost(win10, WINDOW_P - WINDOW_K * (raw10 - WINDOW_P), EPS_EXACT));

  const open = TEST_ROLES.open_guard.reactionCurve(4);
  const closed = TEST_ROLES.closed_guard.reactionCurve(4);
  assert.ok(open.守门 < 0);
  assert.ok(closed.守门 > 0);
  assert.ok(almost(Math.abs(open.守门), Math.abs(closed.守门), EPS_EXACT));
});

test('AUDIT-6.11 文案档位、零态、最多 3 句、负向词条、无轴名泄漏', () => {
  assert.deepEqual(PHRASE_TIERS.低, [0, 1.5]);
  const edges = [0, 0.499, 0.5, 1.499, 1.5, 2.999, 3, 5];
  const expect = ['低', '低', '低', '低', '中', '中', '高', '高'];
  edges.forEach((v, i) => assert.equal(phraseTier(v), expect[i], String(v)));
  const assembled = assembleEffectDescription({
    愉悦: 2, 唤醒: 2.1, 精度: -1, 亲近: 1.8, 守门: -1.6, 欲望: 1.9
  }, effectLexicon);
  assert.ok(assembled.phrases.length <= 3);
  assert.equal(assembled.dominant, '唤醒');
  const pub = publicEffectDescription(assembled);
  assert.equal(typeof pub.text, 'string');
  assert.equal(pub.text.includes('唤醒'), false);
  assert.equal(pub.text.includes('+2.5'), false);
  assert.equal(pub.text.includes('physiology'), false);

  const zero = publicEffectDescription(assembleEffectDescription({
    愉悦: 0, 唤醒: 0, 精度: 0, 亲近: 0, 守门: 0, 欲望: 0
  }, effectLexicon));
  assert.equal(zero.text.includes('没有什么额外的东西被推动'), true, `zero text=${JSON.stringify(zero.text)}`);

  const neg = assembleEffectDescription({
    愉悦: -3, 唤醒: 0, 精度: 0, 亲近: 0, 守门: 0, 欲望: 0
  }, effectLexicon);
  assert.equal(neg.phrases[0].direction, '−');
  assert.equal(neg.phrases[0].text, effectLexicon.愉悦['−'].高);

  assert.equal(parseShorthand('++'), 4.5);
  assert.equal(parseShorthand('−−'), -4.5);
});

test('AUDIT-6.1 词库 33 条且精度无正向；登记效果无精度+', () => {
  let n = 0;
  for (const axis of STATE_AXES) {
    const node = effectLexicon[axis];
    assert.ok(node, axis);
    if (axis === '精度') {
      assert.ok(!node['+'], '精度不得有正向词条');
      assert.ok(node['−'].低 && node['−'].中 && node['−'].高);
      n += 3;
    } else {
      for (const dir of ['+', '−']) {
        assert.ok(node[dir].低 && node[dir].中 && node[dir].高, `${axis}${dir}`);
        n += 3;
      }
    }
  }
  assert.equal(n, 33);
  const e = auditEngine();
  for (const drink of e.publicMenu()) {
    const v = drink.effects?.精度;
    if (v != null) assert.ok(v <= 0, `${drink.claimedName} 精度+`);
  }
});

test('AUDIT-6.13 宿醉公式：峰<6 无快照；6/10/15/20 按 (peak-6)/4 封顶 2', () => {
  assert.equal(createHangoverSnapshot(5.9, AUDIT_T0), null);
  const s6 = createHangoverSnapshot(6, AUDIT_T0);
  assert.ok(almost(s6.initial, 0, EPS_EXACT));
  const s10 = createHangoverSnapshot(10, AUDIT_T0);
  assert.ok(almost(s10.initial, 1, EPS_EXACT));
  const s15 = createHangoverSnapshot(15, AUDIT_T0);
  assert.ok(almost(s15.initial, 2, EPS_EXACT));
  const s20 = createHangoverSnapshot(20, AUDIT_T0);
  assert.ok(almost(s20.initial, 2, EPS_EXACT));
});

test('AUDIT-6.1 求值轴值始终在范围内', () => {
  const e = auditEngine();
  e.state.c = 20;
  e.state.lastSettle = AUDIT_T0;
  const r = e.evaluateCup(null, AUDIT_T0);
  const issues = axisRangeOk(r.state);
  assert.deepEqual(issues, []);
});
