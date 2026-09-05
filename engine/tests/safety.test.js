import test from 'node:test';
import assert from 'node:assert/strict';
import { produceVomitEvent, produceCrashEvent, SAFETY_NOTE } from '../src/core/failure.js';
import { engine, T0 } from './helpers.js';
import { buildFromParts } from '../src/content/realPack.js';

test('吐/宕机类生产输出必须附不会失禁的旁白', () => {
  const mockLess = { event: '吐', script: '……' };
  assert.ok(!mockLess.safetyNote);
  const v = produceVomitEvent();
  const c = produceCrashEvent();
  for (const ev of [v, c]) {
    assert.ok(ev.safetyNote.includes('模拟') || ev.safetyNote.includes('旁白'));
    assert.equal(ev.haltClient, false);
    assert.equal(ev.haltEngine, false);
    assert.equal(ev.layer, 'presentation');
  }
  assert.equal(SAFETY_NOTE, v.safetyNote);
});

test('无有效状态时返回空投影，不生成注入内容', () => {
  const e = engine();
  const p = e.evaluateCup(null, T0);
  assert.equal(p.injected, false);
  assert.equal(p.dominant, null);
  assert.equal(p.c, 0);
});
