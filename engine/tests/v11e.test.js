import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, whiskey, T0, almost } from './helpers.js';
import { buildFromParts, effectLexicon, menuItem, cloneCup } from '../src/content/realPack.js';
import { parseShorthand, phraseTier, resolveClaimedEffects, computeCupEffect, snapshotEffectBaseline } from '../src/core/effects.js';
import { caffeineOfParts, caffeineToPhysiology, metabolizeCaffeine } from '../src/core/active.js';
import { ingredients } from '../src/content/realPack.js';
import { crashEligible } from '../src/core/failure.js';
import { computeDiscreteness, countSignificantSources } from '../src/core/flavor.js';
import { SHORTHAND } from '../src/core/constants.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';

test('E1 简写 ++ / + / − / −− 映射到 ±4.5 / ±2.5', () => {
  assert.equal(parseShorthand('++'), 4.5);
  assert.equal(parseShorthand('+'), 2.5);
  assert.equal(parseShorthand('−'), -2.5);
  assert.equal(parseShorthand('−−'), -4.5);
  assert.equal(parseShorthand('--'), SHORTHAND['--']);
  assert.equal(parseShorthand(1.7), 1.7);
  assert.equal(phraseTier(0.5), '低');
  assert.equal(phraseTier(1.6), '中');
  assert.equal(phraseTier(2.4), '中');
  assert.equal(phraseTier(3.5), '高');
});

test('E2 Espresso Martini 咖啡因总量 1.33 份，落到 ml', () => {
  const k = caffeineOfParts(
    [{ id: '伏特加', volume: 40 }, { id: '咖啡利口酒', volume: 20 }, { id: '浓缩咖啡', volume: 30 }],
    ingredients
  );
  assert.ok(almost(k, 1.333333, 1e-5), `k=${k}`);
  const cup = menuItem('Espresso Martini');
  assert.ok(almost(cup.caffeineTotal, 1.333333, 1e-5));
});

test('E3 自调 β=0 的 Espresso Martini 仍能推愉悦与唤醒，推不动精度', () => {
  const e = engine();
  const cup = cloneCup(menuItem('Espresso Martini'), { beta: 0, kind: 'custom' });
  e.sipAll(cup, T0);
  const k = e.state.actives.咖啡因.amount;
  assert.ok(almost(k, 1.333333, 1e-5), `k=${k}`);
  const cafe = caffeineToPhysiology(k);
  const ev = e.evaluate(T0);
  assert.ok(ev.physiology.唤醒 > cafe.唤醒 * 0.5);
  assert.equal(ev.k, k);
  const alcoholPhysPrecision = ev.physiology.精度;
  assert.ok(alcoholPhysPrecision <= 0);
  assert.equal(cafe.精度, 0);
  assert.equal(cafe.亲近, 0);
  assert.equal(cafe.守门, 0);
  assert.equal(cafe.欲望, 0);
});

test('E4 咖啡因半衰期 5h，归零阈值 0.05，不与酒精共用 lastSettle', () => {
  assert.ok(almost(metabolizeCaffeine(1, 5), 0.5, 1e-9));
  assert.equal(metabolizeCaffeine(0.04, 0), 0);
  const e = engine();
  const cup = cloneCup(menuItem('Espresso Martini'), { beta: 0, kind: 'custom' });
  e.sipAll(cup, T0);
  const k0 = e.state.actives.咖啡因.amount;
  const c0 = e.state.c;
  e.settle(T0 + 5 * 3600000);
  assert.ok(almost(e.state.actives.咖啡因.amount, k0 / 2, 1e-6), `k=${e.state.actives.咖啡因.amount}`);
  assert.ok(e.state.c < c0);
  assert.equal(e.state.actives.咖啡因.lastSettle, T0 + 5 * 3600000);
  assert.equal(e.state.lastSettle, T0 + 5 * 3600000);
});

test('E5 70 分钟过期后未喝口不进 k', () => {
  const e = engine();
  const cup = cloneCup(menuItem('Espresso Martini'), { beta: 0, totalMouths: 2, kind: 'custom' });
  e.applyMouth(cup, 0, T0);
  const kHalf = e.state.actives.咖啡因.amount;
  e.settle(T0 + 71 * 60 * 1000);
  assert.ok(e.state.currentCup.expired);
  assert.ok(almost(e.state.actives.咖啡因.amount, metabolizeCaffeine(kHalf, 71 / 60), 1e-6));
  assert.ok(e.state.actives.咖啡因.amount < cup.caffeineTotal);
});

