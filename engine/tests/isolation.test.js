import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { menuItem, realPack } from '../src/content/realPack.js';
import { engine, customPotion, T0, almost } from './helpers.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';
const GIVER = 'giver';
const OTHER = 'other';
const WHISKEY_TOTAL = 60 * 0.43 * 0.789 / 10;

function secretsOf(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return ['description', 'finish', 'flavor', 'effects', 'recipe', 'requestId', 'consumedRequestId', 'physiology', 'eval', 'sipResults']
    .filter((k) => k in obj && obj[k] != null);
}

test('I1 同一固定酒连续两杯各自结算性格与真实酒精，cupsDrunk=2', () => {
  const e = engine();
  const template = menuItem('威士忌');
  const id1 = e.createOffer(template, MIXER, MIXER, DRINKER, T0);
  const id2 = e.createOffer(template, MIXER, MIXER, DRINKER, T0);
  const a = e.drinkOffer(id1, DRINKER, 'r1', T0);
  const b = e.drinkOffer(id2, DRINKER, 'r2', T0);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.idempotent, false);
  assert.equal(b.idempotent, false);
  assert.ok(almost(a.eval.c, WHISKEY_TOTAL));
  assert.ok(almost(e.state.c, WHISKEY_TOTAL * 2));
  assert.ok(a.eval.characterStrength.守门 > 0);
  assert.ok(b.eval.characterStrength.守门 > a.eval.characterStrength.守门);
  assert.equal(e.state.cupsDrunk, 2);
});

test('I2 消费后原菜单模板与输入 cup 的 mouths 仍未 applied', () => {
  const e = engine();
  const template = menuItem('威士忌');
  const input = template;
  const id = e.createOffer(input, MIXER, MIXER, DRINKER, T0);
  e.drinkOffer(id, DRINKER, 'r1', T0);
  for (const m of menuItem('威士忌').mouths) {
    assert.equal(m.applied, false);
    assert.equal(m.startTime, null);
  }
  for (const m of input.mouths) {
    assert.equal(m.applied, false);
    assert.equal(m.startTime, null);
  }
});

test('I3 同款两个并存 offer 有不同杯实例 ID；喝一杯不改另一杯', () => {
  const e = engine();
  const template = menuItem('威士忌');
  const id1 = e.createOffer(template, MIXER, MIXER, DRINKER, T0);
  const id2 = e.createOffer(template, MIXER, MIXER, DRINKER, T0);
  const cup1 = e.offers.get(id1).cup;
  const cup2 = e.offers.get(id2).cup;
  assert.notEqual(cup1.id, cup2.id);
  assert.equal(cup1.recipeId, cup2.recipeId);
  const before2 = structuredClone(cup2.mouths);
  const remaining2 = cup2.remainingMouths;
  e.drinkOffer(id1, DRINKER, 'r1', T0);
  assert.equal(e.offers.get(id2).cup.id, cup2.id);
  assert.equal(e.offers.get(id2).cup.remainingMouths, remaining2);
  assert.deepEqual(e.offers.get(id2).cup.mouths.map((m) => ({ applied: m.applied, startTime: m.startTime })),
    before2.map((m) => ({ applied: m.applied, startTime: m.startTime })));
  assert.ok(e.offers.get(id2).cup.mouths.every((m) => m.applied === false));
  assert.equal(e.offers.get(id2).status, 'open');
});

test('I4 同毫秒两杯的逐口记录 ID 唯一，敏感度能绑到对应记录', () => {
  const e = engine();
  const template = menuItem('威士忌');
  const id1 = e.createOffer(template, MIXER, MIXER, DRINKER, T0);
  const id2 = e.createOffer(template, MIXER, MIXER, DRINKER, T0);
  const a = e.drinkOffer(id1, DRINKER, 'r1', T0);
  const b = e.drinkOffer(id2, DRINKER, 'r2', T0);
  const ids = [...a.sipResults, ...b.sipResults].map((r) => r.drinkRecordId);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  const before = e.state.sensitivity.精度;
  const ok = e.updateSensitivity(ids[0], '精度', '冲', T0);
  assert.equal(ok.ok, true);
  assert.ok(almost(e.state.sensitivity.精度, before + 0.1, 1e-9));
  const rec = e.state.records.find((r) => r.id === ids[0]);
  assert.equal(rec.sensitivityAxis, '精度');
  assert.notEqual(rec.cupId, e.state.records.find((r) => r.id === ids[2]).cupId);
});

test('I5 第三人再调 drinkOffer 未授权，响应无第二屏与原 requestId', () => {
  const e = engine();
  const id = e.createOffer(menuItem('威士忌'), MIXER, MIXER, DRINKER, T0);
  e.drinkOffer(id, DRINKER, 'req-original', T0);
  for (const req of ['req-original', 'req-other']) {
    const r = e.drinkOffer(id, OTHER, req, T0);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not_drinker');
    assert.ok(!('projection' in r));
    assert.ok(!('requestId' in r));
    assert.ok(!('consumedRequestId' in r));
    assert.ok(!('eval' in r));
    assert.equal(secretsOf(r).length, 0);
  }
  assert.equal(e.state.cupsDrunk, 1);
});

