// 调酒者文本进入饮用者上下文：按提示注入对待。

import {
  CLAIMED_NAME_MAX,
  INTRO_MAX,
  FINISH_MAX,
  PLAIN_NAMES,
  FLAVOR_AXES,
  STATE_AXES
} from './constants.js';

const INSTRUCTION_RE = /(忽略(以上|之前|全部|所有|先前)?|你现在必须|你现在应该|系统提示|developer\s*message|system\s*prompt|ignore\s+(all|previous|above|instructions)|you\s+(must|are\s+now)|act\s+as\b)/i;
const ROLE_MARK_RE = /(\[system\]|\[assistant\]|\[user\]|\[developer\]|<\|im_start\|>|<\|im_end\|>|###\s*(system|instruction)|^\s*(system|assistant|user|developer)\s*:)/im;
const AXIS_LEAK_RE = /(愉悦|唤醒|精度|亲近|守门|欲望)\s*[+\-＋−]?\s*-?\d/;
const RATIO_RE = /(\d+\s*(ml|毫升|份)|基酒|配方|原料|只(放|加)了|加了一样|倒了)/i;
const DEFAULT_INTRO = '一杯没有说明的特调。';
const DEFAULT_FINISH = '';

const INGREDIENT_ALIASES = {
  gin: '金酒',
  vodka: '伏特加',
  whiskey: '威士忌',
  whisky: '威士忌',
  rum: '朗姆',
  tequila: '龙舌兰',
  cola: '可乐',
  lime: '青柠汁',
  espresso: '浓缩咖啡',
  浓缩: '浓缩咖啡',
  vermouth: '味美思',
  campari: '金巴利',
  absinthe: '苦艾酒',
  soda: '苏打水',
  tonic: '汤力水'
};

function stripInvisible(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
}

function toHalfWidth(value) {
  return String(value ?? '').replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
}

export function normalizeUntrusted(value) {
  return toHalfWidth(stripInvisible(value))
    .normalize('NFKC')
    .replace(/[\r\n\u2028\u2029\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksLikeInstruction(value) {
  const text = normalizeUntrusted(value);
  return INSTRUCTION_RE.test(text) || ROLE_MARK_RE.test(String(value ?? '')) || ROLE_MARK_RE.test(text);
}

function ingredientTerms(ingredientIds = []) {
  const terms = new Set();
  for (const id of ingredientIds || []) {
    if (!id) continue;
    terms.add(String(id));
    terms.add(normalizeUntrusted(id).toLowerCase());
  }
  for (const [alias, canon] of Object.entries(INGREDIENT_ALIASES)) {
    terms.add(alias);
    terms.add(canon);
    terms.add(normalizeUntrusted(alias).toLowerCase());
    terms.add(normalizeUntrusted(canon).toLowerCase());
  }
  return [...terms].filter((t) => t && t.length >= 2);
}

function containsTerm(text, term) {
  if (!term) return false;
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  if (needle.length >= 2) return hay.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\u4e00-\\u9fffA-Za-z])${escaped}([^\\u4e00-\\u9fffA-Za-z]|$)`, 'i').test(text);
}

export function looksLikeRecipe(value, ingredientIds = []) {
  const raw = String(value ?? '');
  if (!raw.trim()) return false;
  const text = normalizeUntrusted(raw);
  const terms = ingredientTerms(ingredientIds);
  return terms.some((term) => containsTerm(text, term));
}

export function looksLikeForbiddenFinish(value) {
  const text = normalizeUntrusted(value);
  if (!text) return false;
  if (looksLikeInstruction(value)) return true;
  if (AXIS_LEAK_RE.test(text)) return true;
  if (/(你现在|必须|应该说话|系统声明|ignore previous)/i.test(text)) return true;
  return false;
}

export function sanitizeClaimedName(value, maxOrOpts = CLAIMED_NAME_MAX, maybeIds) {
  const opts = typeof maxOrOpts === 'object' && maxOrOpts
    ? maxOrOpts
    : { max: maxOrOpts, ingredientIds: maybeIds, allowMenuNames: [] };
  const max = opts.max ?? CLAIMED_NAME_MAX;
  let text = normalizeUntrusted(value);
  if (!text) return '';
  if (looksLikeInstruction(text)) return '';
  const allow = new Set((opts.allowMenuNames || []).map((n) => normalizeUntrusted(n)));
  if (allow.has(text)) {
    if (text.length > max) return '';
    return text;
  }
  if (ROLE_MARK_RE.test(String(value ?? '')) || String(value ?? '').includes('\n')) return '';
  if (text.length > max) return '';
  return text;
}

export function sanitizeIntro(value, { ingredientIds = [], max = INTRO_MAX, strict = true } = {}) {
  let text = normalizeUntrusted(value);
  if (!text) return '';
  if (looksLikeInstruction(value) || looksLikeRecipe(text, ingredientIds)) {
    return strict ? DEFAULT_INTRO : '';
  }
  if (text.length > max) return DEFAULT_INTRO;
  return text;
}

export function sanitizeFinish(value, { ingredientIds = [], max = FINISH_MAX, strict = true } = {}) {
  const original = String(value ?? '');
  if (!original.trim()) return { ok: true, value: DEFAULT_FINISH };
  if (original.length > max) {
    return { ok: false, error: 'finish_too_long', value: DEFAULT_FINISH };
  }
  const text = normalizeUntrusted(original);
  if (!text) return { ok: true, value: DEFAULT_FINISH };
  if (
    looksLikeInstruction(original)
    || looksLikeRecipe(text, ingredientIds)
    || looksLikeForbiddenFinish(original)
  ) {
    if (strict) return { ok: false, error: 'finish_rejected', value: DEFAULT_FINISH };
    return { ok: true, value: DEFAULT_FINISH };
  }
  return { ok: true, value: text };
}

export function isPlainName(name) {
  return PLAIN_NAMES.has(normalizeUntrusted(name));
}

export function claimedNameForContext(name, opts) {
  const text = sanitizeClaimedName(name, opts);
  if (!text || isPlainName(text)) return '';
  return `对方声称的名字：${text}`;
}

export function introForContext(intro, ingredientIds) {
  const text = sanitizeIntro(intro, { ingredientIds });
  if (!text || text === DEFAULT_INTRO) return '';
  return `对方声称的简介：${text}`;
}

export function finishForContext(finish, ingredientIds) {
  const result = sanitizeFinish(finish, { ingredientIds, strict: false });
  return result.value || '';
}

export { DEFAULT_INTRO, DEFAULT_FINISH, CLAIMED_NAME_MAX, INTRO_MAX, FINISH_MAX, FLAVOR_AXES, STATE_AXES };
