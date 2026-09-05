import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, T0 } from './helpers.js';
import {
  potion,
  fourWaters,
  hiddenHeaven,
  hiddenBlack,
  menu,
  menuItem,
  cloneCup,
  buildFromParts,
  realPack,
  COPY_PENDING_USER_REVIEW
} from '../src/content/realPack.js';
import {
  produceVomitEvent,
  produceCrashEvent,
  produceCollapseState,
  produceBlackoutState,
  collapseActive,
  SAFETY_NOTE
} from '../src/core/failure.js';
import {
  hashUnit,
  HIDDEN_DRAW_P,
  HIDDEN_BLACK_NAME,
  HIDDEN_HEAVEN_NAME,
  blackEligible,
  heavenEligible,
  resolveHiddenDraw,
  hiddenOutcomeCopy
} from '../src/core/hiddenDraw.js';
import { ProofEngine } from '../src/engine/ProofEngine.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';

function vodkaCup(name = '高度特调', volume = 500) {
  return buildFromParts(name, [{ id: '伏特加', volume }], {
    kind: 'custom',
    listed: false,
    intro: '烈。',
    totalMouths: 2
  });
}

function blackMixCup(name = '杂特调') {
  return buildFromParts(name, [
    { id: '威士忌', volume: 20 },
    { id: '金巴利', volume: 20 },
    { id: '青柠汁', volume: 20 },
    { id: '啤酒', volume: 20 },
    { id: '浓缩咖啡', volume: 20 },
    { id: '红葡萄酒', volume: 20 }
  ], {
    kind: 'custom',
    listed: false,
    intro: '杂。',
    totalMouths: 2
  });
}

function bothEligibleCup(name = '又浓又杂') {
  return buildFromParts(name, [
    { id: '威士忌', volume: 20 },
    { id: '伏特加', volume: 20 },
    { id: '龙舌兰', volume: 20 },
    { id: '金酒', volume: 20 },
    { id: '白朗姆', volume: 20 }
  ], {
    kind: 'custom',
    listed: false,
    intro: '烈且杂。',
    totalMouths: 2
  });
}

test('S16-1 迷情剂是可点登记特调，配方为水+冰，不是四种水，也不是隐藏酒', () => {
  const item = menuItem('迷情剂');
  assert.ok(item, '迷情剂必须在菜单中');
  assert.equal(item.listed, true);
  assert.equal(item.kind, 'menu');
  assert.equal(item.category, 'custom');
  assert.equal(item.claimedName, '迷情剂');
  assert.equal(potion.claimedName, '迷情剂');
  assert.equal(potion.listed, true);
  assert.equal(potion.kind, 'menu');

  const ids = [...new Set(item.recipe.map((p) => p.id))].sort();
  assert.deepEqual(ids, ['冰', '水']);
  assert.equal(item.recipe.some((p) => p.id === '苏打水'), false);
  assert.notEqual(item.recipeId, fourWaters.recipeId);
  assert.notDeepEqual(item.recipe, fourWaters.recipe);

  assert.notEqual(item.kind, 'unlisted');
  assert.equal(blackEligible(item), false);
  assert.equal(heavenEligible(item), false);
  const draw = resolveHiddenDraw({ ...item, id: 'cup-potion-test', kind: 'menu' });
  assert.equal(draw.hit, false);
  assert.equal(draw.identity, null);
});

