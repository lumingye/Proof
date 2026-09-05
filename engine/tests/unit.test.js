import test from 'node:test';
import assert from 'node:assert/strict';
import { metabolize, doseToPhysiology, mlToStandardDrinks } from '../src/core/dose.js';
import { computeRatio, computeDiscreteness, isSuppressed } from '../src/core/flavor.js';
import { currentHangover, createHangoverSnapshot } from '../src/core/hangover.js';
import { engine, whiskey, T0, almost } from './helpers.js';
import { STATE_AXES } from '../src/core/constants.js';

const WHISKEY_HALF = 60 * 0.43 * 0.789 / 10 / 2;

test('代谢下限：长时间不喝不会算出负杯数', () => {
  assert.equal(metabolize(2, 10), 0);
});

test('生理曲线用 ĉ 封顶', () => {
  const a = doseToPhysiology(10);
  const b = doseToPhysiology(20);
  assert.ok(almost(a.愉悦, b.愉悦, 1e-9));
  assert.ok(almost(a.精度, -5, 1e-9));
});

test('30ml 40% → 0.9468 杯量级（SPEC 验算 0.95）', () => {
  const d = mlToStandardDrinks(30, 0.4);
  assert.ok(almost(d, 0.9468, 1e-3));
});

test('宿醉快照实时取 max（多条快照）', () => {
  const now = T0;
  const snaps = [
    { initial: 0.8, halfLifeHours: 4, startTime: now - 3600000 },
    { initial: 1.2, halfLifeHours: 5, startTime: now - 7200000 }
  ];
  const h = currentHangover(snaps, now);
  assert.ok(h > 0.5);
});

test('峰值 < 6 不生成宿醉快照', () => {
  assert.equal(createHangoverSnapshot(5.9, T0), null);
});

test('离散度零除：显著来源 < 2 → D = 0', () => {
  const D = computeDiscreteness([{ volumeRatio: 1, flavorContribution: 1, treeDist: () => 0 }]);
  assert.equal(D, 0);
});

test('压制进入真实求值结果', () => {
  const e = engine();
  const cup = {
    id: 'press',
    claimedName: '苦压甜',
    kind: 'custom',
    totalMouths: 1,
    totalVolume: 45,
    sources: [],
    mouths: [{
      volume: 45, abv: 0.2, beta: 1, startTime: null, applied: false,
      components: [
        { axis: '苦', A: 5, tauRise: 12, tauFall: 70 },
        { axis: '甜', A: 1, tauRise: 1, tauFall: 15 }
      ]
    }]
  };
  e.applyMouth(cup, 0, T0);
  const t = T0 + 20000;
  const r = e.evaluateCup(cup, t);
  assert.equal(r.suppressed.甜, true);
  assert.equal(r.flavor.甜, 0);
  assert.equal(r.isSuppressed.甜, true);
  assert.equal(isSuppressed('苦', '甜', cup.mouths, t), true);
});

test('主导轴从完整最终状态判定，不只看生理三轴', () => {
  const e = engine();
  const cup = whiskey();
  e.applyMouth(cup, 0, T0);
  e.applyMouth(cup, 1, T0 + 1);
  const r = e.evaluateCup(cup, T0 + 1);
  assert.ok(STATE_AXES.includes(r.dominant));
  const physOnly = ['愉悦', '唤醒', '精度'];
  let maxAll = 0;
  let axisAll = null;
  for (const k of STATE_AXES) {
    const a = Math.abs(r.state[k]);
    if (a > maxAll) { maxAll = a; axisAll = k; }
  }
  assert.equal(r.dominant, axisAll);
  assert.ok(r.intermediates[10], '第 10 步必须可导出');
  assert.ok(r.intermediates[1] && r.intermediates[9]);
});

test('求值不得凭空预加下一口', () => {
  const e = engine();
  const cup = whiskey();
  e.applyMouth(cup, 0, T0);
  const c = e.state.c;
  const r = e.evaluateCup(cup, T0);
  assert.ok(almost(r.c, c, 1e-9));
  assert.ok(c < WHISKEY_HALF * 2);
});
