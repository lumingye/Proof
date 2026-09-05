import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { menuItem, realPack } from '../src/content/realPack.js';
import { engine, customPotion, T0, almost } from './helpers.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';
const OTHER = 'other';
const EFFECT_AXES = ['愉悦', '唤醒', '亲近', '守门', '欲望'];

function stats(e) {
  return JSON.stringify({
    c: e.state.c,
    cupsDrunk: e.state.cupsDrunk,
    sensitivity: e.state.sensitivity,
    belief: e.state.beliefResiduals,
    delivered: e.state.tonightDelivered,
    records: e.state.records
  });
}

function assertZeroEffects(vec, label) {
  for (const axis of EFFECT_AXES) {
    assert.equal(vec?.[axis] || 0, 0, `${label}.${axis}`);
  }
}

test('L1 饮用前向 drinker 亮底后，cup 与所有 mouths 的 β 和 suggestion 均为 0', () => {
  const e = engine();
  const id = e.createOffer(customPotion(1, 2), MIXER, MIXER, DRINKER, T0);
  const cup = e.offers.get(id).cup;
  assert.equal(cup.beta, 1);
  const r = e.revealRecipe(id, DRINKER, MIXER);
  assert.equal(r.ok, true);
  assert.equal(cup.beta, 0);
  assert.equal(cup.mouths.length, 2);
  for (const m of cup.mouths) {
    assert.equal(m.applied, false);
    assert.equal(m.beta, 0);
    assertZeroEffects(m.suggestion, 'suggestion');
    assert.equal(m.suggestion.精度, 0);
  }
});

test('L2 饮用前完整亮底后再喝，酒精味觉入账，信念累计为 0', () => {
  const e = engine();
  const id = e.createOffer(customPotion(1, 2), MIXER, MIXER, DRINKER, T0);
  e.revealRecipe(id, DRINKER, MIXER);
  const cup = e.offers.get(id).cup;
  const drunk = e.drinkOffer(id, DRINKER, 'r1', T0);
  assert.equal(drunk.ok, true);
  assert.equal(e.state.cupsDrunk, 1);
  assert.ok(cup.mouths.every((m) => m.applied));
  assert.ok(drunk.eval.intermediates[5]);
  assert.ok(drunk.eval.intermediates[6]);
  const residual = e.state.beliefResiduals.find((x) => x.cupId === cup.id);
  if (residual) assertZeroEffects(residual.cumulative, 'residual');
  assertZeroEffects(drunk.eval.beliefStrength, 'beliefStrength');
});

test('L3 饮用前向 OTHER 亮底不改变 drinker 的 β', () => {
  const e = engine();
  const id = e.createOffer(customPotion(1, 2), MIXER, MIXER, DRINKER, T0);
  const cup = e.offers.get(id).cup;
  const before = {
    beta: cup.beta,
    mouths: cup.mouths.map((m) => ({ beta: m.beta, suggestion: structuredClone(m.suggestion) }))
  };
  e.revealRecipe(id, OTHER, MIXER);
  assert.ok('recipe' in e.viewOffer(id, OTHER, T0).projection);
  assert.equal(cup.beta, before.beta);
  cup.mouths.forEach((m, i) => {
    assert.equal(m.beta, before.mouths[i].beta);
    assert.deepEqual(m.suggestion, before.mouths[i].suggestion);
  });
});

test('L4 先喝第一口再向 drinker 亮底：已累计保留，后续口 β=0 且不再增加信念', () => {
  const e = engine();
  // 这里专测“外部声称名字”的旧 β 路径：把真实酒款性格拿掉，等价于别的液体被声称成迷情剂。
  const claimedOnly = customPotion(1, 2);
  claimedOnly.characterEffects = null;
  claimedOnly.characterIdentity = null;
  const id = e.createOffer(claimedOnly, MIXER, MIXER, DRINKER, T0);
  const cup = e.offers.get(id).cup;
  e.applyMouth(cup, 0, T0);
  const residual = e.state.beliefResiduals.find((x) => x.cupId === cup.id);
  assert.ok(residual);
  const kept = structuredClone(residual.cumulative);
  assert.ok(kept.愉悦 > 0);
  e.revealRecipe(id, DRINKER, MIXER);
  assert.equal(cup.mouths[0].applied, true);
  assert.ok(cup.mouths[0].beta !== 0);
  assert.equal(cup.mouths[1].applied, false);
  assert.equal(cup.mouths[1].beta, 0);
  assertZeroEffects(cup.mouths[1].suggestion, 'later suggestion');
  e.applyMouth(cup, 1, T0);
  const after = e.state.beliefResiduals.find((x) => x.cupId === cup.id);
  assert.deepEqual(after.cumulative, kept);
});

