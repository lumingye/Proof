import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { engine, T0 } from './helpers.js';
import { potion, menuItem, cloneCup, buildFromParts, realPack } from '../src/content/realPack.js';
import {
  hashUnit,
  heavenEligible,
  assembleClashingFlavorDescription,
  HEAVEN_MIN_ABV,
  HEAVEN_ELIGIBILITY_STATUS,
  HIDDEN_BLACK_NAME,
  HIDDEN_HEAVEN_NAME
} from '../src/core/hiddenDraw.js';
import { CUP_CAPACITY_ML } from '../src/core/appearance.js';
import { publicEffectDescription, assembleEffectDescription } from '../src/core/effects.js';
import { ZERO_EFFECT_TEXT, ZERO_EFFECT_COPY_STATUS } from '../src/core/constants.js';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { BLACKOUT_RECOVER_MS } from '../src/core/constants.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';
const HERE = dirname(fileURLToPath(import.meta.url));

test('REPAIR 迷情剂：特调分组、容量、不参与隐藏抽卡、喝前不泄露喝后登记味道', () => {
  const item = menuItem('迷情剂');
  assert.equal(item.category, 'custom');
  assert.ok(item.listed);
  const cap = CUP_CAPACITY_ML[item.cupType];
  assert.ok(cap, `cupType=${item.cupType}`);
  assert.ok(item.totalVolume <= cap, `${item.totalVolume} > ${cap} ${item.cupType}`);
  const e = engine({ hiddenHashUnit: () => 0 });
  const id = e.createOffer(cloneCup(item), MIXER, MIXER, DRINKER, T0);
  assert.equal(e.offers.get(id).claimedName, '迷情剂');
  assert.equal(e.offers.get(id).cup.hiddenDraw.hit, false);
  assert.equal(e.offers.get(id).cup.hiddenDraw.source, 'menu');
  const first = e.viewOffer(id, DRINKER, T0).projection;
  assert.equal(JSON.stringify(first).includes('甘甜与香气'), false);
  assert.equal(JSON.stringify(first).includes('有点发烫'), false);
  const drunk = e.drinkOffer(id, DRINKER, 'p1', T0);
  assert.equal(drunk.projection.flavorDescription, '比普通的水似乎多了一丝甘甜与香气。');
  assert.equal(drunk.projection.finish, '想喝什么自己加。');
});

test('REPAIR EFFECT-005 平淡名信念为零；改配方不改信念；暗示名只用声明', () => {
  const e = engine();
  const pack = {
    ...realPack,
    reactionCurve: () => ({ 亲近: 0, 守门: 0, 欲望: 0 }),
    adoptionWeights: { 愉悦: 1, 唤醒: 1, 亲近: 1, 守门: 1, 欲望: 1, 精度: 0 }
  };
  const a = new ProofEngine(null, pack);
  const plainA = buildFromParts('一杯水', [{ id: '水', volume: 200 }], {
    kind: 'custom', totalMouths: 2, effects: { 欲望: 5, 愉悦: 4 }
  });
  a.sipAll(plainA, T0);
  assert.ok(Math.abs(a.evaluateCup(plainA, T0).beliefStrength.欲望) < 1e-9);

  const b = new ProofEngine(null, pack);
  const plainB = buildFromParts('一杯水', [{ id: '伏特加', volume: 45 }], {
    kind: 'custom', totalMouths: 2, effects: { 欲望: 5 }
  });
  b.sipAll(plainB, T0);
  assert.ok(Math.abs(b.evaluateCup(plainB, T0).beliefStrength.欲望) < 1e-9);
  assert.ok(b.state.c > 0);

  const c = new ProofEngine(null, pack);
  const named = buildFromParts('威士忌', [{ id: '水', volume: 60 }], { kind: 'custom', totalMouths: 2, beta: 1 });
  c.sipAll(named, T0);
  assert.ok(c.evaluateCup(named, T0).beliefStrength.守门 > 0);
});

test('REPAIR EFFECT-006 零效果返回明确句子且不丢字段', () => {
  assert.equal(ZERO_EFFECT_COPY_STATUS, 'COPY_PENDING_USER_REVIEW');
  const zero = publicEffectDescription(assembleEffectDescription({
    愉悦: 0, 唤醒: 0, 精度: 0, 亲近: 0, 守门: 0, 欲望: 0
  }, realPack.effectLexicon));
  assert.equal(zero.text, ZERO_EFFECT_TEXT);
  const e = engine();
  const id = e.createOffer(cloneCup(menuItem('白开水')), MIXER, MIXER, DRINKER, T0);
  const r = e.drinkOffer(id, DRINKER, 'zero', T0);
  assert.ok(r.projection.actualEffectDescription);
  assert.equal(r.projection.actualEffectDescription.text, ZERO_EFFECT_TEXT);
});

test('REPAIR EFFECT-008 公开 createOffer 不能凭名字直接创建隐藏酒', () => {
  const e = engine({ hiddenHashUnit: () => 0.99 });
  const fake = buildFromParts('heaven', [{ id: '水', volume: 200 }], { kind: 'custom', listed: false, totalMouths: 2 });
  const id = e.createOffer(fake, MIXER, MIXER, DRINKER, T0);
  assert.notEqual(e.offers.get(id).claimedName, HIDDEN_HEAVEN_NAME);
  assert.equal(e.offers.get(id).cup.hiddenDraw.hit, false);

  const namedBlack = buildFromParts(HIDDEN_BLACK_NAME, [{ id: '水', volume: 80 }], { kind: 'custom', listed: false, totalMouths: 2 });
  const id2 = e.createOffer(namedBlack, MIXER, MIXER, DRINKER, T0);
  assert.notEqual(e.offers.get(id2).claimedName, HIDDEN_BLACK_NAME);
});