test('E6 第一屏 claimedEffects 是声称向量，不是真实求值', () => {
  const e = engine();
  const water = buildFromParts('一杯水', [{ id: '水', volume: 200 }], {
    kind: 'custom', totalMouths: 2, effects: null
  });
  const idWater = e.createOffer(water, MIXER, MIXER, DRINKER, T0);
  // 饮用方喝前不给 claimedEffects；调制者仍能看到自己登记的声称向量。
  const pWater = e.viewOffer(idWater, DRINKER, T0).projection;
  assert.ok(!('claimedEffects' in pWater));
  const mWater = e.viewOffer(idWater, MIXER, T0).projection;
  assert.equal(Object.values(mWater.claimedEffects).every((v) => !v), true);
  assert.ok(!('effects' in pWater));

  const whiskeyId = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const pW = e.viewOffer(whiskeyId, DRINKER, T0).projection;
  assert.ok(!('claimedEffects' in pW));
  assert.deepEqual(e.viewOffer(whiskeyId, MIXER, T0).projection.claimedEffects, { 守门: 2, 唤醒: -1, 亲近: 1 });
  assert.ok(!('physiology' in pW));
  assert.ok(!('actualEffectDescription' in pW));
});

test('E7 反事实差值讲的是这一杯，不是昨天的醉', () => {
  const e = engine();
  const drunk = buildFromParts('灌', [{ id: '伏特加', volume: 400 }], { totalMouths: 2, kind: 'custom' });
  e.sipAll(drunk, T0);
  const beforeCoffee = e.evaluate(T0).state;
  const baseline = snapshotEffectBaseline(e.state, T0);
  const coffee = cloneCup(menuItem('Espresso Martini'), { beta: 0, kind: 'custom' });
  e.sipAll(coffee, T0 + 1000);
  const internal = computeCupEffect(
    e.state, baseline, e.state.currentCup, T0 + 1000, e.contentPack
  );
  assert.ok(internal.delta.唤醒 > 0, `Δ唤醒=${internal.delta.唤醒}`);
  assert.ok(Math.abs(internal.delta.精度) < Math.abs(beforeCoffee.精度) * 0.5 + 0.2);
  assert.ok(internal.phrases.every((p) => p.axis !== '精度' || p.direction === '−' || p.direction === '-'));
  const pub = e.state.currentCup.actualEffectDescription;
  assert.deepEqual(Object.keys(pub), ['text']);
  assert.equal(typeof pub.text, 'string');
});

test('E8 喝完才出现 actualEffectDescription，且只给当事人', () => {
  const e = engine();
  const id = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const first = e.viewOffer(id, DRINKER, T0).projection;
  assert.ok(!('actualEffectDescription' in first));
  const r = e.drinkOffer(id, DRINKER, 'r1', T0);
  assert.ok(r.projection.actualEffectDescription);
  const mixer = e.viewOffer(id, MIXER, T0).projection;
  const drinker = e.viewOffer(id, DRINKER, T0).projection;
  assert.ok(drinker.actualEffectDescription);
  assert.ok(mixer.actualEffectDescription);
  const other = e.viewOffer(id, 'other', T0).projection;
  assert.ok(!('actualEffectDescription' in other));
});

