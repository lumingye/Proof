import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentStateHints, buildAgentTurnContext } from '../src/index.js';
import { engine, T0 } from './helpers.js';

const AXIS_WORDS = ['愉悦', '唤醒', '精度', '亲近', '守门', '欲望'];

function noAxisLabels(text) {
  return AXIS_WORDS.every((axis) => !text.includes(axis));
}

test('AH1 六轴只翻成自然状态语义，不给轴名、符号、数值', () => {
  const hints = buildAgentStateHints({ 愉悦: 2, 唤醒: -2, 精度: -2, 亲近: 2, 守门: -2, 欲望: 2 });
  assert.ok(hints.length > 0 && hints.length <= 4);
  const text = hints.join('\n');
  assert.equal(noAxisLabels(text), true);
  assert.equal(/[+-]\d|[＋−]\d/.test(text), false);
  assert.ok(text.includes('处理细节和临场判断'), '客观精度下降不能因 top-N 被挤掉');
});

test('AH2 正负方向语义相反，不把负向也写成“更一点”', () => {
  const close = buildAgentStateHints({ 亲近: 2 }, { maxHints: 4 }).join('');
  const far = buildAgentStateHints({ 亲近: -2 }, { maxHints: 4 }).join('');
  assert.match(close, /靠近|互动继续/);
  assert.match(far, /拉开|减少互动/);

  const guarded = buildAgentStateHints({ 守门: 2 }, { maxHints: 4 }).join('');
  const open = buildAgentStateHints({ 守门: -2 }, { maxHints: 4 }).join('');
  assert.match(guarded, /边界守紧|继续保留/);
  assert.match(open, /往外放/);
});

test('AH3 状态语义只给倾向，不规定句子长短、说话次数或固定动作', () => {
  const text = buildAgentStateHints({ 愉悦: 3, 唤醒: 3, 亲近: 3, 守门: -3, 欲望: 3 }).join('\n');
  for (const forbidden of ['句子变长', '标点', '名字次数', '主动亲', '会写诗', '说话变多']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test('AH4 Agent turn context 不再注入文学效果原文或“轴方向报告”', () => {
  const eng = engine();
  eng.setStateInjection(true);
  eng.state.c = 4;
  eng.state.eventPeak = 4;
  eng.state.tonightPeak = 4;
  const ctx = buildAgentTurnContext(eng, 'test', T0);
  const text = ctx.context?.text || '';
  assert.equal(noAxisLabels(text), true);
  assert.equal(text.includes('门闩自己滑开了'), false);
  assert.equal(text.includes('那个「要」越来越沉'), false);
  assert.equal(text.includes('direction'), false);
  assert.ok(Array.isArray(ctx.stateHints));
  assert.equal('effects' in ctx, false);
});

test('AH5 断片给 Agent 的是简短客观语义，不复述人类文学 script', () => {
  const eng = engine();
  eng.setStateInjection(true);
  eng.state.c = 9;
  eng.state.eventPeak = 9;
  eng.state.tonightPeak = 9;
  eng.state.fragmentBatches = [{
    id: 'bo-test', start: T0, end: null, createdAt: T0, hiddenFrom: T0,
    restoreAt: T0 + 60 * 3600000, hiddenUntil: T0 + 60 * 3600000,
    mode: 'soft', enabled: true, readable: false
  }];
  const ctx = buildAgentTurnContext(eng, 'test', T0);
  const text = ctx.context?.text || '';
  assert.match(text, /尚未恢复的断片期/);
  assert.equal(text.includes('像被雾吞掉了'), false);
});
