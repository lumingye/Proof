// 审计专用夹具。不写入正式内容包。时钟与随机一律注入。

import { ProofEngine } from '../../src/engine/ProofEngine.js';
import { realPack, buildFromParts, cloneCup, menu, menuItem, potion, fourWaters, hiddenHeaven, hiddenBlack } from '../../src/content/realPack.js';
import { STATE_AXES, zeroStateAxes } from '../../src/core/constants.js';
import { T0 } from '../helpers.js';

export const AUDIT_T0 = T0;
export const EPS_EXACT = 1e-9;
export const EPS_DOSE = 1e-6;
export const EPS_STATE = 1e-6;
// 酒精公式 0.789 为 SPEC 给定密度；容差来自双精度累加，不是玩法校准。
export const EPS_SOURCE = 'IEEE-754 on SPEC constants (ethanol density 0.789, metabolism 3.0/h)';

export const TEST_ROLES = {
  dose_isolation: {
    reactionCurve: () => ({ 亲近: 0, 守门: 0, 欲望: 0 }),
    adoptionWeights: { 愉悦: 0, 唤醒: 0, 亲近: 0, 守门: 0, 欲望: 0, 精度: 0 }
  },
  belief_isolation: {
    reactionCurve: () => ({ 亲近: 0, 守门: 0, 欲望: 0 }),
    adoptionWeights: { 愉悦: 1, 唤醒: 1, 亲近: 1, 守门: 1, 欲望: 1, 精度: 0 }
  },
  open_guard: {
    reactionCurve: (chat) => ({ 亲近: 0.9 * chat, 守门: -0.7 * chat, 欲望: 1.0 * chat }),
    adoptionWeights: realPack.adoptionWeights
  },
  closed_guard: {
    reactionCurve: (chat) => ({ 亲近: 0.9 * chat, 守门: 0.7 * chat, 欲望: 1.0 * chat }),
    adoptionWeights: realPack.adoptionWeights
  }
};

export function packWithRole(roleName, extra = {}) {
  const role = TEST_ROLES[roleName];
  if (!role) throw new Error(`unknown role ${roleName}`);
  return {
    ...realPack,
    reactionCurve: role.reactionCurve,
    adoptionWeights: role.adoptionWeights,
    ...extra
  };
}

export function auditEngine(roleName = null, opts = {}) {
  const pack = roleName ? packWithRole(roleName, opts.pack || {}) : { ...realPack, ...(opts.pack || {}) };
  return new ProofEngine(null, pack, opts);
}

export function almost(a, b, eps = EPS_STATE) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= eps;
}

export function assertFiniteAxes(vec, axes = STATE_AXES) {
  for (const axis of axes) {
    const v = vec?.[axis];
    if (!Number.isFinite(v) || v === Infinity || v === -Infinity) {
      throw new Error(`non-finite ${axis}=${v}`);
    }
  }
}

export function axisRangeOk(vec) {
  const issues = [];
  for (const axis of STATE_AXES) {
    const v = vec?.[axis];
    if (v == null || !Number.isFinite(v)) issues.push(`${axis} missing/NaN`);
    else if (axis === '精度') {
      if (v < -5 || v > 0) issues.push(`精度 ${v} out of [-5,0]`);
    } else if (v < -5 || v > 5) issues.push(`${axis} ${v} out of [-5,5]`);
  }
  return issues;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function listedMenu() {
  return menu.filter((m) => m.listed !== false && m.kind !== 'unlisted');
}

export function allContentCups() {
  return [
    ...listedMenu(),
    potion,
    fourWaters,
    hiddenHeaven,
    hiddenBlack
  ];
}

export function drinkAll(engine, cup, t = AUDIT_T0) {
  const id = engine.createOffer(cloneCup(cup), 'mixer', 'mixer', 'drinker', t);
  return { id, result: engine.drinkOffer(id, 'drinker', `req-${id}`, t) };
}

export { ProofEngine, realPack, buildFromParts, cloneCup, menu, menuItem, potion, fourWaters, hiddenHeaven, hiddenBlack, STATE_AXES, zeroStateAxes };
