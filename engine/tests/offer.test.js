import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, whiskey, customPotion, T0, almost } from './helpers.js';
import { buildFromParts, cloneCup } from '../src/content/realPack.js';
import { computeColor, computeCupType } from '../src/core/appearance.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';
const OTHER = 'other';

test('O1 创建及重复打开第一屏，状态完全不变', () => {
  const e = engine();
  const cup = whiskey();
  const before = JSON.stringify(e.exportState());
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const afterCreate = e.exportState();
  assert.equal(afterCreate.c, 0);
  e.viewOffer(id, DRINKER, T0);
  e.viewOffer(id, DRINKER, T0 + 10);
  e.viewOffer(id, MIXER, T0 + 20);
  const after = e.exportState();
  assert.equal(after.c, 0);
  assert.equal(after.cupsDrunk, 0);
  assert.deepEqual(after.sensitivity, JSON.parse(before).sensitivity);
  assert.ok(after.tonightDelivered.length >= 1);
});

test('O2 第一次 drink 入账一次，重复请求不增加杯数', () => {
  const e = engine();
  const cup = whiskey();
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const a = e.drinkOffer(id, DRINKER, 'req-1', T0);
  assert.equal(a.ok, true);
  const c1 = e.state.c;
  const cups1 = e.state.cupsDrunk;
  const b = e.drinkOffer(id, DRINKER, 'req-1', T0);
  assert.equal(b.idempotent, true);
  assert.equal(e.state.c, c1);
  assert.equal(e.state.cupsDrunk, cups1);
  assert.ok(c1 > 0, '固定酒第一次消费应按真实配方累计酒精');
});

test('O3 不同 requestId 也不能二次消费同一个一次性链接', () => {
  const e = engine();
  const cup = whiskey();
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  e.drinkOffer(id, DRINKER, 'req-1', T0);
  const c1 = e.state.c;
  const again = e.drinkOffer(id, DRINKER, 'req-2', T0);
  assert.equal(again.ok, true);
  assert.equal(again.idempotent, true);
  assert.equal(e.state.c, c1);
});

test('O4 非指定饮用者消费被拒绝', () => {
  const e = engine();
  const cup = whiskey();
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const r = e.drinkOffer(id, OTHER, 'req-x', T0);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_drinker');
  assert.equal(e.state.c, 0);
  assert.equal(e.state.cupsDrunk, 0);
});

test('O5 第一屏字段恰好符合规格，不泄露配方、轴值或真实效果', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const p = e.viewOffer(id, DRINKER, T0).projection;
  const keys = Object.keys(p).sort();
  // 饮用方喝前只有这四个字段（发布回归：按交互阶段收紧，声称效果也不给）。
  assert.deepEqual(keys, ['claimedName', 'color', 'cupType', 'intro']);
  assert.ok(!('recipe' in p));
  assert.ok(!('flavor' in p));
  assert.ok(!('effects' in p));
  assert.ok(!('physiology' in p));
  assert.ok(!('state' in p));
  assert.ok(!('actualEffectDescription' in p));
  assert.ok(!('claimedEffects' in p));
  // 调制者仍看得到自己登记的声称效果
  const mixerView = e.viewOffer(id, MIXER, T0).projection;
  assert.deepEqual(mixerView.claimedEffects.愉悦, 3);
});

test('O6 第二屏含口味与收尾，且双盲投影正确', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const r = e.drinkOffer(id, DRINKER, 'req-1', T0);
  assert.ok('flavor' in r.projection);
  assert.ok('finish' in r.projection);
  assert.ok(!('recipe' in r.projection));
  const mixerSecond = e.viewOffer(id, MIXER, T0).projection;
  assert.ok('recipe' in mixerSecond);
});

test('O7 拒绝/过期 offer 留递出记录但无饮用代价', () => {
  const e = engine();
  const cup = whiskey();
  const id = e.createOffer(cup, MIXER, MIXER, DRINKER, T0);
  const rejected = e.rejectOffer(id, DRINKER, T0 + 1);
  assert.equal(rejected.ok, true);
  assert.equal(e.state.c, 0);
  assert.equal(e.state.cupsDrunk, 0);
  assert.ok(e.state.tonightDelivered.some((d) => d.id === id));
  assert.ok(e.state.records.some((d) => d.refused));

  const id2 = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0 + 2);
  e.expireOffer(id2, T0 + 3);
  assert.equal(e.state.c, 0);
  const drinkExpired = e.drinkOffer(id2, DRINKER, 'x', T0 + 4);
  assert.equal(drinkExpired.ok, false);
  assert.equal(e.state.c, 0);
});

