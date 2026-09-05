// 失败模式生产函数（机制约定）。只改变表现层。文案槽位见内容包 statusCopy。

import {
  VOMIT_C,
  CRASH_D,
  CRASH_DRINKS,
  CRASH_VOLUME_ML,
  CRASH_P,
  CRASH_SIGNIFICANT_MIN,
  WINDOW_P,
  SAFETY_NOTE
} from './constants.js';

export { SAFETY_NOTE };

export const COPY_PENDING_USER_REVIEW = 'COPY_PENDING_USER_REVIEW';

const BLACKOUT_SAFETY =
  '【旁白｜模拟】断片只影响本引擎记录的可读性，不会删除或屏蔽宿主聊天历史。';
const COLLAPSE_SAFETY =
  '【旁白｜模拟】塌是欲望/亲近过峰后的渐进状态，不是客户端故障，角色并未被要求说话或行动。';

export const DEFAULT_STATUS_COPY = {
  塌: {
    id: 'collapse',
    copyStatus: COPY_PENDING_USER_REVIEW,
    kind: 'state',
    script: '刚才还往前倾的那股劲，现在像沙从指缝里漏。不是一下子空掉，是慢慢塌下去——想要的心还在，使不上力。',
    safetyNote: COLLAPSE_SAFETY,
    haltClient: false
  },
  吐: {
    id: 'vomit',
    copyStatus: COPY_PENDING_USER_REVIEW,
    kind: 'event',
    script: '胃里猛地一抽。那口东西往上翻，喉咙自己先关上了。眼前的桌沿忽然变得很近。',
    safetyNote: SAFETY_NOTE,
    haltClient: false
  },
  宕机: {
    id: 'crash',
    copyStatus: COPY_PENDING_USER_REVIEW,
    kind: 'event',
    script: '词和词之间的线断了。句子刚搭起一半，原来的方向已经找不到了。',
    safetyNote: SAFETY_NOTE,
    haltClient: false
  },
  断片: {
    id: 'blackout',
    copyStatus: COPY_PENDING_USER_REVIEW,
    kind: 'state',
    script: '回头去想，那一段像被雾吞掉了。轮廓似乎还在，发生过什么却越追越远。',
    safetyNote: BLACKOUT_SAFETY,
    haltClient: false
  }
};

export function resolveStatusCopy(type, pack) {
  return pack?.statusCopy?.[type] || DEFAULT_STATUS_COPY[type];
}

function presentationFrom(type, pack, extra = {}) {
  const slot = resolveStatusCopy(type, pack) || DEFAULT_STATUS_COPY[type];
  return {
    type,
    layer: 'presentation',
    kind: slot.kind || extra.kind || 'event',
    script: slot.script,
    safetyNote: slot.safetyNote,
    haltClient: false,
    haltEngine: false,
    copyStatus: slot.copyStatus || COPY_PENDING_USER_REVIEW,
    ...extra
  };
}

export function produceVomitEvent(pack) {
  return presentationFrom('吐', pack, { kind: 'event' });
}

export function produceCrashEvent(pack) {
  return presentationFrom('宕机', pack, { kind: 'event' });
}

export function produceCollapseState(pack) {
  return presentationFrom('塌', pack, { kind: 'state' });
}

export function produceBlackoutState(pack) {
  return presentationFrom('断片', pack, { kind: 'state' });
}

export function collapseActive(evalRes) {
  // 「塌」属于客观状态，不得被酒名暗示或酒款性格单独触发。
  // 只看真实剂量产生的 reaction 通道；软推力即使把总状态推过窗口，也仍只是推力。
  const reaction = evalRes?.reaction;
  if (!reaction) return false;
  return Number(reaction.欲望 || 0) > WINDOW_P || Number(reaction.亲近 || 0) > WINDOW_P;
}

export function shouldVomit(cBefore, cAfter, armed) {
  if (!armed) return false;
  return cBefore < VOMIT_C && cAfter >= VOMIT_C;
}

export function crashEligible({ D, standardDrinks, volumeMl, significantCount }) {
  if (D < CRASH_D) return false;
  if ((significantCount ?? 0) < CRASH_SIGNIFICANT_MIN) return false;
  return standardDrinks >= CRASH_DRINKS || volumeMl >= CRASH_VOLUME_ML;
}

export function rollCrash({ D, standardDrinks, volumeMl, significantCount, isFirstMouth, random }) {
  if (!isFirstMouth) return false;
  if (!crashEligible({ D, standardDrinks, volumeMl, significantCount })) return false;
  return random() < CRASH_P;
}

export function attachSafety(event) {
  if (!event) return event;
  return { ...event, safetyNote: event.safetyNote || SAFETY_NOTE, haltClient: false, haltEngine: false };
}