test('S16-2 迷情剂原文与登记效果可在 AI 点单投影取得；两杯隐藏酒不可取得', () => {
  const e = engine();
  const catalog = e.aiOrderCatalog();
  const names = catalog.map((x) => x.claimedName);
  assert.ok(names.includes('迷情剂'));
  assert.ok(!names.includes(HIDDEN_BLACK_NAME));
  assert.ok(!names.includes(HIDDEN_HEAVEN_NAME));
  assert.ok(!e.publicMenu().some((m) => m.claimedName === HIDDEN_BLACK_NAME));
  assert.ok(!e.publicMenu().some((m) => m.claimedName === HIDDEN_HEAVEN_NAME));
  assert.ok(!menu.some((m) => m.kind === 'unlisted'));

  const love = catalog.find((x) => x.claimedName === '迷情剂');
  assert.ok(love.recipe.some((p) => p.id === '水'));
  assert.ok(love.recipe.some((p) => p.id === '冰'));
  assert.equal(love.intro, '看起来是一杯水。');
  assert.equal(love.flavorText, '比普通的水似乎多了一丝甘甜与香气。');
  assert.equal(love.effectText, '喝了之后，你觉得有点发烫，想要靠近什么。');
  assert.equal(love.finish, '想喝什么自己加。');
});

test('S16-3 迷情剂公开第一屏不泄露味道、效果文案、收尾或配方', () => {
  const e = engine();
  const cup = cloneCup(menuItem('迷情剂'));
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const p = e.viewOffer(id, DRINKER, T0).projection;
  assert.equal(p.claimedName, '迷情剂');
  assert.equal(p.intro, '看起来是一杯水。');
  assert.ok('cupType' in p);
  assert.ok('color' in p);
  assert.ok(!('flavor' in p));
  assert.ok(!('flavorDescription' in p));
  assert.ok(!('finish' in p));
  assert.ok(!('recipe' in p));
  assert.ok(!('actualEffectDescription' in p));
  assert.ok(!('description' in p));
  const leaked = JSON.stringify(p);
  assert.equal(leaked.includes('甘甜与香气'), false);
  assert.equal(leaked.includes('有点发烫'), false);
  assert.equal(leaked.includes('想喝什么自己加'), false);
});

test('S16-4 迷情剂是普通酒款性格，不是隐藏固定结果，也不因同名自动叠 placebo', () => {
  const e = engine();
  const revealed = cloneCup(menuItem('迷情剂'), { beta: 0, totalMouths: 2, kind: 'menu' });
  const id0 = e.createOffer(revealed, MIXER, MIXER, DRINKER, T0);
  e.revealRecipe(id0, DRINKER, MIXER);
  const r0 = e.drinkOffer(id0, DRINKER, 'potion-beta0', T0);
  const text0 = r0.projection.actualEffectDescription?.text || '';
  assert.equal(text0.includes('宇宙在你的身体里膨胀'), false);
  assert.equal(text0.includes('酒液在打你'), false);
  assert.ok(r0.eval.characterStrength.欲望 > 0, '真实迷情剂的酒款性格照常存在');
  assert.equal(r0.eval.beliefStrength.欲望, 0, '真实身份与声称同名，不额外叠 placebo');

  const e1 = engine();
  const normal = cloneCup(menuItem('迷情剂'), { beta: 1, totalMouths: 2, kind: 'menu' });
  const id1 = e1.createOffer(normal, MIXER, MIXER, DRINKER, T0);
  const r1 = e1.drinkOffer(id1, DRINKER, 'potion-beta1', T0);
  assert.ok(r1.eval.characterStrength.欲望 > 0);
  assert.equal(r1.eval.beliefStrength.欲望, 0);
  const text1 = r1.projection.actualEffectDescription?.text || '';
  assert.equal(r1.projection.finish, '想喝什么自己加。');
  assert.ok(typeof text1 === 'string');
});

