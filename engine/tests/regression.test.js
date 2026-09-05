import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { mlToStandardDrinks } from '../src/core/dose.js';
import { activeAmount } from '../src/core/active.js';
import { computeDiscreteness, flavorPeakForMouth, computeRatio } from '../src/core/flavor.js';
import { produceVomitEvent, produceCrashEvent, SAFETY_NOTE } from '../src/core/failure.js';
import { fourWaters, buildFromParts, cloneCup, realPack, potion } from '../src/content/realPack.js';
import { engine, whiskey, customPotion, T0, almost } from './helpers.js';

const WHISKEY_TOTAL = 60 * 0.43 * 0.789 / 10;

test('1 四种水离散度为 0，生产事件判定不触发宕机', () => {
  const D = computeDiscreteness(fourWaters.sources);
  assert.equal(D, 0);
  const rng = () => 0;
  const e = engine({ random: rng });
  const cup = cloneCup(fourWaters, { totalMouths: 2 });
  const r = e.applyMouth(cup, 0, T0);
  assert.equal(r.events.filter((x) => x.type === '宕机').length, 0);
  assert.ok(!r.events.some((x) => x.type === '宕机'));
});

test('2 宿醉衰减到 0.1 后喝一小口，不复活旧峰值', () => {
  const e = engine();
  e.state.lastSettle = T0;
  e.state.c = 0;
  e.state.eventPeak = 0;
  e.state.hangoverSnapshots = [
    { initial: 1, halfLifeHours: 4, startTime: T0 }
  ];
  const later = T0 + 4 * 3600000 * Math.log2(10);
  const hBefore = e.getHangover(later);
  assert.ok(almost(hBefore, 0.1, 1e-3), `hBefore=${hBefore}`);
  const sip = buildFromParts('一小口', [{ id: '啤酒', volume: 10 }], { totalMouths: 2, kind: 'custom' });
  e.applyMouth(sip, 0, later);
  assert.ok(e.state.eventPeak < 6);
  const afterZero = later + 2 * 3600000;
  e.settle(afterZero);
  const hAfter = e.getHangover(afterZero);
  assert.ok(hAfter < 0.5, `宿醉不应复活，实际 h=${hAfter}`);
  assert.ok(hAfter < 0.2, `应仍接近 0.1 量级，实际 h=${hAfter}`);
  assert.equal(e.state.hangoverSnapshots.filter((s) => s.initial >= 0.99).length, 1);
});

test('3 同浓度 180ml 分四口，每口味觉峰值不变；酒精四口合计正确', () => {
  const e = engine();
  const cup = buildFromParts('同浓度', [{ id: '伏特加', volume: 180 }], { totalMouths: 4, kind: 'custom' });
  assert.equal(cup.totalMouths, 4);
  const peaks = cup.mouths.map((m) => flavorPeakForMouth(m, '烈'));
  assert.ok(peaks.every((p) => almost(p, peaks[0], 1e-9)), `peaks=${peaks}`);
  let alcohol = 0;
  for (let i = 0; i < 4; i += 1) {
    const r = e.applyMouth(cup, i, T0);
    alcohol += r.alcohol;
  }
  const expected = mlToStandardDrinks(180, 0.4);
  assert.ok(almost(alcohol, expected, 1e-9), `alcohol=${alcohol} expected=${expected}`);
  assert.ok(almost(e.state.c, expected, 1e-9), `c=${e.state.c} expected=${expected}`);
});

test('4 β=0.5 的真实信念链保留一半，不是四分之一', () => {
  const e = engine();
  const cup = customPotion(0.5, 2);
  // 新语义：真正的迷情剂走酒款性格；这里清掉真实身份，只测“白水被声称成迷情剂”的名字信念。
  cup.characterEffects = null;
  cup.characterIdentity = null;
  assert.ok(cup.baseVector && cup.baseVector.愉悦 === 3);
  e.applyMouth(cup, 0, T0);
  e.applyMouth(cup, 1, T0 + 1000);
  const residual = e.state.beliefResiduals.find((r) => r.cupId === cup.id);
  assert.ok(residual);
  assert.ok(almost(residual.cumulative.愉悦, 1.5, 1e-9), `got ${residual.cumulative.愉悦}`);
  assert.equal(residual.cumulative.精度, 0);
  assert.equal(residual.decayStart, T0 + 1000);
  const mid = e.evaluateCup(cup, T0 + 500);
  const afterFirstOnly = engine();
  const cup2 = customPotion(0.5, 2);
  cup2.characterEffects = null;
  cup2.characterIdentity = null;
  afterFirstOnly.applyMouth(cup2, 0, T0);
  const still = afterFirstOnly.state.beliefResiduals[0];
  assert.equal(still.decayStart, null);
  const later = afterFirstOnly.evaluateCup(cup2, T0 + 30 * 60 * 1000);
  assert.ok(almost(later.beliefStrength.愉悦, 0.75, 1e-6), `未喝完不得衰减，got ${later.beliefStrength.愉悦}`);
});