test('I6 restore 后第三人仍不能读幂等结果；饮用者可得同一结果且不重复入账', () => {
  const e = engine();
  const id = e.createOffer(menuItem('威士忌'), MIXER, MIXER, DRINKER, T0);
  const first = e.drinkOffer(id, DRINKER, 'req-1', T0);
  const json = JSON.stringify(e.exportState());
  const e2 = ProofEngine.restoreState(json, realPack);
  const third = e2.drinkOffer(id, OTHER, 'req-1', T0);
  assert.equal(third.ok, false);
  assert.equal(third.error, 'not_drinker');
  assert.ok(!('projection' in third));
  assert.ok(!('requestId' in third));
  const again = e2.drinkOffer(id, DRINKER, 'req-1', T0);
  assert.equal(again.ok, true);
  assert.equal(again.idempotent, true);
  assert.deepEqual(again.projection, first.projection);
  assert.ok(!('requestId' in again));
  assert.ok(almost(e2.state.c, first.eval.c, 1e-9));
  assert.equal(e2.state.cupsDrunk, 1);
});

test('I7 特调喝完后描述只对调制者与饮用者开放', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, GIVER, DRINKER, T0);
  e.drinkOffer(id, DRINKER, 'r1', T0);
  const mixer = e.viewOffer(id, MIXER, T0).projection;
  const drinker = e.viewOffer(id, DRINKER, T0).projection;
  const giver = e.viewOffer(id, GIVER, T0).projection;
  const other = e.viewOffer(id, OTHER, T0).projection;
  assert.ok('description' in mixer);
  assert.ok('description' in drinker);
  for (const p of [giver, other]) {
    assert.ok(!('description' in p));
    assert.ok(!('finish' in p));
    assert.ok(!('flavor' in p));
    assert.ok(!('effects' in p));
    assert.ok(!('recipe' in p));
  }
  assert.ok(!('recipe' in drinker));
});

test('I8 第三人拒绝不改状态；指定饮用者拒绝才成功', () => {
  const e = engine();
  const id = e.createOffer(menuItem('威士忌'), MIXER, MIXER, DRINKER, T0);
  const before = {
    status: e.offers.get(id).status,
    delivered: structuredClone(e.state.tonightDelivered),
    records: structuredClone(e.state.records),
    c: e.state.c,
    cupsDrunk: e.state.cupsDrunk
  };
  const denied = e.rejectOffer(id, OTHER, T0);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'not_drinker');
  assert.equal(e.offers.get(id).status, before.status);
  assert.deepEqual(e.state.tonightDelivered, before.delivered);
  assert.deepEqual(e.state.records, before.records);
  assert.equal(e.state.c, before.c);
  assert.equal(e.state.cupsDrunk, before.cupsDrunk);
  const ok = e.rejectOffer(id, DRINKER, T0);
  assert.equal(ok.ok, true);
  assert.equal(e.offers.get(id).status, 'rejected');
  assert.ok(e.state.records.some((r) => r.refused && r.offerId === id));
});

test('I9 饮用者、递酒者和第三人亮底均失败，recipeRevealedTo 与 β 不变', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, GIVER, DRINKER, T0);
  const offer = e.offers.get(id);
  const beforeReveal = [...(offer.recipeRevealedTo || [])];
  const beforeBeta = offer.cup.beta;
  for (const actor of [DRINKER, GIVER, OTHER]) {
    const r = e.revealRecipe(id, OTHER, actor);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not_mixer');
  }
  const missing = e.revealRecipe(id, OTHER);
  assert.equal(missing.ok, false);
  assert.deepEqual(e.offers.get(id).recipeRevealedTo, beforeReveal);
  assert.equal(e.offers.get(id).cup.beta, beforeBeta);
  assert.ok(e.offers.get(id).cup.mouths.every((m) => m.beta === beforeBeta));
});

test('I10 调制者向指定对象亮底后，仅调制者与该对象可见配方', () => {
  const e = engine();
  const cup = customPotion(1, 2);
  const id = e.createOffer(cup, MIXER, GIVER, DRINKER, T0);
  const ok = e.revealRecipe(id, OTHER, MIXER);
  assert.equal(ok.ok, true);
  assert.ok(e.viewOffer(id, MIXER, T0).projection.recipe);
  assert.ok(e.viewOffer(id, OTHER, T0).projection.recipe);
  assert.ok(!('recipe' in e.viewOffer(id, DRINKER, T0).projection));
  assert.ok(!('recipe' in e.viewOffer(id, GIVER, T0).projection));
});
