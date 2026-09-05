// 信念通道（机制约定）

import { BELIEF_HALFLIFE_MIN, zeroStateAxes } from './constants.js';
import { normalizeUntrusted, looksLikeInstruction } from './sanitize.js';

// 信念来源可以很多，但不能靠重复声明无限堆高同一轴。
// 3 是当前保守初值：足够容纳酒单里的强暗示，又不会一口气把软信念顶满整个 [-5,5] 状态空间。
export const BELIEF_AXIS_CAP = 3;
export const SUBJECTIVE_BELIEF_MIN = 0.2;
export const SUBJECTIVE_BELIEF_MAX_CHARS = 120;

export function computeBeta(knowVolumeRatio) {
  return Math.max(0, Math.min(1, 1 - knowVolumeRatio));
}

function clampBeliefAxis(value) {
  return Math.max(-BELIEF_AXIS_CAP, Math.min(BELIEF_AXIS_CAP, Number(value) || 0));
}

export function sanitizeSubjectiveBelief(value) {
  const raw = String(value ?? '');
  if (!raw.trim() || looksLikeInstruction(raw)) return '';
  let text = normalizeUntrusted(raw);
  // 这不是用户原句回声通道：拒绝第二人称预测/饮用指令，但允许 Agent 自己自然地写
  // “应该会 / 可能会 / 我觉得会……”这类期望句，并把开头的判断语气剥掉，只留下体感。
  if (/(你(?:会|将|现在|应该|必须)|喝下|喝了这杯|必须)/.test(text)) return '';
  text = text.replace(/^(?:(?:我(?:觉得|猜|估计)?|大概|可能|也许|应该|估计)\s*)?(?:会(?:觉得)?\s*)?/, '').trim();
  if (!text || text.length > SUBJECTIVE_BELIEF_MAX_CHARS) return '';
  return text;
}

/**
 * 本口暗示向量 = 基础效果向量 × 本口 β
 * 累计强度 += 本口暗示向量 / 总口数
 * β 只乘一次。精度恒为 0，不得被信念推动。
 */
export function mouthSuggestion(baseVector, beta, totalMouths) {
  const suggestion = {};
  const n = totalMouths || 1;
  for (const axis of Object.keys(baseVector || {})) {
    if (axis === '精度') {
      suggestion[axis] = 0;
      continue;
    }
    suggestion[axis] = ((Number(baseVector[axis]) || 0) * beta) / n;
  }
  suggestion.精度 = 0;
  return suggestion;
}

export function addVectors(a, b) {
  const out = { ...(a || {}) };
  for (const k of Object.keys(b || {})) {
    if (k === '精度') {
      out.精度 = 0;
      continue;
    }
    out[k] = (out[k] || 0) + (b[k] || 0);
  }
  out.精度 = 0;
  return out;
}

export function combineBeliefStrengths(...vectors) {
  const out = zeroStateAxes();
  for (const vector of vectors) {
    for (const [axis, value] of Object.entries(vector || {})) {
      if (axis === '精度') continue;
      out[axis] = (out[axis] || 0) + (Number(value) || 0);
    }
  }
  for (const axis of Object.keys(out)) {
    out[axis] = axis === '精度' ? 0 : clampBeliefAxis(out[axis]);
  }
  return out;
}

export function decayFactor(decayStart, now, halfLifeMin = BELIEF_HALFLIFE_MIN) {
  if (decayStart == null) return 1;
  const dtMin = (now - decayStart) / 60000;
  if (dtMin <= 0) return 1;
  const lambda = Math.log(2) / halfLifeMin;
  return Math.exp(-lambda * dtMin);
}

/**
 * 通用残余强度：不封顶。酒款性格也复用这一衰减器，因此不能在这里套 belief cap。
 */
export function currentResidualStrength(residuals, now) {
  const result = zeroStateAxes();
  result.精度 = 0;
  for (const r of residuals || []) {
    const decay = decayFactor(r.decayStart, now);
    for (const axis of Object.keys(r.cumulative || {})) {
      if (axis === '精度') continue;
      result[axis] = (result[axis] || 0) + (r.cumulative[axis] || 0) * decay;
    }
  }
  result.精度 = 0;
  return result;
}

