// 非酒精活性成分：通用通道与生命周期（机制约定）。
//
// **本文件不认识任何具体化合物。** 曲线、半衰期、封顶、轴范围全部住在
// content/actives.js 的注册表里；这里只做通用结算。
//
// 精度与反应三轴不对非酒精成分开放——由注册表的轴白名单在加载期钉死。

import { CAFFEINE_CAP, CAFFEINE_HALF_LIFE_H, CAFFEINE_ZERO, MAX_STATE, MIN_STATE } from './constants.js';
import { ACTIVE_DEFS, ACTIVE_AXIS_WHITELIST, normalizeIngredientActives } from '../content/actives.js';

const HOUR_MS = 3600000;

function defOf(compound) {
  return ACTIVE_DEFS[compound] || null;
}

// ---------------- 状态槽 ----------------

// 空字典：键即化合物，没有写死的槽位。
// **破坏性变更**：旧版返回 { 咖啡因: {...} }，所有读取点必须走 activeAmount()/getSlot()。
export function emptyActives() {
  return {};
}

export function getSlot(actives, compound, now) {
  if (!actives) return null;
  if (!actives[compound]) actives[compound] = { amount: 0, lastSettle: now };
  return actives[compound];
}

export function activeAmount(actives, compound) {
  const slot = actives?.[compound];
  return slot ? Number(slot.amount || 0) : 0;
}

// ---------------- 摄入 ----------------

// 从配方收集各化合物的份数。
// parts 形状与既有 caffeineOfParts 一致：[{ id, volume }]。
export function collectActives(parts, ingredients) {
  const out = {};
  for (const p of parts || []) {
    const id = String(p.id ?? '').trim();
    const ing = ingredients?.[p.id] || ingredients?.[id];
    if (!ing) continue;
    for (const decl of normalizeIngredientActives(ing)) {
      const ref = decl.referenceVolumeMl;
      if (!ref) continue;
      const add = (p.volume / ref) * (decl.amount || 0);
      if (!add) continue;
      out[decl.compound] = (out[decl.compound] || 0) + add;
    }
  }
  return out;
}

// **存量不封顶，只累加。** 封顶只在求值时施加（与咖啡因现状一致）。
export function ingestActives(state, compounds, now) {
  if (!state.actives) state.actives = emptyActives();
  settleActives(state, now);
  for (const [compound, amount] of Object.entries(compounds || {})) {
    if (!defOf(compound) || !amount) continue;
    const slot = getSlot(state.actives, compound, now);
    slot.amount += amount;
    slot.lastSettle = now;
  }
  return state.actives;
}

// ---------------- 结算 ----------------

export function metabolizeCompound(compound, k, hours) {
  const def = defOf(compound);
  if (!def) return 0;
  if (k <= 0 || hours <= 0) return k < def.zero ? 0 : k;
  const next = k * 2 ** (-hours / def.halfLifeH);
  return next < def.zero ? 0 : next;
}

// 逐槽独立衰减，各存各的时间戳，互不读取对方的值。
// 归零即删键——不留 { amount: 0 } 残骸。
export function settleActives(state, now) {
  const actives = state?.actives;
  if (!actives) return {};
  for (const compound of Object.keys(actives)) {
    const slot = actives[compound];
    const def = defOf(compound);
    if (!def) { delete actives[compound]; continue; }
    const hours = (now - Number(slot.lastSettle || 0)) / HOUR_MS;
    if (hours > 0) slot.amount = metabolizeCompound(compound, Number(slot.amount || 0), hours);
    slot.lastSettle = now;
    if (!(slot.amount > 0)) delete actives[compound];
  }
  return actives;
}

export function resetActives(state) {
  state.actives = emptyActives();
  return state.actives;
}

// ---------------- 求值 ----------------

function clampState(v) {
  return Math.max(MIN_STATE, Math.min(MAX_STATE, v));
}

// 封顶在此，且仅在此。跨槽同轴累加，只输出各自白名单内的轴。
export function activesToPhysiology(actives) {
  const out = { 愉悦: 0, 唤醒: 0, 精度: 0, 亲近: 0, 守门: 0, 欲望: 0 };
  for (const [compound, slot] of Object.entries(actives || {})) {
    const def = defOf(compound);
    if (!def) continue;
    const k = Math.min(Number(slot.amount || 0), def.cap);
    if (!(k > 0)) continue;
    const contribution = def.curve(k) || {};
    for (const axis of def.axes) {
      if (!ACTIVE_AXIS_WHITELIST.includes(axis)) continue;
      out[axis] += Number(contribution[axis] || 0);
    }
  }
  for (const axis of Object.keys(out)) out[axis] = clampState(out[axis]);
  return out;
}

// ---------------- export / restore ----------------

export function exportActives(actives) {
  return JSON.parse(JSON.stringify(actives || {}));
}

// 以包内的 lastSettle 为锚点补算到 now，掉到阈值以下的槽不注入。
export function restoreActives(payload, now) {
  const out = {};
  for (const [compound, slot] of Object.entries(payload || {})) {
    const def = defOf(compound);
    if (!def || !slot) continue;
    const hours = (now - Number(slot.lastSettle || 0)) / HOUR_MS;
    const amount = hours > 0
      ? metabolizeCompound(compound, Number(slot.amount || 0), hours)
      : Number(slot.amount || 0);
    if (amount > 0) out[compound] = { amount, lastSettle: now };
  }
  return out;
}

// ---------------- 咖啡因专用入口（保留，供既有调用点与测试使用） ----------------

export function caffeineOfParts(parts, ingredients) {
  return collectActives(parts, ingredients).咖啡因 || 0;
}

export function caffeinePerMouth(total, totalMouths) {
  return total / (totalMouths || 1);
}

export function metabolizeCaffeine(k, hours) {
  if (k <= 0 || hours <= 0) return k < CAFFEINE_ZERO ? 0 : k;
  const next = k * 2 ** (-hours / CAFFEINE_HALF_LIFE_H);
  return next < CAFFEINE_ZERO ? 0 : next;
}

export function settleActive(entry, now, metabolizeFn) {
  if (!entry) return { amount: 0, lastSettle: now };
  const hours = (now - entry.lastSettle) / HOUR_MS;
  const amount = hours > 0 ? metabolizeFn(entry.amount, hours) : entry.amount;
  return { amount, lastSettle: now };
}

export function chatK(k) {
  return Math.min(k, CAFFEINE_CAP);
}

/**
 * 仅愉悦、唤醒。精度 / 亲近 / 守门 / 欲望一律为 0。
 * **数值与形状与迁移前逐字一致**，注册表里的 curveCaffeine 与本函数有测试逐点比对。
 */
export function caffeineToPhysiology(k) {
  const khat = chatK(k);
  let arousal;
  let pleasure;
  if (khat <= 2) {
    arousal = 1.2 * khat;
    pleasure = 0.5 * khat;
  } else {
    arousal = 2.4;
    pleasure = 1.0 - 0.6 * (khat - 2);
  }
  return {
    愉悦: clampState(pleasure),
    唤醒: clampState(arousal),
    精度: 0,
    亲近: 0,
    守门: 0,
    欲望: 0
  };
}

/**
 * 只把愉悦与唤醒叠加到生理三轴上。**精度不接受非酒精成分的推力。**
 */
export function addCaffeineOnly(physiology, cafe) {
  return {
    ...physiology,
    愉悦: (physiology.愉悦 || 0) + (cafe.愉悦 || 0),
    唤醒: (physiology.唤醒 || 0) + (cafe.唤醒 || 0)
  };
}
