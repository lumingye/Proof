import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { engine, whiskey, T0, almost } from './helpers.js';
import { cloneCup, menuItem, realPack } from '../src/content/realPack.js';
import { publicEffectDescription } from '../src/core/effects.js';

const MIXER = 'mixer';
const DRINKER = 'drinker';
const OTHER = 'other';
const LEAK_KEYS = ['delta', 'actualState', 'counterfactualState', 'axis', 'tier', 'direction'];

function leakKeys(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [k, v] of Object.entries(value)) {
    if (LEAK_KEYS.includes(k)) found.push(k);
    leakKeys(v, found);
  }
  return found;
}

function effectEvents(e) {
  return (e.state.lastEvents || []).filter((x) => x.type === '本杯效果');
}

function effectRecords(e, cupId) {
  return e.state.records.filter((r) => r.type === '本杯效果' && (!cupId || r.cupId === cupId));
}

test('P1-1 公开投影不含反事实数值、轴、档、方向', () => {
  const e = engine();
  const id = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const r = e.drinkOffer(id, DRINKER, 'r1', T0);
  const drinker = e.viewOffer(id, DRINKER, T0).projection;
  const mixer = e.viewOffer(id, MIXER, T0).projection;
  const other = e.viewOffer(id, OTHER, T0).projection;
  for (const p of [r.projection, drinker, mixer]) {
    assert.ok(p.actualEffectDescription);
    assert.deepEqual(Object.keys(p.actualEffectDescription), ['text']);
    assert.equal(typeof p.actualEffectDescription.text, 'string');
    assert.deepEqual(leakKeys(p), []);
  }
  assert.ok(!('actualEffectDescription' in other));
  assert.deepEqual(leakKeys(other), []);
  assert.deepEqual(leakKeys(e.state.currentCup.actualEffectDescription), []);
});

test('P1-1 词库缺失时文案为空，不得用轴档方向顶替', () => {
  const assembled = {
    dominant: '唤醒',
    delta: { 唤醒: 2 },
    phrases: [{ axis: '唤醒', tier: '中', direction: '+', text: null }]
  };
  assert.deepEqual(publicEffectDescription(assembled), { text: '' });
});

test('P1-1 有词库时公开描述只有组装正文', () => {
  const pack = {
    ...realPack,
    effectLexicon: {
      愉悦: { '+': { 低: '轻快了一点', 中: '心里松了', 高: '很高兴' } },
      唤醒: { '+': { 低: '微微醒了', 中: '醒了', 高: '很醒' }, '−': { 低: '沉了点', 中: '发沉', 高: '很沉' } },
      精度: { '−': { 低: '略糊', 中: '糊了', 高: '很糊' } }
    }
  };
  const e = new ProofEngine(null, pack);
  const id = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const r = e.drinkOffer(id, DRINKER, 'r-lex', T0);
  const desc = r.projection.actualEffectDescription;
  assert.deepEqual(Object.keys(desc), ['text']);
  assert.equal(typeof desc.text, 'string');
  assert.deepEqual(leakKeys(desc), []);
  if (desc.text.length > 0) {
    assert.equal(desc.text.includes('axis'), false);
    assert.equal(/愉悦|唤醒|精度/.test(JSON.stringify(Object.keys(desc))), false);
  }
});

test('v11f actualEffectDescription 不得透出剂量与信念通道明细', () => {
  const assembled = {
    text: '合并后的效果',
    doseContribution: { 唤醒: 0 },
    beliefContribution: { 唤醒: 2 },
    channelRatios: { dose: 0, belief: 1 },
    phrases: [{ text: '合并后的效果', channel: 'belief' }]
  };
  assert.deepEqual(publicEffectDescription(assembled), { text: '合并后的效果' });
});

test('P1-2 69 分钟未过期，reset 仍拒绝且杯未关', () => {
  const e = engine();
  const cup = whiskey();
  e.applyMouth(cup, 0, T0);
  const denied = e.reset('醒酒', T0 + 69 * 60 * 1000);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, '当前杯尚未结算');
  assert.equal(e.state.currentCup.closed, false);
  assert.equal(e.state.currentCup.expired, false);
  assert.equal(e.state.currentCup.remainingMouths, 1);
});

test('P1-2 70 分钟边界先过期结算，再允许 reset', () => {
  const e = engine();
  const cup = whiskey();
  cup.mixerId = MIXER;
  cup.drinkerId = DRINKER;
  e.applyMouth(cup, 0, T0);
  const allowed = e.reset('醒酒', T0 + 70 * 60 * 1000);
  assert.notEqual(allowed.ok, false);
  assert.ok(e.state.currentCup.closed);
  assert.ok(e.state.currentCup.expired);
  assert.equal(e.state.c, 0);
  assert.equal(effectEvents(e).length, 1);
});