test('5 连续两口味觉重叠取 max，不相加；同一口多来源同轴先相加', () => {
  const e = engine();
  const tau = { rise: 1, fall: 35 };
  const cup = {
    id: 'overlap',
    claimedName: '香',
    kind: 'custom',
    totalMouths: 2,
    totalVolume: 60,
    sources: [],
    mouths: [
      {
        volume: 30, abv: 0.4, beta: 1, startTime: null, applied: false,
        components: [{ axis: '香', A: 2, tauRise: tau.rise, tauFall: tau.fall }]
      },
      {
        volume: 30, abv: 0.4, beta: 1, startTime: null, applied: false,
        components: [{ axis: '香', A: 2, tauRise: tau.rise, tauFall: tau.fall }]
      }
    ]
  };
  e.applyMouth(cup, 0, T0);
  e.applyMouth(cup, 1, T0 + 2000);
  const evalRes = e.evaluateCup(cup, T0 + 2000);
  const v = evalRes.flavor.香;
  assert.ok(v < 3.5, `重叠不得相加，flavor.香=${v}`);
  assert.ok(v > 0.5, `应能尝到香，flavor.香=${v}`);

  const sameMouth = {
    id: 'same',
    claimedName: '同口',
    kind: 'custom',
    totalMouths: 1,
    totalVolume: 45,
    sources: [],
    mouths: [{
      volume: 45, abv: 0.4, beta: 1, startTime: null, applied: false,
      components: [
        { axis: '香', A: 1, tauRise: 8, tauFall: 35 },
        { axis: '香', A: 2, tauRise: 8, tauFall: 35 }
      ]
    }]
  };
  const e2 = engine();
  e2.applyMouth(sameMouth, 0, T0);
  const one = e2.evaluateCup(sameMouth, T0 + 8000);
  const onlyA2 = {
    id: 'a2',
    claimedName: 'a2',
    kind: 'custom',
    totalMouths: 1,
    totalVolume: 45,
    sources: [],
    mouths: [{
      volume: 45, abv: 0.4, beta: 1, startTime: null, applied: false,
      components: [{ axis: '香', A: 2, tauRise: 8, tauFall: 35 }]
    }]
  };
  const e3 = engine();
  e3.applyMouth(onlyA2, 0, T0);
  const two = e3.evaluateCup(onlyA2, T0 + 8000);
  assert.ok(one.flavor.香 > two.flavor.香 * 1.2, `同口应相加 ${one.flavor.香} vs ${two.flavor.香}`);
});

test('6 代谢下限与跨操作自动结算', () => {
  const e = engine();
  const cup = cloneCup(whiskey(), { kind: 'custom' });
  e.applyMouth(cup, 0, T0);
  e.applyMouth(cup, 1, T0 + 1000);
  const cFull = e.state.c;
  assert.ok(cFull > 2);
  e.evaluateCup(cup, T0 + 10 * 3600000);
  assert.equal(e.state.c, 0);
  const again = engine();
  const againCup = cloneCup(whiskey(), { kind: 'custom' });
  again.applyMouth(againCup, 0, T0);
  const c1 = again.state.c;
  again.applyMouth(againCup, 1, T0 + 2 * 3600000);
  assert.ok(again.state.c < c1 + mlToStandardDrinks(30, 0.43) + 1e-9);
  assert.ok(again.state.c >= 0);
});

test('7 多宿醉快照当前较小、以后反超时仍能成为 max', () => {
  const e = engine();
  e.state.lastSettle = T0;
  e.state.hangoverSnapshots = [
    { initial: 1.2, halfLifeHours: 4, startTime: T0 },
    { initial: 0.8, halfLifeHours: 20, startTime: T0 }
  ];
  const h0 = e.getHangover(T0);
  assert.ok(almost(h0, 1.2, 1e-9), `t0 max=${h0}`);
  const tLater = T0 + 8 * 3600000;
  const h1 = e.getHangover(tLater);
  assert.equal(e.state.hangoverSnapshots.length, 2);
  assert.ok(h1 > 0.5 && h1 < 0.7, `later max should be slower snap, got ${h1}`);
  assert.ok(h1 < h0);
});

