// 回归修复 A（保留名不进普通菜单）与 B（装饰物真实退出 Heaven 判定）· 引擎侧

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFromParts,
  heavenEligible,
  isReservedHiddenName,
  normalizeGarnishes,
  GARNISHES
} from '../src/index.js';

test('A：保留名判定——英文不分大小写，中文精确', () => {
  assert.equal(isReservedHiddenName('heaven'), true);
  assert.equal(isReservedHiddenName('Heaven'), true);
  assert.equal(isReservedHiddenName('HEAVEN'), true);
  assert.equal(isReservedHiddenName('  heaven  '), true);
  assert.equal(isReservedHiddenName('五彩斑斓的黑'), true);
  assert.equal(isReservedHiddenName('heavenly'), false);
  assert.equal(isReservedHiddenName('五彩斑斓的白'), false);
  assert.equal(isReservedHiddenName(''), false);
  assert.equal(isReservedHiddenName(null), false);
});

test('B：纯伏特加 + 杯沿装饰仍有 Heaven 资格', () => {
  const cup = buildFromParts('纯饮', [{ id: '伏特加', volume: 120 }], { garnishes: ['柠檬皮', '杯签'] });
  assert.equal(heavenEligible(cup), true);
  assert.deepEqual(cup.garnishes, ['柠檬皮', '杯签']);
});

test('B：伏特加 + 一滴柠檬汁失去资格', () => {
  const cup = buildFromParts('掺了', [{ id: '伏特加', volume: 120 }, { id: '柠檬汁', volume: 5 }], {});
  assert.equal(heavenEligible(cup), false);
});

test('B：伏特加 + 冰失去资格', () => {
  const cup = buildFromParts('加冰', [{ id: '伏特加', volume: 120 }, { id: '冰', volume: 30 }], {});
  assert.equal(heavenEligible(cup), false);
});

test('B：garnish 不改变总体积、味道、标准杯与离散度', () => {
  const bare = buildFromParts('素', [{ id: '伏特加', volume: 120 }], { id: 'x' });
  const dressed = buildFromParts('饰', [{ id: '伏特加', volume: 120 }], { id: 'x', garnishes: ['樱桃', '薄荷叶'] });
  assert.equal(dressed.totalVolume, bare.totalVolume);
  assert.equal(dressed.standardDrinks, bare.standardDrinks);
  assert.equal(dressed.sources.length, bare.sources.length);
  assert.deepEqual(dressed.claimedFlavor, bare.claimedFlavor);
});

test('B：普通配料伪造 decorative 不能绕过判定', () => {
  const cup = buildFromParts('伪装', [
    { id: '伏特加', volume: 120 },
    { id: '柠檬汁', volume: 5, decorative: true }
  ], {});
  assert.equal(heavenEligible(cup), false, 'decorative 是客户端说的，不算数');
  assert.ok(cup.sources.some((s) => s.id === '柠檬汁'), '柠檬汁仍然是入杯原料');
});

test('B：装饰物必须在允许列表内', () => {
  assert.throws(() => normalizeGarnishes(['伏特加']), /invalid_garnish/);
  assert.throws(() => normalizeGarnishes(['不存在的装饰']), /invalid_garnish/);
  assert.throws(() => normalizeGarnishes('柠檬皮'), /invalid_garnish/);
  assert.deepEqual(normalizeGarnishes(null), []);
  assert.deepEqual(normalizeGarnishes(['柠檬皮', '柠檬皮']), ['柠檬皮'], '去重');
  assert.ok(GARNISHES.includes('柠檬皮'));
});

test('B：export/restore 之后 garnish 与资格一致', () => {
  const cup = buildFromParts('纯饮', [{ id: '伏特加', volume: 120 }], { garnishes: ['橄榄'] });
  const round = JSON.parse(JSON.stringify(cup));
  assert.deepEqual(round.garnishes, ['橄榄']);
  assert.equal(heavenEligible(round), true);
});