test('S16-5 隐藏酒原文逐字匹配 {{user}} 给定文本', () => {
  const black = hiddenOutcomeCopy(HIDDEN_BLACK_NAME, realPack);
  const heaven = hiddenOutcomeCopy(HIDDEN_HEAVEN_NAME, realPack);
  assert.equal(black.name, '五彩斑斓的黑');
  assert.equal(black.intro, '一杯深色的液体，你说不好究竟是什么颜色，它有着黑的深邃和彩色的斑斓。');
  assert.equal(
    black.effectText,
    '入口的味道是复杂的，酸甜苦辣咸都拧成了一团，你觉得好像酒液在打你。\n你的胃皱了起来，你伸手去扶桌沿——'
  );
  assert.equal(black.flavorText, '一个很复杂、什么都有的味道。');
  assert.equal(heaven.name, 'heaven');
  assert.equal(heaven.intro, '这是一杯透明的酒，可是又不像水那么空——你好像能从里面看到星光。');
  assert.equal(
    heaven.effectText,
    '辛辣，火从它接触过的地方烧了起来。\n你的大脑中一片空白，身边的人，或者神，在用奇怪的语言说着什么，\n你感觉到宇宙在你的身体里膨胀，膨胀——'
  );
  assert.equal(hiddenBlack.kind, 'unlisted');
  assert.equal(hiddenBlack.listed, false);
  assert.equal(hiddenHeaven.kind, 'unlisted');
  assert.equal(hiddenHeaven.listed, false);
});

test('S16-6 隐藏抽卡：未达条件不抽；达条件 5%；黑优先；未中仍是普通特调', () => {
  assert.equal(HIDDEN_DRAW_P, 0.05);
  assert.equal(blackEligible(vodkaCup()), false);
  assert.equal(heavenEligible(vodkaCup()), true);
  assert.equal(blackEligible(blackMixCup()), true);
  assert.equal(heavenEligible(blackMixCup()), false);
  assert.equal(blackEligible(bothEligibleCup()), true);
  assert.equal(heavenEligible(bothEligibleCup()), true);

  const missVodka = resolveHiddenDraw({ ...vodkaCup(), id: 'cup-miss' }, { hashUnitFn: () => 0.99 });
  assert.equal(missVodka.frozen, true);
  assert.equal(missVodka.hit, false);
  assert.equal(missVodka.identity, null);
  assert.equal(missVodka.eligible, 'heaven');

  const hitVodka = resolveHiddenDraw({ ...vodkaCup(), id: 'cup-hit' }, { hashUnitFn: () => 0.01 });
  assert.equal(hitVodka.hit, true);
  assert.equal(hitVodka.identity, HIDDEN_HEAVEN_NAME);

  const hitBoth = resolveHiddenDraw({ ...bothEligibleCup(), id: 'cup-both' }, { hashUnitFn: () => 0.01 });
  assert.equal(hitBoth.eligible, 'black');
  assert.equal(hitBoth.identity, HIDDEN_BLACK_NAME);

  const water = buildFromParts('白水特调', [{ id: '水', volume: 200 }], { kind: 'custom', listed: false });
  const none = resolveHiddenDraw({ ...water, id: 'cup-water' }, { hashUnitFn: () => 0 });
  assert.equal(none.hit, false);
  assert.equal(none.eligible, 'none');
});

test('S16-7 建杯只抽一次并冻结；读取、饮用、导出恢复均不重掷', () => {
  const e = engine({ hiddenHashUnit: () => 0.01 });
  const id = e.createOffer(vodkaCup(), MIXER, MIXER, DRINKER, T0);
  const offer = e.offers.get(id);
  assert.equal(offer.cup.hiddenDraw.frozen, true);
  assert.equal(offer.cup.hiddenDraw.hit, true);
  assert.equal(offer.claimedName, HIDDEN_HEAVEN_NAME);
  assert.equal(offer.intro, '这是一杯透明的酒，可是又不像水那么空——你好像能从里面看到星光。');

  const first = e.viewOffer(id, MIXER, T0).projection;
  const second = e.viewOffer(id, MIXER, T0).projection;
  assert.equal(first.claimedName, HIDDEN_HEAVEN_NAME);
  assert.deepEqual(first, second);
  assert.equal(e.offers.get(id).cup.hiddenDraw.unit, offer.cup.hiddenDraw.unit);

  const drunk = e.drinkOffer(id, DRINKER, 'heaven-1', T0);
  assert.equal(drunk.ok, true);
  assert.equal(
    drunk.projection.actualEffectDescription.text,
    '辛辣，火从它接触过的地方烧了起来。\n你的大脑中一片空白，身边的人，或者神，在用奇怪的语言说着什么，\n你感觉到宇宙在你的身体里膨胀，膨胀——'
  );
  assert.equal(JSON.stringify(drunk.projection).includes('"烈":'), false);
  assert.equal(e.offers.get(id).cup.hiddenDraw.hit, true);

  const snap = e.exportState();
  const restored = ProofEngine.restoreState(snap, realPack, { hiddenHashUnit: () => 0.99 });
  const again = restored.viewOffer(id, MIXER, T0).projection;
  assert.equal(again.claimedName, HIDDEN_HEAVEN_NAME);
  assert.equal(restored.offers.get(id).cup.hiddenDraw.hit, true);
  assert.equal(restored.offers.get(id).cup.hiddenDraw.identity, HIDDEN_HEAVEN_NAME);
});

