import test from 'node:test';
import assert from 'node:assert/strict';
import {
  realPack, menu, menuItem, potion, fourWaters, hiddenHeaven, hiddenBlack,
  ingredients, effectLexicon, buildFromParts, cloneCup
} from '../../src/content/realPack.js';
import { computeDiscreteness, countSignificantSources } from '../../src/core/flavor.js';
import { STATE_AXES } from '../../src/core/constants.js';
import { describeCupEffect } from '../../src/core/effects.js';
import { auditEngine, AUDIT_T0, listedMenu, allContentCups, drinkAll, axisRangeOk, almost } from './helpers.audit.js';

const NING_BLACK_INTRO = '一杯深色的液体，你说不好究竟是什么颜色，它有着黑的深邃和彩色的斑斓。';
const NING_BLACK_EFFECT = '入口的味道是复杂的，酸甜苦辣咸都拧成了一团，你觉得好像酒液在打你。\n你的胃皱了起来，你伸手去扶桌沿——';
const NING_HEAVEN_INTRO = '这是一杯透明的酒，可是又不像水那么空——你好像能从里面看到星光。';
const NING_HEAVEN_EFFECT = '辛辣，火从它接触过的地方烧了起来。\n你的大脑中一片空白，身边的人，或者神，在用奇怪的语言说着什么，\n你感觉到宇宙在你的身体里膨胀，膨胀——';

test('AUDIT-4.1 明面菜单全部可枚举，无未解释漏项', () => {
  const names = listedMenu().map((m) => m.claimedName);
  // 白朗姆此前只有原料没有酒款条目（「点不到、也没有效果」），2026-09-02 补入。
  const expected = ['威士忌', '龙舌兰', '伏特加', '白朗姆', '黑朗姆', '金酒', '清酒', '啤酒', '红葡萄酒', '苦艾酒', '马天尼', '尼格罗尼', '金汤力', '玛格丽特', '长岛冰茶', 'Espresso Martini', '白开水', '迷情剂'];
  assert.equal(names.length, expected.length);
  for (const n of expected) assert.ok(names.includes(n), `missing ${n}`);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dup, []);
});

test('AUDIT-4.2 原料活性字段单位落到 ml；缺字段视为无活性', () => {
  const ids = Object.keys(ingredients);
  assert.ok(ids.length >= 20);
  const lower = ids.map((x) => x.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, 'case-split ingredient ids');
  const actives = [];
  for (const [id, ing] of Object.entries(ingredients)) {
    assert.equal(typeof ing.abv, 'number');
    assert.ok(ing.abv >= 0 && ing.abv <= 1, `${id} abv`);
    if (ing.activeIngredient) {
      assert.ok(ing.referenceVolumeMl > 0, `${id} referenceVolumeMl`);
      assert.equal(typeof ing.activeAmount, 'number');
      actives.push(id);
    }
  }
  assert.ok(actives.includes('浓缩咖啡'));
  assert.ok(actives.includes('咖啡利口酒'));
  assert.equal(ingredients.水.activeIngredient, undefined);
  assert.equal(ingredients.冰.activeIngredient, undefined);
  assert.equal(ingredients.糖浆.activeIngredient, undefined);
});

test('AUDIT-4.3 角色配置只给曲线与权重，不含行为脚本', () => {
  const curve = realPack.reactionCurve(1);
  for (const axis of ['亲近', '守门', '欲望']) assert.equal(typeof curve[axis], 'number');
  assert.equal(realPack.adoptionWeights.精度, 0);
  const blob = JSON.stringify(realPack.reactionCurve.toString()) + JSON.stringify(realPack.adoptionWeights);
  assert.equal(blob.includes('必须说话'), false);
  assert.equal(realPack.stateInjection, false);
});

test('AUDIT-16 迷情剂是可点登记特调，配方水+冰，不是隐藏酒', () => {
  const item = menuItem('迷情剂');
  assert.ok(item, '迷情剂 missing from menu');
  assert.equal(item.listed, true);
  assert.notEqual(item.kind, 'unlisted');
  const ids = [...new Set(item.recipe.map((p) => p.id))].sort();
  assert.deepEqual(ids, ['冰', '水']);
  assert.equal(item.recipe.some((p) => p.id === '苏打水'), false);
  const e = auditEngine();
  const names = e.publicMenu().map((m) => m.claimedName);
  assert.ok(names.includes('迷情剂'));
  assert.equal(item.category, 'custom');
  assert.equal(item.intro, '看起来是一杯水。');
  assert.equal(item.finish, '想喝什么自己加。');
});

test('AUDIT-16 两杯隐藏酒不得出现在普通菜单，原文必须逐字匹配', () => {
  const e = auditEngine();
  const names = e.publicMenu().map((m) => m.claimedName);
  assert.equal(names.includes('heaven'), false);
  assert.equal(names.includes('五彩斑斓的黑'), false);
  assert.equal(hiddenBlack.listed, false);
  assert.equal(hiddenHeaven.listed, false);
  assert.equal(hiddenBlack.kind, 'unlisted');
  assert.equal(hiddenHeaven.kind, 'unlisted');
  assert.equal(hiddenBlack.intro, NING_BLACK_INTRO);
  assert.equal(hiddenHeaven.intro, NING_HEAVEN_INTRO);
});

