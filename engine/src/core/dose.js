// 剂量通道：酒精 → 生理三轴 + 反应三轴（机制约定）

import {
  STANDARD_DRINK_G,
  ETHANOL_DENSITY,
  METABOLISM_PER_HOUR,
  PERFORMANCE_CAP,
  MIN_STATE,
  MAX_STATE
} from './constants.js';

export function mlToStandardDrinks(volumeMl, abv) {
  return (volumeMl * abv * ETHANOL_DENSITY) / STANDARD_DRINK_G;
}

export function metabolize(currentC, hours) {
  return Math.max(0, currentC - METABOLISM_PER_HOUR * hours);
}

export function chatOf(c) {
  return Math.min(c, PERFORMANCE_CAP);
}

export function doseToPhysiology(c) {
  const chat = chatOf(c);
  const precision = Math.max(-5, Math.min(0, -0.5 * chat));
  let arousal;
  let pleasure;
  if (chat <= 3) {
    arousal = 1.2 * chat;
    pleasure = 1.0 * chat;
  } else {
    arousal = 3.6 - 0.9 * (chat - 3);
    pleasure = 3.0 - 0.8 * (chat - 3);
  }
  return { 精度: precision, 唤醒: arousal, 愉悦: pleasure };
}

export function doseToReaction(c, reactionCurve) {
  const chat = chatOf(c);
  return reactionCurve(chat);
}

export function applyHangoverToPhysiology(physiology, h) {
  return {
    愉悦: physiology.愉悦 - 2 * h,
    唤醒: physiology.唤醒 - 2 * h,
    精度: physiology.精度 - 1.5 * h
  };
}

export function clampState(value, axis) {
  const v = axis === '精度'
    ? Math.max(-5, Math.min(0, value))
    : Math.max(MIN_STATE, Math.min(MAX_STATE, value));
  return v === 0 ? 0 : v;
}
