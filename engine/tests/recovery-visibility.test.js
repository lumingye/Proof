// 恢复可见度（Proof 权威）—— 断片恢复「能想起多少」由 Proof 决定，Gateway 只调用。
//
// 本文件只测 lifecycle.js 的恢复可见度判定，不触碰断片生命周期
// （openBlackout / restoreAt / liftBlackouts / pruneTransient 另有测试）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecoveryVisibility, recoveryAllowsVerbatim, migrateBlackoutBatch, resolveLifecycleConfig, RECOVERY_RESOLUTIONS } from '../src/core/lifecycle.js';

const cfg = resolveLifecycleConfig({});

test('默认口径：软断片 full、硬断片 facts（用户设计 §17）', () => {
  assert.deepEqual(resolveRecoveryVisibility({ mode: 'soft' }), { resolution: 'full', ratio: 1, stages: 1 });
  assert.deepEqual(resolveRecoveryVisibility({ mode: 'hard' }), { resolution: 'facts', ratio: 1, stages: 1 });
  assert.deepEqual(resolveRecoveryVisibility({}), { resolution: 'full', ratio: 1, stages: 1 }, '缺 mode 按软断片');
});

test('硬断片：原文仍在也只允许少量事实，不得给逐字', () => {
  const vis = resolveRecoveryVisibility({ mode: 'hard' });
  assert.equal(recoveryAllowsVerbatim(vis), false);
  assert.equal(vis.resolution, 'facts');
});

test('Proof 可显式声明 partial / ratio / stages', () => {
  const vis = resolveRecoveryVisibility({ mode: 'soft', recovery: { resolution: 'partial', ratio: 0.5, stages: 2 } });
  assert.equal(vis.resolution, 'partial');
  assert.equal(vis.ratio, 0.5);
  assert.equal(vis.stages, 2);
  assert.equal(recoveryAllowsVerbatim(vis), true, 'partial 仍允许逐字，只是只给一部分');
});

test('非法声明回落到默认口径，不抛错也不静默放大权限', () => {
  assert.equal(resolveRecoveryVisibility({ mode: 'soft', recovery: { resolution: 'nope' } }).resolution, 'full');
  assert.equal(resolveRecoveryVisibility({ mode: 'soft', recovery: { resolution: 'partial', ratio: 9 } }).ratio, 1);
  assert.equal(resolveRecoveryVisibility({ mode: 'soft', recovery: { ratio: -3, resolution: 'partial' } }).ratio, 0);
  assert.equal(resolveRecoveryVisibility({ mode: 'soft', recovery: { stages: 0 } }).stages, 1);
  assert.equal(resolveRecoveryVisibility({ mode: 'soft', recovery: null }).stages, 1);
  // partial 未给 ratio 时不默认放大到 full
  assert.equal(resolveRecoveryVisibility({ mode: 'soft', recovery: { resolution: 'partial' } }).ratio, 1);
});

test('可见度只影响恢复，不能被误用成遮蔽判定：readable/restoreAt 不受影响', () => {
  const batch = { mode: 'soft', readable: false, restoreAt: 123 };
  const vis = resolveRecoveryVisibility(batch);
  assert.equal(vis.resolution, 'full');
  assert.equal(batch.readable, false, '读可见度不得改写批次');
  assert.equal(batch.restoreAt, 123);
});

test('recovery 描述符经 hydrate 迁移后保持不变（幂等）', () => {
  const raw = { start: 1000, mode: 'soft', recovery: { resolution: 'partial', ratio: 0.5, stages: 2 } };
  const once = migrateBlackoutBatch(raw, cfg);
  const twice = migrateBlackoutBatch(once, cfg);
  assert.deepEqual(twice, once, '迁移幂等');
  assert.deepEqual(resolveRecoveryVisibility(once), { resolution: 'partial', ratio: 0.5, stages: 2 });
  assert.deepEqual(resolveRecoveryVisibility(twice), resolveRecoveryVisibility(once));
});

test('未声明 recovery 的旧批次迁移后不补字段，可见度仍按 mode 走默认', () => {
  const once = migrateBlackoutBatch({ start: 1000, mode: 'hard' }, cfg);
  assert.equal('recovery' in once, false, '缺省不补 recovery');
  assert.equal(resolveRecoveryVisibility(once).resolution, 'facts');
  assert.deepEqual(migrateBlackoutBatch(once, cfg), once, '迁移幂等');
});

test('可选分辨率集合封闭：只有 full / partial / facts', () => {
  assert.deepEqual([...RECOVERY_RESOLUTIONS], ['full', 'partial', 'facts']);
});