test('8 比值 0/0 不生成措辞，分母 0 且分子大于 0 才是高端', () => {
  const e = engine();
  const water = buildFromParts('白开水', [{ id: '水', volume: 200 }], { kind: 'menu', totalMouths: 2 });
  e.applyMouth(water, 0, T0);
  const w = e.evaluateCup(water, T0 + 1000);
  assert.ok(Number.isNaN(w.ratios['甜/酸']));
  assert.equal(w.ratioWords['甜/酸'], null);

  const sweet = {
    id: 'sweet',
    claimedName: '甜',
    kind: 'custom',
    totalMouths: 1,
    totalVolume: 60,
    sources: [{
      id: '糖浆', volume: 60, volumeRatio: 1, colorTag: '透明', treePath: ['甜香', '糖'],
      flavor: { 烈: 0, 甜: 5, 酸: 0, 苦: 0, 香: 0, 涩: 0 }
    }],
    mouths: [{
      volume: 60, abv: 0, beta: 1, startTime: null, applied: false,
      components: [{ axis: '甜', A: 5, tauRise: 1, tauFall: 15 }]
    }]
  };
  const e2 = engine();
  e2.applyMouth(sweet, 0, T0);
  const s = e2.evaluateCup(sweet, T0 + 500);
  assert.equal(s.ratios['甜/酸'], Infinity);
  assert.equal(s.ratioWords['甜/酸'], '腻');
  assert.equal(computeRatio(0, 0).toString(), 'NaN');
});

test('9 三档 reset 的状态差异', () => {
  function primed() {
    const e = engine();
    const cup = cloneCup(whiskey(), { kind: 'custom' });
    e.applyMouth(cup, 0, T0);
    e.applyMouth(cup, 1, T0 + 1);
    e.state.eventPeak = 8;
    e.state.tonightPeak = 8;
    e.state.c = 8;
    e.state.beliefResiduals.push({
      cupId: cup.id, cumulative: { 愉悦: 1, 唤醒: 0, 亲近: 0, 守门: 0, 欲望: 0, 精度: 0 }, decayStart: null
    });
    e.state.records.push({ id: 'r1', time: T0, type: '喝下', drunk: true });
    e.state.tonightDelivered.push({ id: 'd1', time: T0, refused: true });
    return { e, cup };
  }

  const blocked = engine();
  const openCup = cloneCup(whiskey(), { kind: 'custom' });
  blocked.applyMouth(openCup, 0, T0);
  const denied = blocked.reset('醒酒', T0 + 100);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, '当前杯尚未结算');
  const control = engine();
  control.applyMouth(cloneCup(whiskey(), { kind: 'custom' }), 0, T0);
  control.settle(T0 + 100);
  assert.equal(blocked.state.c, control.state.c);
  assert.equal(blocked.state.currentCup.remainingMouths, 1);
  assert.equal(blocked.state.currentCup.closed, false);

  const a = primed();
  a.e.reset('醒酒', T0 + 100);
  assert.equal(a.e.state.c, 0);
  assert.equal(a.e.state.eventPeak, 0);
  assert.equal(a.e.state.tonightPeak, 0);
  assert.equal(a.e.state.beliefResiduals.length, 0);
  assert.ok(a.e.state.hangoverSnapshots.length >= 1);
  assert.ok(a.e.state.tasteCurves.length >= 1);
  assert.ok(a.e.state.records.some((r) => r.id === 'r1'));
  // 迁移：活性成分归零后即删键，不留 { amount: 0 } 残骸。
  // 断言语义不变——reset 之后咖啡因必须为 0。
  assert.equal(activeAmount(a.e.state.actives, '咖啡因'), 0);

  const b = primed();
  b.e.reset('连宿醉一起清', T0 + 100);
  assert.equal(b.e.state.c, 0);
  assert.equal(b.e.state.hangoverSnapshots.length, 0);
  assert.ok(b.e.state.tasteCurves.length >= 1);
  assert.ok(b.e.state.records.some((r) => r.id === 'r1'));

  const c = primed();
  c.e.reset('这晚不算', T0 + 100);
  assert.equal(c.e.state.c, 0);
  assert.equal(c.e.state.hangoverSnapshots.length, 0);
  assert.equal(c.e.state.currentCup, null);
  assert.equal(c.e.state.tasteCurves.length, 0);
  assert.ok(!c.e.state.records.some((r) => r.id === 'r1'));
  assert.ok(!c.e.state.tonightDelivered.some((r) => r.id === 'd1'));
});