test('REPAIR 黑味道随配方变化，且不输出轴表', () => {
  const a = assembleClashingFlavorDescription({ 烈: 4, 酸: 3, 苦: 2, 甜: 0, 香: 0, 涩: 0 });
  const b = assembleClashingFlavorDescription({ 甜: 4, 香: 3, 涩: 2, 烈: 0, 酸: 0, 苦: 0 });
  assert.notEqual(a, b);
  assert.ok(a.includes('打架'));
  assert.ok(b.includes('打架'));
  assert.equal(a.includes('烈 +'), false);
  const e = engine({ hiddenHashUnit: () => 0, random: () => 0 });
  const mixA = buildFromParts('杂A', [
    { id: '威士忌', volume: 20 }, { id: '金巴利', volume: 20 }, { id: '青柠汁', volume: 20 },
    { id: '啤酒', volume: 20 }, { id: '浓缩咖啡', volume: 20 }, { id: '红葡萄酒', volume: 20 }
  ], { kind: 'custom', listed: false, totalMouths: 2 });
  const mixB = buildFromParts('杂B', [
    { id: '金酒', volume: 20 }, { id: '金巴利', volume: 20 }, { id: '柠檬汁', volume: 20 },
    { id: '啤酒', volume: 20 }, { id: '糖浆', volume: 20 }, { id: '红葡萄酒', volume: 20 }
  ], { kind: 'custom', listed: false, totalMouths: 2 });
  const idA = e.createOffer(mixA, MIXER, MIXER, DRINKER, T0);
  const e2 = engine({ hiddenHashUnit: () => 0, random: () => 0 });
  const idB = e2.createOffer(mixB, MIXER, MIXER, DRINKER, T0);
  assert.equal(e.offers.get(idA).claimedName, HIDDEN_BLACK_NAME);
  assert.equal(e2.offers.get(idB).claimedName, HIDDEN_BLACK_NAME);
  const tA = e.drinkOffer(idA, DRINKER, 'ba', T0).projection.flavorDescription;
  const tB = e2.drinkOffer(idB, DRINKER, 'bb', T0).projection.flavorDescription;
  assert.notEqual(tA, tB);
  assert.ok(tA.includes('打架'));
});

test('REPAIR Heaven 资格 CONFIRMED：入杯成分均 ≥35%，冰/水失去资格', () => {
  assert.equal(HEAVEN_ELIGIBILITY_STATUS, 'CONFIRMED');
  assert.equal(HEAVEN_MIN_ABV, 0.35);
  const neat = buildFromParts('烈', [{ id: '伏特加', volume: 100 }], { kind: 'custom' });
  assert.equal(heavenEligible(neat), true);
  const iced = buildFromParts('烈冰', [{ id: '伏特加', volume: 100 }, { id: '冰', volume: 10 }], { kind: 'custom' });
  assert.equal(heavenEligible(iced), false);
  const watered = buildFromParts('兑', [{ id: '伏特加', volume: 80 }, { id: '水', volume: 10 }], { kind: 'custom' });
  assert.equal(heavenEligible(watered), false);
});

test('REPAIR 断片可关闭；到期后恢复可读且不删记录', () => {
  const off = engine({ blackoutEnabled: false });
  const cup = buildFromParts('灌', [{ id: '伏特加', volume: 400 }], { totalMouths: 2, kind: 'custom' });
  off.applyMouth(cup, 0, T0);
  off.applyMouth(cup, 1, T0 + 1);
  assert.ok((off.state.fragmentBatches || []).every((b) => b.readable !== false) || off.state.fragmentBatches.length === 0);

  const on = engine({ blackoutRecoverMs: BLACKOUT_RECOVER_MS });
  const cup2 = buildFromParts('灌2', [{ id: '伏特加', volume: 400 }], { totalMouths: 2, kind: 'custom' });
  on.applyMouth(cup2, 0, T0);
  on.applyMouth(cup2, 1, T0 + 1);
  on.settle(T0 + 2 * 3600000);
  assert.ok(on.state.c < 8);
  const closed = on.state.fragmentBatches.find((b) => b.end != null);
  assert.ok(closed);
  assert.equal(closed.readable, false);
  const rec = on.state.records.length;
  on.settle(T0 + 2 * 3600000 + BLACKOUT_RECOVER_MS);
  assert.equal(on.state.fragmentBatches.find((b) => b.start === closed.start).readable, true);
  assert.equal(on.state.records.length, rec);
});

test('REPAIR hiddenDraw.js 不依赖 node:crypto，hash 对同一 cupId 稳定', () => {
  const src = readFileSync(join(HERE, '../src/core/hiddenDraw.js'), 'utf8');
  assert.equal(/from ['"]node:crypto['"]/.test(src), false);
  assert.equal(/require\(['"]crypto['"]\)/.test(src), false);
  assert.equal(hashUnit('same-id'), hashUnit('same-id'));
});

test('REPAIR 精度登记与文档不得宣称正向精度', () => {
  for (const drink of realPack.menu) {
    assert.ok((drink.effects?.精度 || 0) <= 0, drink.claimedName);
  }
  const sheet = readFileSync(join(HERE, '../../docs/content/酒单.md'), 'utf8');
  assert.ok(sheet.includes('精度只有负向'));
  assert.equal(sheet.includes('精度 + · 唤醒 + · 愉悦 −'), false);
});
