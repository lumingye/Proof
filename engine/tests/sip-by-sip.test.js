import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFromParts, cloneCup } from '../src/content/realPack.js';
import { engine, T0, almost } from './helpers.js';

const MIN = 60 * 1000;
function cup4(opts = {}) {
  return cloneCup(buildFromParts('四口杯', [{ id: '威士忌', volume: 60 }], { kind: 'menu', effects: { 愉悦: 2 }, totalMouths: 4, ...opts }));
}
function offerOf(e, cup, now = T0) { return e.createOffer(cup, 'mixer', 'mixer', 'me', now); }

test('SIP1 不传口数：整杯一次喝完，跟以前一样', () => {
  const e = engine();
  const id = offerOf(e, cup4());
  const r = e.drinkOffer(id, 'me', 'r1', T0);
  assert.equal(r.ok, true);
  assert.notEqual(r.partial, true);
  assert.equal(e.offers.get(id).status, 'consumed');
  assert.equal(e.sippingCup(T0), null);
});

test('SIP2 分两次喝：先 1 口挂着，再 3 口喝完；总效果跟一口闷相同', () => {
  const whole = engine();
  const wid = offerOf(whole, cup4());
  whole.drinkOffer(wid, 'me', 'w', T0);
  // 各自在喝完那一刻比：分口喝晚 20 分钟喝完，所以也晚 20 分钟才开始散。
  const wholeStrength = whole.evaluateCup(whole.state.currentCup, T0).characterStrength.愉悦;

  const e = engine();
  const id = offerOf(e, cup4());
  const first = e.drinkOffer(id, 'me', 'a', T0, { mouths: 1 });
  assert.equal(first.ok, true);
  assert.equal(first.partial, true);
  assert.equal(first.remainingMouths, 3);
  assert.equal(e.offers.get(id).status, 'sipping');
  const held = e.sippingCup(T0 + 10 * MIN);
  assert.equal(held.offerId, id);
  assert.equal(held.remainingMouths, 3);
  assert.equal(held.expiresInMin, 60);

  const second = e.drinkOffer(id, 'me', 'b', T0 + 20 * MIN, { mouths: 3 });
  assert.equal(second.ok, true);
  assert.notEqual(second.partial, true);
  assert.equal(e.offers.get(id).status, 'consumed');
  const sipStrength = e.evaluateCup(e.state.currentCup, T0 + 20 * MIN).characterStrength.愉悦;
  assert.ok(almost(sipStrength, wholeStrength, 1e-9), `分口 ${sipStrength} vs 整杯 ${wholeStrength}`);
});

test('SIP3 杯子没喝完之前六轴不衰减', () => {
  const e = engine();
  const id = offerOf(e, cup4());
  e.drinkOffer(id, 'me', 'a', T0, { mouths: 2 });
  const s0 = e.evaluateCup(e.state.currentCup, T0).characterStrength.愉悦;
  const s50 = e.evaluateCup(e.state.currentCup, T0 + 50 * MIN).characterStrength.愉悦;
  assert.ok(almost(s0, s50, 1e-9));
});

test('SIP4 同一个请求重发不会多喝一口', () => {
  const e = engine();
  const id = offerOf(e, cup4());
  e.drinkOffer(id, 'me', 'same', T0, { mouths: 1 });
  const again = e.drinkOffer(id, 'me', 'same', T0 + MIN, { mouths: 1 });
  assert.equal(again.idempotent, true);
  assert.equal(again.remainingMouths, 3);
});

