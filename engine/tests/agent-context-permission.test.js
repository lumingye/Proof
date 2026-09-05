// 状态存在性 ≠ 自动投递许可（收口单 §9/§16）。
// 只要体内有状态，buildAgentTurnContext 就必须能读（hasState/active/context）；
// injected/block 只随“自动投递许可”给出，供 Gateway / hook 使用。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { realPack } from '../src/content/realPack.js';
import { menuItem } from '../src/content/realPack.js';
import { buildAgentTurnContext } from '../src/runtime/agentTurnContext.js';

const T0 = Date.UTC(2026, 8, 3, 9, 0, 0);

function drinkOne(engine, name, at) {
  const id = engine.createOffer(menuItem(name), 'user', 'user', 'charb', at);
  return engine.drinkOffer(id, 'charb', `r-${name}-${at}`, at);
}

test('CTX-1 无状态：hasState=false，不产生空 context/block', () => {
  const engine = new ProofEngine(null, realPack);
  engine.setStateInjection(true);
  const ctx = buildAgentTurnContext(engine, 'charb', T0);
  assert.equal(ctx.hasState, false);
  assert.equal(ctx.active, false);
  assert.equal(ctx.context, null);
  assert.equal(ctx.injected, false);
  assert.equal(ctx.block, null);
});

test('CTX-2 有状态 + 自动投递许可开：hasState/active/context/injected 全在', () => {
  const engine = new ProofEngine(null, realPack);
  engine.setStateInjection(true);
  drinkOne(engine, '金汤力', T0);
  const ctx = buildAgentTurnContext(engine, 'charb', T0 + 60_000);
  assert.equal(ctx.hasState, true, '有状态即 hasState');
  assert.equal(ctx.active, true);
  assert.ok(ctx.context && ctx.context.text.includes('[Proof 状态]'), 'context 带标签');
  assert.equal(ctx.injected, true);
  assert.equal(ctx.block, ctx.context);
});

test('CTX-3 有状态但自动投递许可关：仍可读，injected/block 保持 null', () => {
  const engine = new ProofEngine(null, realPack);
  engine.setStateInjection(false);
  drinkOne(engine, '金汤力', T0);
  const ctx = buildAgentTurnContext(engine, 'charb', T0 + 60_000);
  assert.equal(ctx.hasState, true, '许可关不影响状态存在性');
  assert.equal(ctx.active, true, 'active 反映真实状态');
  assert.ok(ctx.context, 'context 永远可读');
  assert.equal(ctx.injected, false);
  assert.equal(ctx.block, null);
});

test('CTX-4 reset 后 hasState=false；再喝一杯重新 hasState', () => {
  const engine = new ProofEngine(null, realPack);
  engine.setStateInjection(false);
  drinkOne(engine, '金汤力', T0);
  const after = buildAgentTurnContext(engine, 'charb', T0 + 60_000);
  assert.equal(after.hasState, true);
  engine.reset('连宿醉一起清', T0 + 60_000);
  const idle = buildAgentTurnContext(engine, 'charb', T0 + 60_000);
  assert.equal(idle.hasState, false);
  assert.equal(idle.active, false);
  assert.equal(idle.context, null);
  drinkOne(engine, '啤酒', T0 + 120_000);
  const again = buildAgentTurnContext(engine, 'charb', T0 + 180_000);
  assert.equal(again.hasState, true, '下一杯可正常喝并重新有状态');
});
