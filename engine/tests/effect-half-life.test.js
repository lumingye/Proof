import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFromParts, normalizeEffectHalfLife } from '../src/content/realPack.js';
import { engine, T0, almost } from './helpers.js';

const MIN = 60 * 1000;
const parts = [{ id: '伏特加', volume: 45 }, { id: '水', volume: 45 }];

function drinkAndRead(opts, minutesLater) {
  const e = engine();
  const cup = buildFromParts('慢慢散', parts, { kind: 'menu', listed: true, effects: { 愉悦: 2 }, ...opts });
  e.sipAll(cup, T0);
  return e.evaluateCup(cup, T0 + minutesLater * MIN).characterStrength.愉悦;
}

test('HL1 不填半衰期：行为和以前一样，30 分钟减一半', () => {
  const start = drinkAndRead({}, 0);
  assert.ok(start > 0);
  assert.ok(almost(drinkAndRead({}, 30) / start, 0.5, 1e-6));
});

test('HL2 自定义 60 分钟：30 分钟后剩约 0.707，60 分钟后剩一半', () => {
  const start = drinkAndRead({ effectHalfLifeMin: 60 }, 0);
  assert.ok(almost(drinkAndRead({ effectHalfLifeMin: 60 }, 30) / start, Math.SQRT1_2, 1e-6));
  assert.ok(almost(drinkAndRead({ effectHalfLifeMin: 60 }, 60) / start, 0.5, 1e-6));
});

test('HL3 自定义 15 分钟：散得更快', () => {
  const start = drinkAndRead({ effectHalfLifeMin: 15 }, 0);
  assert.ok(almost(drinkAndRead({ effectHalfLifeMin: 15 }, 30) / start, 0.25, 1e-6));
});

test('HL4 不合法的值不进杯子，按默认处理', () => {
  for (const bad of [5, 181, 30.5, 'abc', -1, 0]) {
    assert.equal(normalizeEffectHalfLife(bad), undefined, String(bad));
    const cup = buildFromParts('x', parts, { effectHalfLifeMin: bad });
    assert.equal('effectHalfLifeMin' in cup, false, String(bad));
  }
  assert.equal(normalizeEffectHalfLife('45'), 45);
  assert.equal(normalizeEffectHalfLife(10), 10);
  assert.equal(normalizeEffectHalfLife(180), 180);
});

test('HL5 半衰期记在这杯的残余上，存档读档后还在', () => {
  const e = engine();
  const cup = buildFromParts('慢慢散', parts, { kind: 'menu', listed: true, effects: { 愉悦: 2 }, effectHalfLifeMin: 90 });
  e.sipAll(cup, T0);
  e.settle(T0 + MIN);
  const saved = JSON.parse(JSON.stringify(e.toJSON ? e.toJSON() : e.state));
  const rows = [...(saved.characterResiduals || []), ...(saved.beliefResiduals || [])].filter((r) => r.cupId === cup.id && r.decayStart != null);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.halfLifeMin === 90));
});