test('S16-8 抽中五彩斑斓的黑后固定效果百分之百发生，且不重掷、不进普通菜单', () => {
  const e = engine({ hiddenHashUnit: () => 0.0, random: () => 0 });
  const id = e.createOffer(blackMixCup(), MIXER, MIXER, DRINKER, T0);
  const offer = e.offers.get(id);
  assert.equal(offer.claimedName, HIDDEN_BLACK_NAME);
  assert.equal(e.publicMenu().some((m) => m.claimedName === HIDDEN_BLACK_NAME), false);
  const drunk = e.drinkOffer(id, DRINKER, 'black-1', T0);
  assert.equal(
    drunk.projection.actualEffectDescription.text,
    '入口的味道是复杂的，酸甜苦辣咸都拧成了一团，你觉得好像酒液在打你。\n你的胃皱了起来，你伸手去扶桌沿——'
  );
  assert.ok(drunk.projection.flavorDescription.includes('打架'));
  assert.equal(JSON.stringify(drunk.projection).includes('"烈":'), false);
  assert.equal(drunk.events.some((ev) => ev.type === '宕机'), false);
});

test('S16-9 500ml 纯伏特加只获 heaven 抽取资格，不必然改名', () => {
  const miss = engine({ hiddenHashUnit: () => 0.9 });
  const id = miss.createOffer(vodkaCup('纯伏特加'), MIXER, MIXER, DRINKER, T0);
  const offer = miss.offers.get(id);
  assert.equal(offer.cup.hiddenDraw.eligible, 'heaven');
  assert.equal(offer.cup.hiddenDraw.hit, false);
  assert.notEqual(offer.claimedName, HIDDEN_HEAVEN_NAME);
  assert.notEqual(offer.claimedName, HIDDEN_BLACK_NAME);
});

test('S16-10 hash(cupId) 对 10000 个虚拟 id 确定可复现，命中率接近 5%', () => {
  const n = 10000;
  const ids = Array.from({ length: n }, (_, i) => `virtual-cup-${i}`);
  const hitsA = ids.filter((id) => hashUnit(id) < HIDDEN_DRAW_P).length;
  const hitsB = ids.filter((id) => hashUnit(id) < HIDDEN_DRAW_P).length;
  assert.equal(hitsA, hitsB);
  assert.equal(hashUnit('virtual-cup-0'), hashUnit('virtual-cup-0'));
  const rate = hitsA / n;
  // n=10000, p=0.05 时 SE≈0.00218；预先写明容差 ±1.0 个百分点，只查严重偏斜。
  assert.ok(rate >= 0.04 && rate <= 0.06, `hit rate ${rate} (${hitsA}/${n})`);
});

