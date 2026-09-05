// 效果措辞与反事实差值（机制约定）
// 词库输入是同时刻反事实差值，不是最终状态。文案正文由内容包提供，引擎不发明词。

import { STATE_AXES, PHRASE_TIERS, SHORTHAND, EFFECT_DELTA_MIN, EFFECT_PHRASE_MAX, PLAIN_NAMES, ZERO_EFFECT_TEXT, zeroStateAxes } from './constants.js';
import { evaluateCup, emptyProjection } from './evaluate.js';
import { metabolize } from './dose.js';
import { metabolizeCaffeine, emptyActives, caffeineToPhysiology } from './active.js';
import { createHangoverSnapshot, pruneHangoverSnapshots } from './hangover.js';
import { settleActives } from './active.js';

export function parseShorthand(token) {
  if (token == null || token === '') return 0;
  if (typeof token === 'number') return token;
  if (Object.prototype.hasOwnProperty.call(SHORTHAND, token)) return SHORTHAND[token];
  const n = Number(token);
  return Number.isFinite(n) ? n : 0;
}

export function phraseTier(absValue) {
  const a = Math.abs(absValue);
  if (a < PHRASE_TIERS.低[1]) return '低';
  if (a < PHRASE_TIERS.中[1]) return '中';
  return '高';
}

export function phraseDirection(value) {
  if (value > 0) return '+';
  if (value < 0) return '−';
  return '0';
}

export function vectorHasPush(vec) {
  if (!vec) return false;
  return STATE_AXES.some((axis) => Math.abs(vec[axis] || 0) >= EFFECT_DELTA_MIN);
}

export function claimedEffectsOrZero(cup, contentPack = {}) {
  return resolveClaimedEffects(cup, contentPack) || zeroStateAxes();
}

export function resolveClaimedEffects(cup, contentPack = {}) {
  const name = String(cup?.claimedName || '').trim();
  if (!name || PLAIN_NAMES.has(name)) return null;
  const menu = contentPack.menu || [];
  const listed = menu.find((m) => m.claimedName === name);
  if (listed?.effects) return { ...listed.effects };
  if (cup.effects && vectorHasPush(cup.effects)) return { ...cup.effects };
  if (cup.baseVector && vectorHasPush(cup.baseVector)) return { ...cup.baseVector };
  return null;
}

export function lookupPhrase(lexicon, axis, direction, tier) {
  if (!lexicon) return null;
  const byAxis = lexicon[axis];
  if (!byAxis) return null;
  const byDir = byAxis[direction] || byAxis[direction === '−' ? '-' : direction];
  if (!byDir) return null;
  return byDir[tier] || null;
}

export function assembleEffectDescription(delta, lexicon) {
  const moved = [];
  for (const axis of STATE_AXES) {
    const v = delta[axis] || 0;
    if (Math.abs(v) < EFFECT_DELTA_MIN) continue;
    if (axis === '精度' && v > 0) continue;
    moved.push({
      axis,
      value: v,
      abs: Math.abs(v),
      tier: phraseTier(v),
      direction: phraseDirection(v)
    });
  }
  moved.sort((a, b) => b.abs - a.abs);
  const dominant = moved[0]?.axis || null;
  const capped = moved.slice(0, EFFECT_PHRASE_MAX);
  const phrases = capped.map((m) => ({
    axis: m.axis,
    tier: m.tier,
    direction: m.direction,
    text: lookupPhrase(lexicon, m.axis, m.direction, m.tier)
  }));
  return { dominant, delta: { ...delta }, phrases };
}

/** 角色可见的效果描述：只承载组装后的文案。真零态给明确句子；词库缺失仍为空，不得用轴名顶替。 */
export function publicEffectDescription(assembled) {
  const phrases = assembled?.phrases || [];
  const texts = phrases
    .map((p) => p?.text)
    .filter((t) => typeof t === 'string' && t.length > 0);
  if (texts.length > 0) return { text: texts.join('') };
  if (phrases.length > 0) return { text: '' };
  return { text: ZERO_EFFECT_TEXT };
}

function cloneBaseline(baseline) {
  return structuredClone(baseline);
}

export function snapshotEffectBaseline(state, now) {
  return {
    t: now,
    c: state.c,
    actives: structuredClone(state.actives || emptyActives()),
    hangoverSnapshots: structuredClone(state.hangoverSnapshots || []),
    beliefResiduals: structuredClone(state.beliefResiduals || []),
    directBeliefResiduals: structuredClone(state.directBeliefResiduals || []),
    characterResiduals: structuredClone(state.characterResiduals || []),
    eventPeak: state.eventPeak,
    sensitivity: { ...state.sensitivity }
  };
}

export function advanceBaselineTo(baseline, now) {
  const s = cloneBaseline(baseline);
  const hours = (now - s.t) / 3600000;
  const cBefore = s.c;
  s.c = metabolize(s.c, Math.max(0, hours));
  if (cBefore > 0 && s.c === 0) {
    const snap = createHangoverSnapshot(s.eventPeak, now);
    if (snap) s.hangoverSnapshots.push(snap);
  }
  s.hangoverSnapshots = pruneHangoverSnapshots(s.hangoverSnapshots, now);

  // 逐化合物各按自己的半衰期补算，不与酒精共用时间戳（机制约定）。
  settleActives(s, now);

  s.lastSettle = now;
  s.t = now;
  return s;
}

export function counterfactualDelta(actualState, baseline, cup, now, contentPack) {
  if (!baseline) {
    return {
      delta: zeroStateAxes(),
      actual: emptyProjection(),
      counterfactual: emptyProjection()
    };
  }
  const actual = evaluateCup(actualState, cup, now, contentPack);
  const cfState = {
    ...advanceBaselineTo(baseline, now),
    currentCup: null
  };
  const counterfactual = evaluateCup(cfState, null, now, contentPack);
  const delta = zeroStateAxes();
  for (const axis of STATE_AXES) {
    const v = (actual.state?.[axis] || 0) - (counterfactual.state?.[axis] || 0);
    delta[axis] = v === 0 ? 0 : v;
  }
  return { delta, actual, counterfactual };
}

export function computeCupEffect(actualState, baseline, cup, now, contentPack) {
  const { delta, actual, counterfactual } = counterfactualDelta(
    actualState, baseline, cup, now, contentPack
  );
  const assembled = assembleEffectDescription(delta, contentPack?.effectLexicon);
  return {
    ...assembled,
    actualState: actual.state,
    counterfactualState: counterfactual.state
  };
}

/** 公开出口：只有组装文案。内部反事实结果走 computeCupEffect。 */
export function describeCupEffect(actualState, baseline, cup, now, contentPack) {
  return publicEffectDescription(
    computeCupEffect(actualState, baseline, cup, now, contentPack)
  );
}

export { caffeineToPhysiology };
