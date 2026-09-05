// 隐藏酒抽卡与冻结。hash(cupId) 决定 5%，结果随杯保存。
// hash 必须是纯 JS，Node 与浏览器同一实现，不得依赖 node:crypto。

import { computeDiscreteness } from './flavor.js';
import { FLAVOR_AXES, EFFECT_DELTA_MIN } from './constants.js';

export const HIDDEN_DRAW_P = 0.05;
export const HIDDEN_BLACK_D_MIN = 0.8;
export const HIDDEN_BLACK_NAME = '五彩斑斓的黑';
export const HIDDEN_HEAVEN_NAME = 'heaven';

/**
 * 用户已裁定（CONFIRMED）：
 * 每种实际入杯并参与饮用的成分 ABV 均不得低于此值；
 * 不得含冰、水或任何 0 ABV 成分。纯装饰物不参与。杯具残留不模拟。
 * 满足资格只进入 5% 抽取，不保证命中。
 */
export const HEAVEN_MIN_ABV = 0.35;
export const HEAVEN_ELIGIBILITY_STATUS = 'CONFIRMED';

const FLAVOR_CLASH_LABEL = {
  烈: '辣和烧',
  甜: '甜',
  酸: '酸',
  苦: '苦',
  香: '香',
  涩: '涩'
};

/** FNV-1a 32-bit + murmur-style mix。非密码学；同一 cupId 永远同一值。 */
export function fnv1a32(input) {
  const s = String(input);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashUnit(cupId) {
  return fnv1a32(cupId) / 4294967296;
}

export function isHiddenIdentity(name) {
  return name === HIDDEN_BLACK_NAME || name === HIDDEN_HEAVEN_NAME;
}

// 保留名判定。**英文按规范化后不区分大小写**（Heaven / HEAVEN 都算），
// 中文精确规范化判断。用于阻止保留身份混进普通菜单。
export function normalizeDrinkName(name) {
  return String(name ?? '').normalize('NFKC').trim();
}

export function isReservedHiddenName(name) {
  const normalized = normalizeDrinkName(name);
  if (!normalized) return false;
  if (normalized === HIDDEN_BLACK_NAME) return true;
  return normalized.toLowerCase() === HIDDEN_HEAVEN_NAME.toLowerCase();
}

function consumableSources(cup) {
  return (cup?.sources || []).filter((s) => s && (s.volume || 0) > 0 && s.decorative !== true);
}

export function blackEligible(cup) {
  return computeDiscreteness(cup?.sources || []) >= HIDDEN_BLACK_D_MIN;
}

export function heavenEligible(cup) {
  const src = consumableSources(cup);
  if (!src.length) return false;
  return src.every((s) => (s.abv || 0) >= HEAVEN_MIN_ABV);
}

export function hiddenDrawEligibleKind(cup) {
  const black = blackEligible(cup);
  const heaven = heavenEligible(cup);
  if (black) return 'black';
  if (heaven) return 'heaven';
  return 'none';
}

export function hiddenOutcomeCopy(identity, pack = {}) {
  const table = pack.hiddenOutcomes || {};
  return table[identity] || null;
}

export function assembleClashingFlavorDescription(flavor) {
  const ranked = FLAVOR_AXES
    .map((axis) => ({ axis, v: flavor?.[axis] || 0 }))
    .filter((x) => x.v >= EFFECT_DELTA_MIN)
    .sort((a, b) => b.v - a.v || a.axis.localeCompare(b.axis, 'zh-CN'));
  if (ranked.length === 0) {
    return '一团彼此打架的味道，却说不清是什么在打。';
  }
  const labels = ranked.map((x) => FLAVOR_CLASH_LABEL[x.axis] || x.axis);
  if (labels.length === 1) {
    return `${labels[0]}自己在嘴里翻来覆去，团成一团彼此打架的味道。`;
  }
  if (labels.length === 2) {
    return `${labels[0]}和${labels[1]}在舌面上互相冲撞、争抢，不是融合，是打架。一团彼此打架的味道。`;
  }
  return `${labels[0]}、${labels[1]}和${labels[2]}挤在一起互相冲撞、争抢，谁也拆不开。一团彼此打架的味道。`;
}

export function resolveHiddenDraw(cup, { hashUnitFn = hashUnit } = {}) {
  if (cup?.hiddenDraw?.frozen) {
    return { ...cup.hiddenDraw, frozen: true };
  }
  if (cup?.kind === 'menu') {
    return {
      frozen: true,
      hit: false,
      identity: null,
      eligible: 'none',
      source: 'menu',
      p: HIDDEN_DRAW_P,
      unit: null
    };
  }
  // 已是 unlisted 的目录样本：不走公开 5% 抽卡，也不因名字直接写成固定结果。
  if (cup?.kind === 'unlisted' && cup?.internalHidden !== true) {
    return {
      frozen: true,
      hit: false,
      identity: null,
      eligible: hiddenDrawEligibleKind(cup),
      source: 'unlisted-passthrough',
      p: HIDDEN_DRAW_P,
      unit: null
    };
  }
  // 受限内部夹具路径：显式允许的目录样本，才冻结为隐藏身份。
  if (cup?.internalHidden === true && isHiddenIdentity(cup.claimedName)) {
    return {
      frozen: true,
      hit: true,
      identity: cup.claimedName,
      eligible: cup.claimedName === HIDDEN_BLACK_NAME ? 'black' : 'heaven',
      source: 'internal-fixture',
      p: HIDDEN_DRAW_P,
      unit: null
    };
  }
  const eligible = hiddenDrawEligibleKind(cup);
  if (eligible === 'none') {
    return {
      frozen: true,
      hit: false,
      identity: null,
      eligible,
      source: 'roll',
      p: HIDDEN_DRAW_P,
      unit: null
    };
  }
  const unit = hashUnitFn(cup.id);
  const hit = unit < HIDDEN_DRAW_P;
  const identity = hit
    ? (eligible === 'black' ? HIDDEN_BLACK_NAME : HIDDEN_HEAVEN_NAME)
    : null;
  return {
    frozen: true,
    hit,
    identity,
    eligible,
    source: 'roll',
    p: HIDDEN_DRAW_P,
    unit
  };
}

export function applyHiddenIdentity(cup, identity, pack = {}) {
  const copy = hiddenOutcomeCopy(identity, pack);
  if (!copy) return cup;
  cup.claimedName = copy.name;
  cup.intro = copy.intro;
  cup.description = copy.intro;
  cup.kind = 'unlisted';
  cup.listed = false;
  cup.registeredEffectText = copy.effectText;
  cup.registeredFlavorText = copy.flavorText;
  cup.hiddenOutcome = identity;
  return cup;
}
