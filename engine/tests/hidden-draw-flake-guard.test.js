// 隐藏抽卡随机红灯的类级防线（CharB 2026-09-03 收尾单）。
//
// 背景：createOffer 按 hash(cupId) 掷一次 5% 的隐藏抽卡并冻结。
// 只要杯子够资格，任何断言 claimedName / 投影 / 效果文案的测试就有 5% 概率
// 被改名而红——G7 就是这么红的，全仓另有 9 个文件 58 处暴露在同一形状下。
//
// 逐处去钉 58 个调用点既啰嗦又会漏。改成在 tests/helpers.js 的 engine()
// 上装默认「稳定不命中」的杯 id 序列，一次覆盖全部。本文件钉住那道默认。
import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, nextMissCupId, T0 } from './helpers.js';
import { buildFromParts, realPack } from '../src/content/realPack.js';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { hashUnit, HIDDEN_DRAW_P, isHiddenIdentity } from '../src/core/hiddenDraw.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';

// 高离散度杂调：满足「五彩斑斓的黑」的抽卡资格（G7 用的就是这个形状）
function ginColaLime(name = '未命名') {
  return buildFromParts(name, [
    { id: '金酒', volume: 45 },
    { id: '可乐', volume: 120 },
    { id: '青柠汁', volume: 15 }
  ], { kind: 'custom', listed: false });
}

// 纯烈酒：满足 heaven 的抽卡资格
function vodka(name = '高度特调') {
  return buildFromParts(name, [{ id: '伏特加', volume: 90 }], { kind: 'custom', listed: false });
}

test('守卫 1：nextMissCupId 产出的 id 一律落在 5% 之外，且互不重复', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    const id = nextMissCupId();
    assert.ok(hashUnit(id) >= HIDDEN_DRAW_P, `${id} 落在命中区，会造成随机红灯`);
    assert.equal(seen.has(id), false, `${id} 重复了——杯 id 必须唯一，_offerForCup 按它找杯`);
    seen.add(id);
  }
});

test('守卫 2：helpers.engine() 默认建杯 200 次，一次都不会变成隐藏酒', () => {
  for (let i = 0; i < 200; i += 1) {
    const e = engine();
    const idA = e.createOffer(ginColaLime(), MIXER, MIXER, DRINKER, T0);
    assert.equal(e.offers.get(idA).claimedName, '未命名', `第 ${i} 次杂调被改名了`);
    const e2 = engine();
    const idB = e2.createOffer(vodka(), MIXER, MIXER, DRINKER, T0);
    assert.equal(isHiddenIdentity(e2.offers.get(idB).claimedName), false, `第 ${i} 次纯烈酒被改名了`);
  }
});

test('守卫 3：默认值可被覆盖——需要命中的测试仍然命中', () => {
  // hiddenHashUnit 直接接管掷点，不受默认 id 影响
  const hit = engine({ hiddenHashUnit: () => 0.0, random: () => 0 });
  const id = hit.createOffer(ginColaLime(), MIXER, MIXER, DRINKER, T0);
  assert.equal(hit.offers.get(id).claimedName, '五彩斑斓的黑');

  // 显式传 idFactory 也能盖掉默认
  const forced = engine({ idFactory: () => 'fixed-48' });
  assert.ok(hashUnit('fixed-48') < HIDDEN_DRAW_P, 'fixed-48 必须是命中 id，否则这条守卫是假的');
  const id2 = forced.createOffer(ginColaLime(), MIXER, MIXER, DRINKER, T0);
  assert.equal(forced.offers.get(id2).claimedName, '五彩斑斓的黑');
});

test('守卫 4：不经 helpers 直接 new 的引擎仍是随机的——这条防线只覆盖测试助手', () => {
  // 说清楚边界：直接 new ProofEngine 不带 idFactory 的地方仍会掷真随机。
  // 如果将来有人这么写测试，红灯还会回来。本条是提醒，不是保证。
  const raw = new ProofEngine(null, realPack, {});
  const id = raw.createOffer(vodka(), MIXER, MIXER, DRINKER, T0);
  const name = raw.offers.get(id).claimedName;
  assert.ok(typeof name === 'string' && name.length > 0);
});
