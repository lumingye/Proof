import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../../../engine/src/engine/ProofEngine.js';
import { realPack, cloneCup, menuItem, hiddenHeaven } from '../../../engine/src/content/realPack.js';
import { createTurnBridge } from '../../../engine/src/runtime/turnBridge.js';

const T0 = 1_700_000_000_000;

test('AUDIT-outlet 注入桥：关则无，开则每轮取当前合成状态，不含配方', () => {
  const engines = new Map();
  engines.set('agent-a', new ProofEngine(null, realPack));
  const bridge = createTurnBridge({ getEngine: (id) => engines.get(id), agentId: 'agent-a' });
  const off = bridge.beforeModelTurn(T0);
  assert.equal(off.injected, false);
  const e = engines.get('agent-a');
  e.setStateInjection(true);
  const cup = cloneCup(menuItem('威士忌'), { totalMouths: 2 });
  e.sipAll(cup, T0);
  const on = bridge.beforeModelTurn(T0);
  assert.equal(on.injected, true);
  assert.ok(on.block.text.startsWith('[Proof 状态]'));
  assert.equal(on.block.text.includes('威士忌'), false);
  assert.equal(JSON.stringify(on.block).includes('physiology'), false);
  e.setStateInjection(false);
  assert.equal(bridge.beforeModelTurn(T0).injected, false);
});

test('AUDIT-outlet 公开菜单不含 heaven；迷情剂按第16节应可点', () => {
  const e = new ProofEngine(null, realPack);
  const names = e.publicMenu().map((m) => m.claimedName);
  assert.equal(names.includes('heaven'), false);
  assert.equal(names.includes(hiddenHeaven.claimedName), false);
  assert.equal(names.includes('迷情剂'), true);
});