test('AUDIT-16 隐藏抽卡：达条件才 5%，黑优先，建杯冻结，抽中后固定效果 100%', () => {
  const eHit = auditEngine(null, { hiddenHashUnit: () => 0.01, random: () => 0 });
  const vodka = buildFromParts('高度特调', [{ id: '伏特加', volume: 500 }], { kind: 'custom', listed: false, totalMouths: 2 });
  const id = eHit.createOffer(cloneCup(vodka), 'mixer', 'mixer', 'drinker', AUDIT_T0);
  const offer = eHit.offers.get(id);
  assert.equal(offer.cup.hiddenDraw?.frozen, true, 'draw must freeze at create');
  assert.equal(offer.claimedName, 'heaven');
  const drunk = eHit.drinkOffer(id, 'drinker', 'h1', AUDIT_T0);
  assert.equal(drunk.projection.actualEffectDescription?.text, NING_HEAVEN_EFFECT);

  const eMiss = auditEngine(null, { hiddenHashUnit: () => 0.9 });
  const id2 = eMiss.createOffer(cloneCup(vodka), 'mixer', 'mixer', 'drinker', AUDIT_T0);
  assert.notEqual(eMiss.offers.get(id2).claimedName, 'heaven');

  const blackMix = buildFromParts('杂特调', hiddenBlack.recipe, { kind: 'custom', listed: false, totalMouths: 2 });
  const both = buildFromParts('又浓又杂', hiddenHeaven.recipe, { kind: 'custom', listed: false, totalMouths: 2 });
  assert.ok(computeDiscreteness(blackMix.sources) >= 0.8);
  assert.ok(computeDiscreteness(both.sources) >= 0.8);
  const eBlack = auditEngine(null, { hiddenHashUnit: () => 0.0, random: () => 0 });
  const idB = eBlack.createOffer(cloneCup(both), 'mixer', 'mixer', 'drinker', AUDIT_T0);
  assert.equal(eBlack.offers.get(idB).claimedName, '五彩斑斓的黑', 'black has priority when both eligible');
});

test('AUDIT-16 四状态独立槽位，COPY_PENDING_USER_REVIEW，吐/宕机不停止客户端', () => {
  const slots = realPack.statusCopy;
  assert.ok(slots, 'statusCopy missing');
  for (const type of ['塌', '吐', '宕机', '断片']) {
    const slot = slots[type];
    assert.ok(slot, `missing ${type}`);
    assert.equal(slot.copyStatus, 'COPY_PENDING_USER_REVIEW');
    assert.notEqual(slot.copyStatus, '最终内容');
    assert.equal(slot.haltClient, false);
    assert.ok(slot.script);
    assert.ok(slot.safetyNote);
    assert.notEqual(slot.script, slot.safetyNote);
  }
});

test('AUDIT-7 逐杯：每一登记酒在清醒 β=0 / β=1 下可算出增量与文案', () => {
  const rows = [];
  for (const drink of allContentCups()) {
    const e0 = auditEngine('dose_isolation');
    const cup0 = cloneCup(drink, { beta: 0, totalMouths: Math.min(drink.totalMouths || 2, 4), kind: drink.kind || 'menu' });
    e0.sipAll(cup0, AUDIT_T0);
    const st0 = e0.evaluateCup(cup0, AUDIT_T0);
    const issues = axisRangeOk(st0.state);
    assert.deepEqual(issues, [], drink.claimedName);

    const e1 = auditEngine();
    const cup1 = cloneCup(drink, { beta: 1, totalMouths: Math.min(drink.totalMouths || 2, 4) });
    const { result } = drinkAll(e1, cup1, AUDIT_T0);
    assert.equal(result.ok, true, drink.claimedName);
    const text = result.projection?.actualEffectDescription?.text;
    assert.equal(typeof text === 'string' || text == null, true);
    rows.push({
      name: drink.claimedName,
      kind: drink.kind,
      listed: drink.listed,
      c0: st0.c,
      dominant: result.eval?.dominant,
      text: text || ''
    });
  }
  assert.ok(rows.length >= 19, `rows=${rows.length}`);
});

test('AUDIT-9 迷情剂公开第一屏不泄露味道、效果文案、收尾或配方', () => {
  const e = auditEngine();
  const src = menuItem('迷情剂') || potion;
  const cup = cloneCup(src, { kind: src.kind || 'menu' });
  const id = e.createOffer(cup, 'mixer', 'mixer', 'drinker', AUDIT_T0);
  const p = e.viewOffer(id, 'drinker', AUDIT_T0).projection;
  assert.ok(!('flavor' in p));
  assert.ok(!('finish' in p));
  assert.ok(!('recipe' in p));
  assert.ok(!('actualEffectDescription' in p));
  const leaked = JSON.stringify(p);
  assert.equal(leaked.includes('甘甜与香气'), false);
  assert.equal(leaked.includes('有点发烫'), false);
  assert.equal(leaked.includes('想喝什么自己加'), false);
});

test('AUDIT-hash 分布：10000 个 cup id 的引擎 hash 命中率接近 5%', async () => {
  let mod = null;
  try {
    mod = await import('../../src/core/hiddenDraw.js');
  } catch {
    mod = null;
  }
  assert.ok(mod, 'engine/src/core/hiddenDraw.js missing');
  assert.equal(mod.HIDDEN_DRAW_P, 0.05);
  const n = 10000;
  const hits = Array.from({ length: n }, (_, i) => mod.hashUnit(`virtual-cup-${i}`)).filter((u) => u < 0.05).length;
  const rate = hits / n;
  assert.ok(rate >= 0.04 && rate <= 0.06, `hash rate ${rate}`);
  assert.equal(mod.hashUnit('cup-a'), mod.hashUnit('cup-a'));
});