test('L5 饮用前亮底后 export/restore，再喝下 β 与信念结果一致', () => {
  const e = engine();
  const id = e.createOffer(customPotion(1, 2), MIXER, MIXER, DRINKER, T0);
  e.revealRecipe(id, DRINKER, MIXER);
  const json = JSON.stringify(e.exportState());
  const e2 = ProofEngine.restoreState(json, realPack);
  const cup = e2.offers.get(id).cup;
  assert.equal(cup.beta, 0);
  assert.ok(cup.mouths.every((m) => m.beta === 0));
  const drunk = e2.drinkOffer(id, DRINKER, 'r1', T0);
  assert.equal(drunk.ok, true);
  assertZeroEffects(drunk.eval.beliefStrength, 'restored belief');
  const residual = e2.state.beliefResiduals.find((x) => x.cupId === cup.id);
  if (residual) assertZeroEffects(residual.cumulative, 'restored residual');
});

test('L6 同一 open offer 连续 reject 两次：状态 rejected，拒绝记录恰好一条，ID 唯一', () => {
  const e = engine();
  const id = e.createOffer(menuItem('威士忌'), MIXER, MIXER, DRINKER, T0);
  const a = e.rejectOffer(id, DRINKER, T0);
  const b = e.rejectOffer(id, DRINKER, T0);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(e.offers.get(id).status, 'rejected');
  const rejects = e.state.records.filter((r) => r.type === '拒绝' && r.offerId === id);
  assert.equal(rejects.length, 1);
  const ids = e.state.records.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('L7 expire 后 reject：保持 expired，不新增拒绝记录', () => {
  const e = engine();
  const id = e.createOffer(menuItem('威士忌'), MIXER, MIXER, DRINKER, T0);
  e.expireOffer(id, T0);
  const before = e.state.records.length;
  const r = e.rejectOffer(id, DRINKER, T0);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'expired');
  assert.equal(e.offers.get(id).status, 'expired');
  assert.equal(e.state.records.filter((x) => x.type === '拒绝').length, 0);
  assert.equal(e.state.records.length, before);
});

test('L8 reject 后 expire：保持 rejected，不覆盖终态、不增记录', () => {
  const e = engine();
  const id = e.createOffer(menuItem('威士忌'), MIXER, MIXER, DRINKER, T0);
  e.rejectOffer(id, DRINKER, T0);
  const before = e.state.records.length;
  const r = e.expireOffer(id, T0);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'rejected');
  assert.equal(e.offers.get(id).status, 'rejected');
  assert.equal(e.state.records.length, before);
});

test('L9 对 rejected/expired 重复终态操作不改酒精、信念、敏感度、统计和记录', () => {
  const e = engine();
  const rej = e.createOffer(menuItem('威士忌'), MIXER, MIXER, DRINKER, T0);
  const exp = e.createOffer(menuItem('伏特加'), MIXER, MIXER, DRINKER, T0);
  e.rejectOffer(rej, DRINKER, T0);
  e.expireOffer(exp, T0);
  const snap = stats(e);
  e.rejectOffer(rej, DRINKER, T0);
  e.expireOffer(rej, T0);
  e.expireOffer(exp, T0);
  e.rejectOffer(exp, DRINKER, T0);
  assert.equal(stats(e), snap);
  assert.equal(e.offers.get(rej).status, 'rejected');
  assert.equal(e.offers.get(exp).status, 'expired');
});

test('L10 restore 后 rejected 与 expired 仍遵守终态规则', () => {
  const e = engine();
  const rej = e.createOffer(menuItem('威士忌'), MIXER, MIXER, DRINKER, T0);
  const exp = e.createOffer(menuItem('伏特加'), MIXER, MIXER, DRINKER, T0);
  e.rejectOffer(rej, DRINKER, T0);
  e.expireOffer(exp, T0);
  const e2 = ProofEngine.restoreState(JSON.stringify(e.exportState()), realPack);
  const snap = stats(e2);
  const r1 = e2.rejectOffer(rej, DRINKER, T0);
  const r2 = e2.expireOffer(exp, T0);
  const r3 = e2.rejectOffer(exp, DRINKER, T0);
  const r4 = e2.expireOffer(rej, T0);
  assert.equal(e2.offers.get(rej).status, 'rejected');
  assert.equal(e2.offers.get(exp).status, 'expired');
  assert.equal(r3.ok, false);
  assert.equal(r4.ok, false);
  assert.equal(stats(e2), snap);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
});