test('10 吐的上穿边沿只触发一次', () => {
  const e = engine();
  const cup = buildFromParts('灌', [{ id: '伏特加', volume: 400 }], { totalMouths: 2, kind: 'custom' });
  const r0 = e.applyMouth(cup, 0, T0);
  const r1 = e.applyMouth(cup, 1, T0 + 1);
  const vomits = [...r0.events, ...r1.events].filter((x) => x.type === '吐');
  assert.equal(vomits.length, 1);
  assert.equal(vomits[0].safetyNote, SAFETY_NOTE);
  assert.equal(vomits[0].haltClient, false);
  assert.equal(vomits[0].haltEngine, false);
  e.state.c = 9;
  e.state.vomitArmed = true;
  const cup2 = buildFromParts('再灌', [{ id: '伏特加', volume: 80 }], { totalMouths: 2, kind: 'custom' });
  const r2 = e.applyMouth(cup2, 0, T0 + 2);
  assert.equal(r2.events.filter((x) => x.type === '吐').length, 1);
});

test('11 宕机概率用注入随机源分别覆盖触发与不触发', () => {
  const roots = [
    ['烟', '泥煤'],
    ['果', '柑橘'],
    ['草本', '杜松'],
    ['谷物', '米'],
    ['苦', '龙胆']
  ];
  const sources = roots.map((treePath, i) => ({
    id: `s${i}`,
    volume: 20,
    volumeRatio: 0.2,
    colorTag: '红',
    treePath,
    flavor: { 烈: 2, 甜: 1, 酸: 1, 苦: 1, 香: 2, 涩: 1 }
  }));
  const D = computeDiscreteness(sources);
  assert.ok(D >= 0.8, `D=${D}`);
  const cupOf = () => buildFromParts('怪', [
    { id: '威士忌', volume: 20 },
    { id: '金巴利', volume: 20 },
    { id: '青柠汁', volume: 20 },
    { id: '啤酒', volume: 20 },
    { id: '浓缩咖啡', volume: 20 },
    { id: '红葡萄酒', volume: 20 }
  ], { totalMouths: 2, kind: 'custom' });

  const hit = engine({ random: () => 0.1 });
  const miss = engine({ random: () => 0.9 });
  const a = hit.applyMouth(cupOf(), 0, T0);
  const b = miss.applyMouth(cupOf(), 0, T0);
  const dHit = computeDiscreteness(cupOf().sources);
  if (dHit >= 0.8) {
    assert.equal(a.events.filter((x) => x.type === '宕机').length, 1);
    assert.equal(b.events.filter((x) => x.type === '宕机').length, 0);
  } else {
    const custom = {
      id: 'crash',
      claimedName: '怪',
      kind: 'custom',
      totalMouths: 2,
      totalVolume: 120,
      sources,
      mouths: [
        { volume: 60, abv: 0.4, beta: 1, startTime: null, applied: false, components: [], suggestion: null },
        { volume: 60, abv: 0.4, beta: 1, startTime: null, applied: false, components: [], suggestion: null }
      ]
    };
    const a2 = engine({ random: () => 0.1 }).applyMouth(structuredClone(custom), 0, T0);
    const b2 = engine({ random: () => 0.9 }).applyMouth(structuredClone(custom), 0, T0);
    assert.equal(a2.events.filter((x) => x.type === '宕机').length, 1);
    assert.equal(b2.events.filter((x) => x.type === '宕机').length, 0);
    assert.equal(a2.events[0].safetyNote, SAFETY_NOTE);
  }
});

test('12 失禁生产输出始终带安全旁白', () => {
  const v = produceVomitEvent();
  const c = produceCrashEvent();
  assert.equal(v.safetyNote, SAFETY_NOTE);
  assert.equal(c.safetyNote, SAFETY_NOTE);
  assert.match(v.safetyNote, /旁白/);
  assert.match(c.safetyNote, /模拟/);
  const e = engine();
  const cup = buildFromParts('灌', [{ id: '伏特加', volume: 400 }], { totalMouths: 2, kind: 'custom' });
  const r0 = e.applyMouth(cup, 0, T0);
  const r1 = e.applyMouth(cup, 1, T0 + 1);
  const incontinence = [...r0.events, ...r1.events].filter((x) => x.type === '吐' || x.type === '宕机');
  assert.ok(incontinence.length >= 1);
  for (const ev of incontinence) {
    assert.ok(ev.safetyNote);
    assert.match(ev.safetyNote, /旁白|模拟/);
    assert.equal(ev.haltClient, false);
  }
});