test('O8 杯型与颜色使用 §4.9 真实计算，包括体积加权、多色浑和稀释淡的边界', () => {
  const colaSpirit = buildFromParts('可乐兑', [
    { id: '可乐', volume: 60 },
    { id: '伏特加', volume: 45 }
  ], { kind: 'custom' });
  assert.equal(colaSpirit.color, '深棕');

  const pale = buildFromParts('淡', [
    { id: '威士忌', volume: 60 },
    { id: '水', volume: 120 }
  ], { kind: 'custom' });
  assert.match(pale.color, /^淡/);

  const mixed = buildFromParts('浑', [
    { id: '可乐', volume: 60 },
    { id: '金巴利', volume: 60 }
  ], { kind: 'custom' });
  assert.match(mixed.color, /^浑/);

  assert.equal(computeCupType({ totalVolume: 45, textures: [] }), '子弹杯');
  assert.equal(computeCupType({ totalVolume: 330, textures: ['气泡'] }), '大杯');
  assert.equal(computeCupType({ totalVolume: 165, textures: ['气泡'] }), '高球杯');
  assert.equal(computeCupType({ totalVolume: 70, method: 'shake' }), '鸡尾酒杯');
  assert.equal(computeCupType({ totalVolume: 70, method: 'stir' }), '矮球杯');

  const e = engine();
  const id = e.createOffer(colaSpirit, MIXER, MIXER, DRINKER, T0);
  const p = e.viewOffer(id, DRINKER, T0).projection;
  assert.equal(p.color, '深棕');
  assert.ok(p.cupType);
});

test('O9 多口杯聚合整杯客观事件，不让后续口覆盖吐/断片/宕机', () => {
  const crossing = engine();
  crossing.state.c = 9.8;
  crossing.state.lastSettle = T0;
  crossing.state.vomitArmed = true;
  const thresholdCup = buildFromParts('跨阈值', [{ id: '伏特加', volume: 20 }], {
    kind: 'custom', listed: false, totalMouths: 2
  });
  const thresholdId = crossing.createOffer(thresholdCup, MIXER, MIXER, DRINKER, T0);
  const threshold = crossing.drinkOffer(thresholdId, DRINKER, 'threshold', T0);
  const thresholdTypes = threshold.events.map((event) => event.type);
  assert.ok(thresholdTypes.includes('吐'), `整杯结果必须保留中间一口的吐：${thresholdTypes}`);
  assert.ok(thresholdTypes.includes('断片'), `整杯结果必须保留中间一口的断片：${thresholdTypes}`);
  const thresholdRetry = crossing.drinkOffer(thresholdId, DRINKER, 'threshold-retry', T0);
  assert.equal(thresholdRetry.idempotent, true);
  assert.deepEqual(thresholdRetry.events.map((event) => event.type), thresholdTypes, '幂等重试必须返回同一批客观事件');
  assert.deepEqual(thresholdRetry.states.map((state) => state.type), threshold.states.map((state) => state.type), '幂等重试必须返回同一批持续状态');

  const crash = engine({ random: () => 0.1 });
  const mixedCup = buildFromParts('杂杯', [
    { id: '伏特加', volume: 20 },
    { id: '金酒', volume: 20 },
    { id: '白朗姆', volume: 20 },
    { id: '龙舌兰', volume: 20 },
    { id: '威士忌', volume: 20 }
  ], { kind: 'custom', listed: false, totalMouths: 3 });
  const crashId = crash.createOffer(mixedCup, MIXER, MIXER, DRINKER, T0);
  const crashed = crash.drinkOffer(crashId, DRINKER, 'crash', T0);
  assert.ok(crashed.events.some((event) => event.type === '宕机'), '整杯结果必须保留第一口的宕机');
});