test('E9 固定酒不走配方混杂宕机；同配方作为非固定酒仍可触发', () => {
  const neo = menuItem('尼格罗尼');
  const gt = menuItem('金汤力');
  const li = menuItem('长岛冰茶');
  const dN = computeDiscreteness(neo.sources);
  const dG = computeDiscreteness(gt.sources);
  const dL = computeDiscreteness(li.sources);
  assert.ok(dN >= 0.8, `negroni D=${dN}`);
  assert.ok(dG >= 0.8, `gt D=${dG}`);
  assert.equal(countSignificantSources(neo.sources) < 5, true);
  assert.equal(countSignificantSources(gt.sources) < 5, true);
  assert.ok(countSignificantSources(li.sources) >= 5);
  assert.equal(crashEligible({
    D: dN, significantCount: countSignificantSources(neo.sources),
    standardDrinks: neo.standardDrinks, volumeMl: neo.totalVolume
  }), false);
  assert.equal(crashEligible({
    D: dG, significantCount: countSignificantSources(gt.sources),
    standardDrinks: gt.standardDrinks, volumeMl: gt.totalVolume
  }), false);
  assert.equal(crashEligible({
    D: dL, significantCount: countSignificantSources(li.sources),
    standardDrinks: li.standardDrinks, volumeMl: li.totalVolume
  }), true);

  const fixedEngine = engine({ random: () => 0.1 });
  const hit = engine({ random: () => 0.1 });
  const miss = engine({ random: () => 0.9 });
  const fixed = fixedEngine.applyMouth(structuredClone(li), 0, T0);
  assert.equal(fixed.events.filter((x) => x.type === '宕机').length, 0);
  const customLi = structuredClone(li); customLi.kind = 'custom';
  const a = hit.applyMouth(customLi, 0, T0 + 1);
  const missLi = structuredClone(li); missLi.kind = 'custom';
  const b = miss.applyMouth(missLi, 0, T0);
  assert.equal(a.events.filter((x) => x.type === '宕机').length, 1);
  assert.equal(b.events.filter((x) => x.type === '宕机').length, 0);
});

test('E10 一杯未结束不得喝第二杯，可以收第一屏', () => {
  const e = engine();
  const cup = whiskey();
  e.applyMouth(cup, 0, T0);
  const id2 = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const view = e.viewOffer(id2, DRINKER, T0);
  assert.equal(view.ok, true);
  const drink = e.drinkOffer(id2, DRINKER, 'r2', T0);
  assert.equal(drink.ok, false);
  assert.equal(drink.error, '一杯未结束前不得开始喝第二杯');
  assert.equal(e.state.cupsDrunk, 0);
});

test('E11 本杯期间敏感度反馈只排队，结算后一次施加', () => {
  const e = engine();
  const cup = whiskey();
  const r = e.applyMouth(cup, 0, T0);
  const before = e.state.sensitivity.守门;
  const q = e.updateSensitivity(r.drinkRecordId, '守门', '淡', T0);
  assert.equal(q.queued, true);
  assert.equal(e.state.sensitivity.守门, before);
  assert.equal(e.state.pendingSensitivity.length, 1);
  e.applyMouth(cup, 1, T0 + 1);
  assert.equal(e.state.pendingSensitivity.length, 0);
  assert.ok(almost(e.state.sensitivity.守门, before - 0.1, 1e-9));
});

test('E12 export/restore 保留 k、基线与待处理队列', () => {
  const e = engine();
  const cup = cloneCup(menuItem('Espresso Martini'), { beta: 0, totalMouths: 2, kind: 'custom' });
  const r = e.applyMouth(cup, 0, T0);
  e.updateSensitivity(r.drinkRecordId, '唤醒', 'up', T0);
  const json = JSON.stringify(e.exportState());
  const e2 = e.constructor.restoreState(json, e.contentPack);
  assert.ok(almost(e2.state.actives.咖啡因.amount, e.state.actives.咖啡因.amount, 1e-9));
  assert.ok(e2.state.effectBaseline);
  assert.equal(e2.state.pendingSensitivity.length, 1);
  e2.applyMouth(e2.state.currentCup, 1, T0 + 1);
  assert.equal(e2.state.pendingSensitivity.length, 0);
});

test('E13 白开水第一屏不显示声称效果', () => {
  const vec = resolveClaimedEffects({ claimedName: '白开水', effects: null });
  assert.equal(vec, null);
});

test('E14 公开效果词库恰好 33 条，精度只有负向', () => {
  const entries = [];
  for (const [axis, directions] of Object.entries(effectLexicon)) {
    for (const [direction, tiers] of Object.entries(directions)) {
      for (const [tier, text] of Object.entries(tiers)) {
        entries.push({ axis, direction, tier, text });
      }
    }
  }
  assert.equal(entries.length, 33);
  assert.deepEqual(Object.keys(effectLexicon.精度), ['−']);
  assert.ok(entries.every((x) => ['低', '中', '高'].includes(x.tier)));
  assert.ok(entries.every((x) => typeof x.text === 'string' && x.text.trim().length > 0));
  assert.equal(effectLexicon.愉悦['+'].低.includes('喉咙里那口气'), true);
});
