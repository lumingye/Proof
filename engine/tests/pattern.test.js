// 补充单：口味句式骨架互斥（pattern）与稳定轮换。
// 判据：不只是不许重复用词，同一杯里出的几条，句子骨架不能一样。

import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, T0 } from './helpers.js';
import { buildFromParts } from '../src/content/realPack.js';
import { realPack } from '../src/content/realPack.js';
import { assembleFlavorDescription } from '../src/core/flavor.js';
import { FLAVOR_AXES } from '../src/core/constants.js';

const LEX = realPack.flavorLexicon;

test('词库结构：每档每轴至少 2 种骨架，pattern 标签全库唯一', () => {
  const labels = [];
  const texts = [];
  for (const axis of FLAVOR_AXES) {
    for (const tier of ['低', '中', '高']) {
      const entries = LEX[axis]?.[tier];
      assert.ok(Array.isArray(entries), `${axis}${tier} 应为数组格式`);
      assert.ok(entries.length >= 2, `${axis}${tier} 至少 2 种骨架`);
      for (const e of entries) {
        assert.ok(typeof e.pattern === 'string' && e.pattern.length > 0, `${axis}${tier} 词条缺 pattern`);
        assert.ok(typeof e.text === 'string' && e.text.length > 0, `${axis}${tier} 词条缺 text`);
        labels.push(e.pattern);
        texts.push(e.text);
      }
    }
  }
  assert.equal(new Set(labels).size, labels.length, 'pattern 标签不得重复');
  assert.equal(new Set(texts).size, texts.length, '词条文案不得重复');
});

test('char 实测「深夜困倦」：甜/香同落低档不再共用骨架', () => {
  const out = assembleFlavorDescription({ 甜: 1.48, 香: 1.22 }, LEX, {}, 'deep-night');
  assert.equal(out.phrases.length, 2, '两条都应出词');
  assert.equal(new Set(out.patterns).size, 2, '骨架互斥');
  const occurrences = (s) => out.text.split(s).length - 1;
  assert.ok(occurrences('似有似无') <= 1, '同一骨架至多出现一次，不得两句同模子');
  assert.equal(out.phrases[0] === out.phrases[1], false, '两句文字不得相同');
});

test('稳定轮换：同一杯反复读必须得到同一段文字', () => {
  const flavor = { 烈: 1.2, 甜: 2.8, 苦: 1.9, 香: 3.4 };
  const a = assembleFlavorDescription(flavor, LEX, {}, 'cup-stable');
  const b = assembleFlavorDescription(flavor, LEX, {}, 'cup-stable');
  const c = assembleFlavorDescription(flavor, LEX, {}, 'cup-stable');
  assert.deepEqual([a.text, a.patterns], [b.text, b.patterns]);
  assert.deepEqual([b.text, b.patterns], [c.text, c.patterns]);
});

test('轮换分布：不同杯确实换骨架，且每杯内部骨架唯一', () => {
  const flavor = { 甜: 1.4, 香: 1.3 };
  const seenFirstPatterns = new Set();
  for (let i = 0; i < 40; i++) {
    const out = assembleFlavorDescription(flavor, LEX, {}, `cup-${i}`);
    assert.equal(new Set(out.patterns).size, out.patterns.length, '单杯骨架唯一');
    seenFirstPatterns.add(out.patterns[0]);
  }
  assert.ok(seenFirstPatterns.size >= 2, '不同杯应轮换出不同骨架');
});

test('骨架互斥：冲突时按轴值高低保留，被顶掉的不出词（宁可少一句）', () => {
  // 构造一个共享骨架的旧式/第三方词库：甜与香共用同一句式
  const clashLex = {
    甜: { 低: [{ pattern: '共用', text: '甜共用句式一。' }] },
    香: { 低: [{ pattern: '共用', text: '香共用句式二。' }] }
  };
  const out = assembleFlavorDescription({ 甜: 1.48, 香: 1.22 }, clashLex, {}, 'clash');
  assert.equal(out.phrases.length, 1, '冲突时只出一句');
  assert.equal(out.phrases[0], '甜共用句式一。', '轴值更高者（甜 1.48）保留');
});

test('旧格式词库仍可工作（兼容）', () => {
  const legacyLex = { 甜: { 低: '旧式甜句。' } };
  const out = assembleFlavorDescription({ 甜: 1.4 }, legacyLex, {}, 'legacy');
  assert.equal(out.text, '旧式甜句。');
  assert.deepEqual(out.patterns, ['旧式甜句。']);
});

test('全引擎链路：同一杯两次完整结算得到同一段口味描述', () => {
  const flavorA = { 烈: 0.5, 甜: 1.48, 香: 1.22, 苦: 1.4 };
  const mk = () => buildFromParts('两读杯', [{ id: '威士忌', volume: 30 }, { id: '咖啡利口酒', volume: 20 }, { id: '糖浆', volume: 10 }], { kind: 'custom', finish: '' });
  const e1 = engine();
  const id1 = e1.createOffer(mk(), 'user', 'user', 'char', T0);
  const r1 = e1.drinkOffer(id1, 'char', 'req-a', T0 + 60_000);
  // 幂等重放
  const r2 = e1.drinkOffer(id1, 'char', 'req-a', T0 + 120_000);
  assert.equal(r2.idempotent, true);
  assert.equal(r1.projection.flavorDescription, r2.projection.flavorDescription, '同一杯幂等重放文字不变');
  assert.ok(r1.projection.flavorDescription.length > 0);
  // 独立引擎 + 同配方（新杯新 id）：也稳定（各自确定性）
  const e2 = engine();
  const id2 = e2.createOffer(mk(), 'user', 'user', 'char', T0);
  const s1 = e2.drinkOffer(id2, 'char', 'req-b', T0 + 60_000).projection.flavorDescription;
  const s2 = e2.drinkOffer(id2, 'char', 'req-b', T0 + 120_000).projection.flavorDescription;
  assert.equal(s1, s2);
});