test('P1-2 71 分钟同样先结算再 reset，过期只执行一次', () => {
  const e = engine();
  const id = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const cup = e.offers.get(id).cup;
  e.applyMouth(cup, 0, T0);
  e.settle(T0 + 71 * 60 * 1000);
  assert.ok(e.state.currentCup.expired);
  const eventsAfterFirst = effectEvents(e).length;
  const recordsAfterFirst = effectRecords(e, cup.id).length;
  const desc = e.state.currentCup.actualEffectDescription;
  const k = e.state.sensitivity.守门;
  e.settle(T0 + 71 * 60 * 1000);
  e.settle(T0 + 80 * 60 * 1000);
  assert.equal(effectEvents(e).length, eventsAfterFirst);
  assert.equal(effectRecords(e, cup.id).length, recordsAfterFirst);
  assert.deepEqual(e.state.currentCup.actualEffectDescription, desc);
  assert.equal(e.state.sensitivity.守门, k);
  const resetOk = e.reset('连宿醉一起清', T0 + 80 * 60 * 1000);
  assert.notEqual(resetOk.ok, false);
  assert.equal(e.state.c, 0);
});

test('P1-3 最后一口生成一次只给饮用者的效果事件', () => {
  const e = engine();
  const id = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const cup = e.offers.get(id).cup;
  const first = e.applyMouth(cup, 0, T0);
  assert.equal(first.events.filter((x) => x.type === '本杯效果').length, 0);
  const last = e.applyMouth(cup, 1, T0 + 1);
  const ev = last.events.filter((x) => x.type === '本杯效果');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].recipient, DRINKER);
  assert.deepEqual(Object.keys(ev[0].actualEffectDescription), ['text']);
  const other = e.viewOffer(id, OTHER, T0 + 1).projection;
  assert.ok(!('actualEffectDescription' in other));
  assert.equal(other.events, undefined);
  const rec = effectRecords(e, cup.id);
  assert.equal(rec.length, 1);
  assert.ok(rec[0].visibleTo.includes(DRINKER));
  assert.ok(rec[0].visibleTo.includes(MIXER));
});

test('P1-3 部分喝后过期只生成一次饮用者事件', () => {
  const e = engine();
  const id = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const cup = e.offers.get(id).cup;
  e.applyMouth(cup, 0, T0);
  e.settle(T0 + 70 * 60 * 1000);
  const ev = effectEvents(e);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].recipient, DRINKER);
  const drinker = e.viewOffer(id, DRINKER, T0 + 70 * 60 * 1000).projection;
  const mixer = e.viewOffer(id, MIXER, T0 + 70 * 60 * 1000).projection;
  const other = e.viewOffer(id, OTHER, T0 + 70 * 60 * 1000).projection;
  assert.ok(drinker.actualEffectDescription);
  assert.ok(mixer.actualEffectDescription);
  assert.ok(!('actualEffectDescription' in other));
  e.settle(T0 + 90 * 60 * 1000);
  assert.equal(effectEvents(e).length, 1);
  assert.equal(effectRecords(e, cup.id).length, 1);
});

test('P1-3 export/restore 后过期仍只生成一次，不重算不重发', () => {
  const e = engine();
  const id = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  const cup = e.offers.get(id).cup;
  const r = e.applyMouth(cup, 0, T0);
  e.updateSensitivity(r.drinkRecordId, '守门', '淡', T0);
  const beforeSens = e.state.sensitivity.守门;
  const json = JSON.stringify(e.exportState());
  const e2 = ProofEngine.restoreState(json, e.contentPack);
  const restoredCup = e2.state.currentCup;
  e2.settle(T0 + 70 * 60 * 1000);
  assert.ok(e2.state.currentCup.expired);
  assert.equal(effectEvents(e2).length, 1);
  assert.equal(effectEvents(e2)[0].recipient, DRINKER);
  assert.equal(e2.state.pendingSensitivity.length, 0);
  assert.ok(almost(e2.state.sensitivity.守门, beforeSens - 0.1, 1e-9));
  const after = e2.state.sensitivity.守门;
  e2.settle(T0 + 80 * 60 * 1000);
  const e3 = ProofEngine.restoreState(e2.exportState(), e.contentPack);
  e3.settle(T0 + 90 * 60 * 1000);
  e3.viewOffer(id, DRINKER, T0 + 90 * 60 * 1000);
  e3.viewOffer(id, DRINKER, T0 + 90 * 60 * 1000);
  assert.equal(effectEvents(e3).length, 1);
  assert.equal(effectRecords(e3, restoredCup.id).length, 1);
  assert.equal(e3.state.sensitivity.守门, after);
  assert.equal(e3.state.pendingSensitivity.length, 0);
});

test('P1-3 重复打开持久记录不重发', () => {
  const e = engine();
  const id = e.createOffer(whiskey(), MIXER, MIXER, DRINKER, T0);
  e.drinkOffer(id, DRINKER, 'once', T0);
  assert.equal(effectEvents(e).length, 1);
  e.viewOffer(id, DRINKER, T0);
  e.viewOffer(id, MIXER, T0);
  e.drinkOffer(id, DRINKER, 'once-again', T0);
  assert.equal(effectEvents(e).length, 1);
  const cupId = e.offers.get(id).cup.id;
  assert.equal(effectRecords(e, cupId).length, 1);
});