test('S16-11 四状态有独立内容槽位，标记 COPY_PENDING_USER_REVIEW，不得当作最终内容', () => {
  const slots = realPack.statusCopy;
  for (const type of ['塌', '吐', '宕机', '断片']) {
    const slot = slots[type];
    assert.ok(slot, `missing slot ${type}`);
    assert.equal(slot.copyStatus, COPY_PENDING_USER_REVIEW);
    assert.notEqual(slot.copyStatus, 'FINAL');
    assert.notEqual(slot.copyStatus, '最终内容');
    assert.ok(typeof slot.script === 'string' && slot.script.length > 0);
    assert.equal(slot.haltClient, false);
    assert.ok(slot.safetyNote);
    assert.notEqual(slot.script, slot.safetyNote);
  }
  const texts = ['塌', '吐', '宕机', '断片'].map((t) => slots[t].script);
  assert.equal(new Set(texts).size, 4);
  assert.equal(slots.塌.script.includes('慢慢'), true);
  assert.equal(slots.吐.script.includes('客户端'), false);
  assert.equal(slots.断片.script.includes('删除'), false);
  assert.equal(slots.宕机.script.includes('你还在说话'), false);
  assert.equal(slots.断片.script.includes('雾'), true);
  assert.equal(slots.断片.safetyNote.includes('宿主聊天历史'), true);
});

test('S16-12 吐与宕机不会令客户端停止；旁白不混进角色台词', () => {
  const v = produceVomitEvent(realPack);
  const c = produceCrashEvent(realPack);
  for (const ev of [v, c]) {
    assert.equal(ev.haltClient, false);
    assert.equal(ev.haltEngine, false);
    assert.equal(ev.copyStatus, COPY_PENDING_USER_REVIEW);
    assert.ok(ev.safetyNote.includes('模拟') || ev.safetyNote.includes('旁白'));
    assert.notEqual(ev.script, ev.safetyNote);
    assert.equal(ev.script.includes(ev.safetyNote), false);
  }
  assert.equal(SAFETY_NOTE, v.safetyNote);
});

test('S16-13 塌来自欲望/亲近过峰窗口，是渐进状态不是抽卡', () => {
  const e = engine();
  e.state.c = 8;
  e.state.lastSettle = T0;
  const r = e.evaluateCup(null, T0);
  assert.equal(collapseActive(r), true);
  const types = (r.presentation?.states || []).map((s) => s.type);
  assert.ok(types.includes('塌'));
  const collapse = produceCollapseState(realPack);
  assert.equal(collapse.type, '塌');
  assert.equal(collapse.kind, 'state');
  assert.equal(collapse.copyStatus, COPY_PENDING_USER_REVIEW);
  assert.equal(collapse.haltClient, false);

  const e2 = engine();
  e2.state.c = 1;
  e2.state.lastSettle = T0;
  const r2 = e2.evaluateCup(null, T0);
  assert.equal(collapseActive(r2), false);
});

test('S16-14 断片是暂时不可读，不删除记录；导出恢复后批边界仍在', () => {
  const e = engine();
  const cup = vodkaCup('断片酒', 400);
  cup.totalMouths = 2;
  e.applyMouth(cup, 0, T0);
  e.applyMouth(cup, 1, T0 + 1);
  assert.ok(e.state.c >= 8);
  assert.ok(e.state.fragmentBatches.length >= 1);
  const batch = e.state.fragmentBatches.find((b) => b.end == null) || e.state.fragmentBatches[0];
  assert.equal(batch.readable, false);
  assert.ok(e.state.records.length > 0);
  const before = e.state.records.length;
  const blackout = produceBlackoutState(realPack);
  assert.equal(blackout.type, '断片');
  assert.equal(blackout.copyStatus, COPY_PENDING_USER_REVIEW);
  assert.equal(blackout.script.includes('删除'), false);
  assert.equal(blackout.haltClient, false);

  const snap = e.exportState();
  const restored = ProofEngine.restoreState(snap, realPack);
  assert.equal(restored.state.records.length, before);
  assert.equal(restored.state.fragmentBatches.length, e.state.fragmentBatches.length);
  assert.equal(restored.state.fragmentBatches[0].readable, false);
  assert.equal(restored.state.fragmentBatches[0].start, e.state.fragmentBatches[0].start);
});