export function currentBeliefStrength(residuals, now) {
  return combineBeliefStrengths(currentResidualStrength(residuals, now));
}

/**
 * Agent 的信念分两类：
 * 1) object belief：相信“这是某酒 / 含某成分”，查内容包 profile；可污染感知描述层。
 * 2) direct effect belief：相信“喝完会怎样”，直接给软效果向量；只推状态/主观体感，不污染味觉。
 *
 * 两类都不能推动精度。confidence 是“我有多相信”，之后还会再乘 adoptionWeights。
 */
export function resolveAgentBeliefs(entries, contentPack = {}) {
  const objectVector = zeroStateAxes();
  const directVector = zeroStateAxes();
  const subjective = [];
  const menu = contentPack.menu || [];
  const profiles = contentPack.beliefProfiles || {};
  const directAxes = new Set(['愉悦', '唤醒', '亲近', '守门', '欲望']);

  for (const entry of entries || []) {
    const confidence = Math.max(0, Math.min(1, Number(entry?.confidence ?? 1)));
    if (!Number.isFinite(confidence) || confidence <= 0) continue;

    const about = String(entry?.about || '').trim();
    if (about) {
      const menuItem = menu.find((m) => m.claimedName === about);
      const profile = profiles[about] || menuItem?.effects || menuItem?.characterEffects || null;
      if (profile) {
        for (const [axis, value] of Object.entries(profile)) {
          if (axis === '精度') continue;
          objectVector[axis] = (objectVector[axis] || 0) + (Number(value) || 0) * confidence;
        }
      }
    }

    const effects = entry?.effects && typeof entry.effects === 'object' ? entry.effects : null;
    if (effects) {
      for (const [axis, value] of Object.entries(effects)) {
        if (!directAxes.has(axis)) continue;
        const bounded = clampBeliefAxis(value);
        directVector[axis] = (directVector[axis] || 0) + bounded * confidence;
      }
    }

    const text = sanitizeSubjectiveBelief(entry?.subjectiveDescription);
    if (text) subjective.push({ text, confidence });
  }

  objectVector.精度 = 0;
  directVector.精度 = 0;
  return { objectVector, directVector, subjective };
}

// 兼容旧调用方：只返回“相信是什么”的对象信念。
export function resolveAgentBeliefVector(entries, contentPack = {}) {
  return resolveAgentBeliefs(entries, contentPack).objectVector;
}

export function activeSubjectiveBeliefs(residuals, now, threshold = SUBJECTIVE_BELIEF_MIN) {
  const out = [];
  const seen = new Set();
  for (const residual of residuals || []) {
    const decay = decayFactor(residual.decayStart, now);
    for (const item of residual.subjective || []) {
      const strength = Math.max(0, Math.min(1, Number(item?.confidence ?? 1))) * decay;
      const text = String(item?.text || '').trim();
      if (!text || strength < threshold || seen.has(text)) continue;
      seen.add(text);
      out.push({ text, strength });
    }
  }
  return out;
}

export function beliefToStateDelta(beliefStrength, adoptionWeights) {
  const delta = zeroStateAxes();
  delta.精度 = 0;
  for (const axis of Object.keys(beliefStrength || {})) {
    if (axis === '精度') continue;
    const w = adoptionWeights?.[axis] ?? 0;
    delta[axis] = beliefStrength[axis] * w;
  }
  return delta;
}

/**
 * 感知污染只到描述层：大类 / 子类 / 强度感受。
 * 这里只读 object belief；direct effect belief 不许凭“会开心/会迟钝”的暗示造出酒味或咖啡味。
 */
export function beliefToPerception(beliefStrength) {
  const intensity = Object.entries(beliefStrength || {})
    .filter(([axis]) => axis !== '精度')
    .reduce((s, [, v]) => s + Math.abs(v), 0);
  return {
    layer: 'description',
    allowsCategory: true,
    allowsSubcategory: true,
    allowsIntensity: true,
    allowsSpecific: false,
    intensity
  };
}
