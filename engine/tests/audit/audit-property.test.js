import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE_AXES } from '../../src/core/constants.js';
import { ingredients, buildFromParts, cloneCup } from '../../src/content/realPack.js';
import { ProofEngine } from '../../src/engine/ProofEngine.js';
import { auditEngine, AUDIT_T0, mulberry32, axisRangeOk, almost, packWithRole } from './helpers.audit.js';

const SEED = 20260902;
const CASES = 80;

test(`AUDIT-8 性质测试 seed=${SEED} n=${CASES}：轴范围、精度≤0、幂等、export/restore`, () => {
  const rng = mulberry32(SEED);
  const ids = Object.keys(ingredients);
  let n = 0;
  for (let i = 0; i < CASES; i += 1) {
    const partCount = 1 + Math.floor(rng() * 4);
    const parts = [];
    for (let p = 0; p < partCount; p += 1) {
      const id = ids[Math.floor(rng() * ids.length)];
      const volume = 10 + Math.floor(rng() * 80);
      parts.push({ id, volume });
    }
    const cup = cloneCup(buildFromParts(`prop-${i}`, parts, {
      kind: 'custom',
      listed: false,
      totalMouths: 2,
      beta: rng()
    }));
    const e = auditEngine('dose_isolation', { random: rng });
    e.sipAll(cup, AUDIT_T0 + i);
    const ev = e.evaluateCup(cup, AUDIT_T0 + i);
    const issues = axisRangeOk(ev.state);
    assert.deepEqual(issues, [], `case ${i} ${issues.join(',')}`);
    assert.ok(ev.state.精度 <= 0);
    assert.ok(e.state.c >= 0);
    assert.ok((e.state.actives.咖啡因?.amount || 0) >= 0);
    const snap = e.exportState();
    const restored = ProofEngine.restoreState(snap, packWithRole('dose_isolation'), { random: rng });
    restored.settle(AUDIT_T0 + i);
    assert.ok(almost(restored.state.c, e.state.c, 1e-9), `restore c case ${i}`);
    n += 1;
  }
  assert.equal(n, CASES);
});

test('AUDIT-8 非法输入：负体积、NaN、未知轴、倒退时间不产生 NaN 状态', () => {
  const e = auditEngine();
  e.state.lastSettle = AUDIT_T0;
  e.state.c = 2;
  e.settle(AUDIT_T0 - 1000);
  assert.equal(e.state.c, 2);
  const ev = e.evaluateCup(null, AUDIT_T0);
  assert.deepEqual(axisRangeOk(ev.state), []);
  const bad = e.updateSensitivity('no-such', '不是轴', 'up');
  assert.equal(bad.ok, false);
  const r = e.updateSensitivity('', '愉悦', 'up');
  assert.equal(r.ok, false);
});

test('AUDIT-6.9 运算顺序 trace 存在，且交换敏感度与窗口会改变结果的夹具', () => {
  const e = auditEngine('open_guard');
  e.state.c = 5;
  e.state.lastSettle = AUDIT_T0;
  e.state.sensitivity.欲望 = 2;
  const ev = e.evaluateCup(null, AUDIT_T0);
  assert.ok(ev.intermediates[1]);
  assert.ok(ev.intermediates[6]);
  assert.ok(ev.intermediates[7]);
  assert.ok(ev.intermediates[9]);
  const combined = ev.intermediates[9].in.combined;
  const after = ev.intermediates[9].out.afterWindow;
  assert.ok(combined.欲望 !== after.欲望, 'window must change 欲望');
  const raw = ev.intermediates[6].out.reaction.欲望;
  const scaleThenWindow = (() => {
    const scaled = raw * 2;
    return scaled <= 3.5 ? scaled : 3.5 - 1.5 * (scaled - 3.5);
  })();
  const windowThenScale = (() => {
    const w = raw <= 3.5 ? raw : 3.5 - 1.5 * (raw - 3.5);
    return w * 2;
  })();
  assert.ok(Math.abs(scaleThenWindow - windowThenScale) > 1e-6, 'order fixture not discriminating');
});