test('13 export → 新实例 restore 后状态与后续求值一致', () => {
  const e = engine();
  const cup = whiskey();
  e.applyMouth(cup, 0, T0);
  e.applyMouth(cup, 1, T0 + 10);
  const snap = e.exportState();
  const json = JSON.stringify(snap);
  const e2 = ProofEngine.restoreState(json, realPack);
  const a = e.evaluateCup(cup, T0 + 10);
  const b = e2.evaluateCup(e2.state.currentCup, T0 + 10);
  assert.ok(almost(a.c, b.c, 1e-9));
  assert.ok(almost(a.state.愉悦, b.state.愉悦, 1e-9));
  assert.equal(e2.state.beliefResiduals.length, e.state.beliefResiduals.length);
  e2.settle(T0 + 10 + 3600000);
  e.settle(T0 + 10 + 3600000);
  assert.ok(almost(e.state.c, e2.state.c, 1e-9));
});

test('14 未来尚未入口的 mouth 不得参与当前味觉投影', () => {
  const e = engine();
  const cup = whiskey();
  e.applyMouth(cup, 0, T0);
  const now = T0 + 5000;
  const evalRes = e.evaluateCup(cup, now);
  assert.equal(cup.mouths[1].startTime, null);
  const onlyFirst = flavorPeakForMouth(cup.mouths[0], '烈');
  assert.ok(evalRes.flavor.烈 > 0);
  const both = engine();
  const cup2 = whiskey();
  both.applyMouth(cup2, 0, T0);
  both.applyMouth(cup2, 1, T0);
  const evalBoth = both.evaluateCup(cup2, now);
  assert.ok(evalRes.intermediates[5].in.mouths.length === 1);
  assert.ok(evalBoth.intermediates[5].in.mouths.length === 2);
});

test('15 敏感度只改变指定轴，且必须挂饮用记录 id', () => {
  const e = engine();
  const cup = whiskey();
  const r0 = e.applyMouth(cup, 0, T0);
  const r = e.applyMouth(cup, 1, T0 + 1);
  const before = { ...e.state.sensitivity };
  const denied = e.updateSensitivity(null, '苦', '冲', T0);
  assert.equal(denied.ok, false);
  const denied2 = e.updateSensitivity('no-such', '苦', '冲', T0);
  assert.equal(denied2.ok, false);
  const flavorDenied = e.updateSensitivity(r.drinkRecordId, '香', '冲', T0);
  assert.equal(flavorDenied.ok, false);
  const ok = e.updateSensitivity(r.drinkRecordId, '精度', '冲', T0);
  assert.equal(ok.ok, true);
  assert.equal(ok.queued, undefined);
  assert.ok(almost(e.state.sensitivity.精度, before.精度 + 0.1, 1e-9));
  for (const axis of Object.keys(before)) {
    if (axis === '精度') continue;
    assert.equal(e.state.sensitivity[axis], before[axis]);
  }
  assert.ok(r0.drinkRecordId);
});

test('非固定酒逐口酒精：60ml 43% 两口合计 2.03562，不得再除口数', () => {
  const e = engine();
  const cup = cloneCup(whiskey(), { kind: 'custom' });
  const r0 = e.applyMouth(cup, 0, T0);
  const r1 = e.applyMouth(cup, 1, T0 + 1);
  assert.ok(almost(r0.alcohol, WHISKEY_TOTAL / 2, 1e-9), `per mouth ${r0.alcohol}`);
  assert.ok(almost(r0.alcohol + r1.alcohol, WHISKEY_TOTAL, 1e-9));
  assert.ok(almost(e.state.c, 2.03562, 1e-5), `c=${e.state.c}`);
  const after = e.evaluateCup(cup, T0 + 1);
  assert.ok(almost(after.c, 2.03562, 1e-5));
  assert.ok(almost(after.chat, 2.03562, 1e-5));
});

test('内容包 standardDrinks 由公式计算，威士忌/伏特加/啤酒不再是错误常量', () => {
  const w = realPack.menu.find((m) => m.claimedName === '威士忌');
  const v = realPack.menu.find((m) => m.claimedName === '伏特加');
  const b = realPack.menu.find((m) => m.claimedName === '啤酒');
  assert.ok(almost(w.standardDrinks, 2.03562, 1e-4), `威士忌 ${w.standardDrinks}`);
  assert.ok(almost(v.standardDrinks, 1.4202, 1e-3), `伏特加 ${v.standardDrinks}`);
  assert.ok(almost(b.standardDrinks, 1.30185, 1e-3), `啤酒 ${b.standardDrinks}`);
});

test('迷情剂的登记效果现在是实际酒款性格，不预烘焙成名字信念', () => {
  assert.ok(potion.baseVector.欲望 > 0);
  assert.ok(potion.characterEffects.欲望 > 0);
  assert.equal(potion.characterIdentity, '迷情剂');
  assert.equal(potion.mouths[0].suggestion, null);
});