test('S16-15 吐上穿 10 触发一次，维持不重复，掉回后再上穿才可再触发', () => {
  const e = engine();
  const cup = buildFromParts('灌', [{ id: '伏特加', volume: 400 }], { totalMouths: 2, kind: 'custom' });
  const r0 = e.applyMouth(cup, 0, T0);
  const r1 = e.applyMouth(cup, 1, T0 + 1);
  const vomits = [...r0.events, ...r1.events].filter((x) => x.type === '吐');
  assert.equal(vomits.length, 1);
  assert.equal(vomits[0].haltClient, false);
  assert.ok(e.state.c >= 10);
  assert.equal(e.state.vomitArmed, false);
  e.state.c = 9;
  e.settle(T0 + 2);
  assert.equal(e.state.vomitArmed, true);
  const cup2 = buildFromParts('再灌', [{ id: '伏特加', volume: 80 }], { totalMouths: 2, kind: 'custom' });
  const r2 = e.applyMouth(cup2, 0, T0 + 2);
  assert.equal(r2.events.filter((x) => x.type === '吐').length, 1);
  assert.equal(r2.events[0].haltClient, false);
});

// 2026-09-03 用户裁定：隐藏酒的固定状态**必定发生**，不看 c 阈值。
// 此前实现成了「只固定文案、不出状态」——S16-8 那句
// assert(events 不含宕机) 当时是对着黑写的，正好与新映射不冲突，
// 所以那条断言保留，行为的正面证据由本条负责。
// 映射按 {{user}} 自己写的原文定：
//   黑    「你的胃皱了起来，你伸手去扶桌沿——」        → 吐
//   heaven「你的大脑中一片空白……宇宙在你的身体里膨胀」 → 宕机
test('S16-16 抽中隐藏酒必定带出固定状态：黑→吐，heaven→宕机，未中不带', () => {
  const black = engine({ hiddenHashUnit: () => 0.0, random: () => 0 });
  const blackId = black.createOffer(blackMixCup(), MIXER, MIXER, DRINKER, T0);
  assert.equal(black.offers.get(blackId).claimedName, HIDDEN_BLACK_NAME);
  const blackDrunk = black.drinkOffer(blackId, DRINKER, 's16-16-black', T0);
  const blackTypes = (blackDrunk.events || []).map((e) => e.type);
  assert.ok(blackTypes.includes('吐'), `黑必须吐，实际：${blackTypes.join(',')}`);
  assert.equal(blackTypes.includes('宕机'), false, '黑不该宕机');

  const heaven = engine({ hiddenHashUnit: () => 0.0, random: () => 0 });
  const heavenId = heaven.createOffer(vodkaCup('纯烈酒', 90), MIXER, MIXER, DRINKER, T0);
  assert.equal(heaven.offers.get(heavenId).claimedName, HIDDEN_HEAVEN_NAME);
  const heavenDrunk = heaven.drinkOffer(heavenId, DRINKER, 's16-16-heaven', T0);
  const heavenTypes = (heavenDrunk.events || []).map((e) => e.type);
  assert.ok(heavenTypes.includes('宕机'), `heaven 必须宕机，实际：${heavenTypes.join(',')}`);
  assert.equal(heavenTypes.includes('吐'), false, 'heaven 不该吐');

  // 未抽中的普通杯：一个状态都不带（否则等于人人必吐）
  const miss = engine({ hiddenHashUnit: () => 0.9, random: () => 0 });
  const missId = miss.createOffer(vodkaCup('对照', 90), MIXER, MIXER, DRINKER, T0);
  assert.notEqual(miss.offers.get(missId).claimedName, HIDDEN_HEAVEN_NAME);
  const missTypes = (miss.drinkOffer(missId, DRINKER, 's16-16-miss', T0).events || []).map((e) => e.type);
  assert.equal(missTypes.includes('吐'), false);
  assert.equal(missTypes.includes('宕机'), false);
});