test('SIP5 半杯挂着时点新的一杯：旧杯搁到吧台上（不作废），新杯照常喝', () => {
  const e = engine();
  const id = offerOf(e, cup4({ effectHalfLifeMin: 60 }));
  e.drinkOffer(id, 'me', 'a', T0, { mouths: 1 });
  const other = offerOf(e, cup4({ id: undefined }), T0 + MIN);
  const r = e.drinkOffer(other, 'me', 'b', T0 + MIN, { mouths: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.partial, true);
  assert.equal(r.putDown.offerId, id);
  assert.equal(r.putDown.shelved, true);
  assert.equal(r.putDown.remainingMouths, 3);
  assert.equal(r.putDown.expiresInMin, 69, '从最后一口（T0）起算 70 分钟');
  assert.equal(e.offers.get(id).status, 'shelved');
  assert.equal(e.sippingCup(T0 + MIN).offerId, other, '手里换成了新杯');
  assert.deepEqual(e.shelvedCups(T0 + MIN).map((x) => x.offerId), [id]);
  // 旧杯已经喝下去的那一口从搁下那一刻开始按自己的半衰期消退
  const oldRows = (e.state.characterResiduals || []).filter((x) => x.decayStart === T0 + MIN);
  assert.ok(oldRows.length > 0);
  assert.ok(oldRows.every((x) => x.halfLifeMin === 60));
});

test('SIP5b 整杯喝完的新杯也会带上 putDown；手里没半杯时不带', () => {
  const e = engine();
  const id = offerOf(e, cup4());
  e.drinkOffer(id, 'me', 'a', T0, { mouths: 2 });
  const other = offerOf(e, cup4({ id: undefined }), T0 + MIN);
  const r = e.drinkOffer(other, 'me', 'b', T0 + MIN);
  assert.equal(r.ok, true);
  assert.notEqual(r.partial, true);
  assert.equal(r.putDown.remainingMouths, 2);
  const third = offerOf(e, cup4({ id: undefined }), T0 + 2 * MIN);
  const r3 = e.drinkOffer(third, 'me', 'c', T0 + 2 * MIN);
  assert.equal(r3.ok, true);
  assert.equal(r3.putDown, undefined);
  assert.equal(e.putDownCup(T0 + 3 * MIN), null, '手里空着，放下什么也不做');
});

test('SIP5c 从吧台端回来接着喝：剩下的口还在，喝完算一整杯；手里那杯换上吧台', () => {
  const e = engine();
  const a = offerOf(e, cup4());
  e.drinkOffer(a, 'me', 'a1', T0, { mouths: 1 });
  const b = offerOf(e, cup4({ id: undefined }), T0 + MIN);
  e.drinkOffer(b, 'me', 'b1', T0 + MIN, { mouths: 1 });
  // 端回 A：B 换上吧台
  const back = e.drinkOffer(a, 'me', 'a2', T0 + 10 * MIN, { mouths: 1 });
  assert.equal(back.ok, true);
  assert.equal(back.partial, true);
  assert.equal(back.remainingMouths, 2);
  assert.equal(back.pickedUp.offerId, a);
  assert.equal(back.pickedUp.remainingMouths, 3);
  assert.equal(back.putDown.offerId, b);
  assert.equal(e.offers.get(b).status, 'shelved');
  assert.equal(e.sippingCup(T0 + 10 * MIN).offerId, a);
  assert.deepEqual(e.shelvedCups(T0 + 10 * MIN).map((x) => x.offerId), [b]);
  // 端回来的是新杯 id，原杯的口和总口数不变
  assert.notEqual(e.offers.get(a).cup.id, e.offers.get(a).cup.baseCupId);
  assert.equal(e.offers.get(a).cup.totalMouths, 4);
  // 喝完：A 消耗掉，cupsDrunk 只记一次
  const before = e.state.cupsDrunk;
  const fin = e.drinkOffer(a, 'me', 'a3', T0 + 11 * MIN, { mouths: 5 });
  assert.equal(fin.ok, true);
  assert.notEqual(fin.partial, true);
  assert.equal(e.offers.get(a).status, 'consumed');
  assert.equal(e.state.cupsDrunk, before + 1);
});

test('SIP5d 分三次、中间搁过吧台：酒精总量和一口闷一样（活性物按原 totalMouths 分摊）', () => {
  const whole = engine();
  whole.drinkOffer(offerOf(whole, cup4()), 'me', 'w', T0);
  const e = engine();
  const a = offerOf(e, cup4());
  e.drinkOffer(a, 'me', 'a1', T0, { mouths: 1 });
  const water = offerOf(e, cloneCup(buildFromParts('水', [{ id: '水', volume: 60 }], { kind: 'menu', totalMouths: 2 })), T0);
  e.drinkOffer(water, 'me', 'w1', T0, { mouths: 1 });
  e.drinkOffer(a, 'me', 'a2', T0, {});
  assert.ok(almost(e.state.lifetimeDrinks, whole.state.lifetimeDrinks, 1e-9), `${e.state.lifetimeDrinks} vs ${whole.state.lifetimeDrinks}`);
});

test('SIP5e 吧台上搁太久（离最后一口超过 70 分钟）就收走，再端报 cup_expired', () => {
  const e = engine();
  const a = offerOf(e, cup4());
  e.drinkOffer(a, 'me', 'a1', T0, { mouths: 1 });
  const b = offerOf(e, cup4({ id: undefined }), T0 + 30 * MIN);
  e.drinkOffer(b, 'me', 'b1', T0 + 30 * MIN, { mouths: 1 });
  assert.equal(e.shelvedCups(T0 + 69 * MIN).length, 1);
  assert.equal(e.shelvedCups(T0 + 71 * MIN).length, 0);
  assert.equal(e.offers.get(a).expiredReason, 'shelf_timeout');
  const late = e.drinkOffer(a, 'me', 'a2', T0 + 72 * MIN, { mouths: 1 });
  assert.equal(late.ok, false);
  assert.equal(late.error, 'cup_expired');
});

test('SIP5f 吧台上搁着的杯存档读档后还能端回来', () => {
  const e = engine();
  const a = offerOf(e, cup4());
  e.drinkOffer(a, 'me', 'a1', T0, { mouths: 1 });
  const b = offerOf(e, cup4({ id: undefined }), T0 + MIN);
  e.drinkOffer(b, 'me', 'b1', T0 + MIN, { mouths: 1 });
  const r = engine();
  r.restoreState(JSON.parse(JSON.stringify(e.exportState())));
  assert.equal(r.shelvedCups(T0 + 2 * MIN)[0].offerId, a);
  const back = r.drinkOffer(a, 'me', 'a2', T0 + 2 * MIN, {});
  assert.equal(back.ok, true);
  assert.equal(r.offers.get(a).status, 'consumed');
  assert.equal(r.offers.get(b).status, 'shelved');
});

test('SIP6 两口隔太久（超过 70 分钟）：杯子撤掉，再喝报 cup_expired，剩下的口作废，并开始衰减', () => {
  const e = engine();
  const id = offerOf(e, cup4({ effectHalfLifeMin: 60 }));
  e.drinkOffer(id, 'me', 'a', T0, { mouths: 1 });
  const late = T0 + 71 * MIN;
  assert.equal(e.sippingCup(late), null);
  const r = e.drinkOffer(id, 'me', 'b', late, { mouths: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'cup_expired');
  assert.equal(e.offers.get(id).status, 'expired');
  const rows = (e.state.characterResiduals || []).filter((x) => x.decayStart != null);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((x) => x.halfLifeMin === 60), '撤杯也按这杯自己的半衰期衰减');
});

test('SIP7 已经喝了几口的杯不能拒绝退回', () => {
  const e = engine();
  const id = offerOf(e, cup4());
  e.drinkOffer(id, 'me', 'a', T0, { mouths: 1 });
  const r = e.rejectOffer(id, 'me', T0 + MIN);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'already_sipping');
});

test('SIP8 口数乱填：小于 1 当 1，大于剩余当喝完', () => {
  const e = engine();
  const id = offerOf(e, cup4());
  assert.equal(e.drinkOffer(id, 'me', 'a', T0, { mouths: 0 }).remainingMouths, 3);
  const r = e.drinkOffer(id, 'me', 'b', T0 + MIN, { mouths: 99 });
  assert.notEqual(r.partial, true);
  assert.equal(e.offers.get(id).status, 'consumed');
});

test('SIP9 存档读档后还能接着喝', () => {
  const e = engine();
  const id = offerOf(e, cup4());
  e.drinkOffer(id, 'me', 'a', T0, { mouths: 1 });
  const data = JSON.parse(JSON.stringify(e.exportState()));
  const back = e.constructor.fromJSON ? e.constructor.fromJSON(data, e.contentPack) : null;
  const e2 = back || (() => { const x = engine(); x.restoreState(data); return x; })();
  assert.equal(e2.sippingCup(T0 + MIN)?.remainingMouths, 3);
  const r = e2.drinkOffer(id, 'me', 'b', T0 + 2 * MIN, { mouths: 3 });
  assert.equal(r.ok, true);
  assert.equal(e2.offers.get(id).status, 'consumed');
});
