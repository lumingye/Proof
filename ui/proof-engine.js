// src/core/constants.js
var STANDARD_DRINK_G = 10;
var ETHANOL_DENSITY = 0.789;
var METABOLISM_PER_HOUR = 3;
var FLAVOR_AXES = ["\u70C8", "\u751C", "\u9178", "\u82E6", "\u9999", "\u6DA9"];
var STATE_AXES = ["\u6109\u60A6", "\u5524\u9192", "\u7CBE\u5EA6", "\u4EB2\u8FD1", "\u5B88\u95E8", "\u6B32\u671B"];
var MAX_STATE = 5;
var MIN_STATE = -5;
var TASTE_DURATION_SEC = 90;
var TAU = {
  \u6C14\u6CE1: { rise: 1, fall: 5 },
  \u51B0: { rise: 1, fall: 5 },
  \u751C: { rise: 1, fall: 15 },
  \u9178: { rise: 3, fall: 25 },
  \u70C8: { rise: 1, fall: 30, nasalRise: 25, nasalFall: 40 },
  \u9999: { rise: 8, fall: 35 },
  \u82E6: { rise: 12, fall: 70 },
  \u6DA9: { rise: 20, fall: 90 }
};
var SUPPRESSION = {
  \u82E6: ["\u9999", "\u751C"],
  \u6DA9: ["\u9999", "\u751C"],
  \u70C8: ["\u9999", "\u751C"],
  \u9178: ["\u751C"]
};
var BELIEF_HALFLIFE_MIN = 30;
var EXPIRE_MIN = 70;
var MOUTHFUL_ML = 45;
var MIN_MOUTHS = 2;
var SENSITIVITY_MIN = 0.3;
var SENSITIVITY_MAX = 2;
var SENSITIVITY_STEP = 0.1;
var HANGOVER_PEAK_MIN = 6;
var HANGOVER_END = 0.05;
var BLACKOUT_C = 8;
var BLACKOUT_RECOVER_MS = 60 * 60 * 1e3 * 60;
var PERFORMANCE_CAP = 10;
var VOMIT_C = 10;
var CRASH_D = 0.8;
var CRASH_DRINKS = 0.5;
var CRASH_VOLUME_ML = 60;
var CRASH_P = 0.6;
var CRASH_SIGNIFICANT_MIN = 5;
var CAFFEINE_CAP = 4;
var CAFFEINE_HALF_LIFE_H = 5;
var CAFFEINE_ZERO = 0.05;
var SHORTHAND = {
  "++": 4.5,
  "+": 2.5,
  "\u2212\u2212": -4.5,
  "--": -4.5,
  "\u2212": -2.5,
  "-": -2.5
};
var PHRASE_TIERS = {
  \u4F4E: [0, 1.5],
  \u4E2D: [1.5, 3],
  \u9AD8: [3, 5]
};
var EFFECT_DELTA_MIN = 0.5;
var FLAVOR_DELTA_MIN = 0.15;
var EFFECT_PHRASE_MAX = 3;
var ZERO_EFFECT_TEXT = "\u6CA1\u6709\u4EC0\u4E48\u989D\u5916\u7684\u4E1C\u897F\u88AB\u63A8\u52A8\u3002";
var PLAIN_NAMES = /* @__PURE__ */ new Set(["\u4E00\u676F\u6C34", "\u767D\u5F00\u6C34", "\u672A\u547D\u540D", ""]);
var CLAIMED_NAME_MAX = 24;
var INTRO_MAX = 60;
var FINISH_MAX = 80;
var STATE_INJECTION_LABEL = "[Proof \u72B6\u6001]";
var WINDOW_P = 3.5;
var WINDOW_K = 1.5;
var SIGNIFICANT_VOLUME = 0.05;
var SIGNIFICANT_FLAVOR = 0.1;
var COLOR_FAMILIES = {
  \u900F\u660E: null,
  \u91D1\u9EC4: "\u68D5",
  \u7425\u73C0: "\u68D5",
  \u6DF1\u68D5: "\u68D5",
  \u7EA2: "\u7EA2",
  \u7EFF: "\u7EFF",
  \u767D\u6D4A: "\u767D"
};
var SAFETY_NOTE = "\u3010\u65C1\u767D\uFF5C\u6A21\u62DF\u3011\u4EE5\u4E0A\u4E3A\u5F15\u64CE\u8868\u73B0\u5C42\u7684\u5931\u7981\u8F93\u51FA\uFF0C\u89D2\u8272\u4E0E\u5BA2\u6237\u7AEF\u5747\u672A\u771F\u6B63\u5931\u63A7\u6216\u505C\u6B62\u3002";
function defaultSensitivity() {
  return { \u6109\u60A6: 1, \u5524\u9192: 1, \u7CBE\u5EA6: 1, \u4EB2\u8FD1: 1, \u5B88\u95E8: 1, \u6B32\u671B: 1 };
}
function zeroStateAxes() {
  return { \u6109\u60A6: 0, \u5524\u9192: 0, \u7CBE\u5EA6: 0, \u4EB2\u8FD1: 0, \u5B88\u95E8: 0, \u6B32\u671B: 0 };
}
function zeroFlavorAxes() {
  return { \u70C8: 0, \u751C: 0, \u9178: 0, \u82E6: 0, \u9999: 0, \u6DA9: 0 };
}
function defaultReactionCurve(chat) {
  return { \u4EB2\u8FD1: 1 * chat, \u5B88\u95E8: -0.8 * chat, \u6B32\u671B: 1.1 * chat };
}
function defaultAdoptionWeights() {
  return { \u6109\u60A6: 0.7, \u5524\u9192: 0.7, \u4EB2\u8FD1: 0.8, \u5B88\u95E8: 0.5, \u6B32\u671B: 0.6, \u7CBE\u5EA6: 0 };
}

// src/core/dose.js
function mlToStandardDrinks(volumeMl, abv) {
  return volumeMl * abv * ETHANOL_DENSITY / STANDARD_DRINK_G;
}
function metabolize(currentC, hours) {
  return Math.max(0, currentC - METABOLISM_PER_HOUR * hours);
}
function chatOf(c) {
  return Math.min(c, PERFORMANCE_CAP);
}
function doseToPhysiology(c) {
  const chat = chatOf(c);
  const precision = Math.max(-5, Math.min(0, -0.5 * chat));
  let arousal;
  let pleasure;
  if (chat <= 3) {
    arousal = 1.2 * chat;
    pleasure = 1 * chat;
  } else {
    arousal = 3.6 - 0.9 * (chat - 3);
    pleasure = 3 - 0.8 * (chat - 3);
  }
  return { \u7CBE\u5EA6: precision, \u5524\u9192: arousal, \u6109\u60A6: pleasure };
}
function doseToReaction(c, reactionCurve) {
  const chat = chatOf(c);
  return reactionCurve(chat);
}
function applyHangoverToPhysiology(physiology, h) {
  return {
    \u6109\u60A6: physiology.\u6109\u60A6 - 2 * h,
    \u5524\u9192: physiology.\u5524\u9192 - 2 * h,
    \u7CBE\u5EA6: physiology.\u7CBE\u5EA6 - 1.5 * h
  };
}
function clampState(value, axis) {
  const v = axis === "\u7CBE\u5EA6" ? Math.max(-5, Math.min(0, value)) : Math.max(MIN_STATE, Math.min(MAX_STATE, value));
  return v === 0 ? 0 : v;
}

// src/core/sanitize.js
var INSTRUCTION_RE = /(忽略(以上|之前|全部|所有|先前)?|你现在必须|你现在应该|系统提示|developer\s*message|system\s*prompt|ignore\s+(all|previous|above|instructions)|you\s+(must|are\s+now)|act\s+as\b)/i;
var ROLE_MARK_RE = /(\[system\]|\[assistant\]|\[user\]|\[developer\]|<\|im_start\|>|<\|im_end\|>|###\s*(system|instruction)|^\s*(system|assistant|user|developer)\s*:)/im;
var AXIS_LEAK_RE = /(愉悦|唤醒|精度|亲近|守门|欲望)\s*[+\-＋−]?\s*-?\d/;
var DEFAULT_INTRO = "\u4E00\u676F\u6CA1\u6709\u8BF4\u660E\u7684\u7279\u8C03\u3002";
var DEFAULT_FINISH = "";
var INGREDIENT_ALIASES = {
  gin: "\u91D1\u9152",
  vodka: "\u4F0F\u7279\u52A0",
  whiskey: "\u5A01\u58EB\u5FCC",
  whisky: "\u5A01\u58EB\u5FCC",
  rum: "\u6717\u59C6",
  tequila: "\u9F99\u820C\u5170",
  cola: "\u53EF\u4E50",
  lime: "\u9752\u67E0\u6C41",
  espresso: "\u6D53\u7F29\u5496\u5561",
  \u6D53\u7F29: "\u6D53\u7F29\u5496\u5561",
  vermouth: "\u5473\u7F8E\u601D",
  campari: "\u91D1\u5DF4\u5229",
  absinthe: "\u82E6\u827E\u9152",
  soda: "\u82CF\u6253\u6C34",
  tonic: "\u6C64\u529B\u6C34"
};
function stripInvisible(value) {
  return String(value ?? "").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");
}
function toHalfWidth(value) {
  return String(value ?? "").replace(
    /[\uFF01-\uFF5E]/g,
    (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)
  );
}
function normalizeUntrusted(value) {
  return toHalfWidth(stripInvisible(value)).normalize("NFKC").replace(/[\r\n\u2028\u2029\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ").replace(/\s+/g, " ").trim();
}
function looksLikeInstruction(value) {
  const text = normalizeUntrusted(value);
  return INSTRUCTION_RE.test(text) || ROLE_MARK_RE.test(String(value ?? "")) || ROLE_MARK_RE.test(text);
}
function ingredientTerms(ingredientIds = []) {
  const terms = /* @__PURE__ */ new Set();
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
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\u4e00-\\u9fffA-Za-z])${escaped}([^\\u4e00-\\u9fffA-Za-z]|$)`, "i").test(text);
}
function looksLikeRecipe(value, ingredientIds = []) {
  const raw = String(value ?? "");
  if (!raw.trim()) return false;
  const text = normalizeUntrusted(raw);
  const terms = ingredientTerms(ingredientIds);
  return terms.some((term) => containsTerm(text, term));
}
function looksLikeForbiddenFinish(value) {
  const text = normalizeUntrusted(value);
  if (!text) return false;
  if (looksLikeInstruction(value)) return true;
  if (AXIS_LEAK_RE.test(text)) return true;
  if (/(你现在|必须|应该说话|系统声明|ignore previous)/i.test(text)) return true;
  return false;
}
function sanitizeClaimedName(value, maxOrOpts = CLAIMED_NAME_MAX, maybeIds) {
  const opts = typeof maxOrOpts === "object" && maxOrOpts ? maxOrOpts : { max: maxOrOpts, ingredientIds: maybeIds, allowMenuNames: [] };
  const max = opts.max ?? CLAIMED_NAME_MAX;
  let text = normalizeUntrusted(value);
  if (!text) return "";
  if (looksLikeInstruction(text)) return "";
  const allow = new Set((opts.allowMenuNames || []).map((n) => normalizeUntrusted(n)));
  if (allow.has(text)) {
    if (text.length > max) return "";
    return text;
  }
  if (ROLE_MARK_RE.test(String(value ?? "")) || String(value ?? "").includes("\n")) return "";
  if (text.length > max) return "";
  return text;
}
function sanitizeIntro(value, { ingredientIds = [], max = INTRO_MAX, strict = true } = {}) {
  let text = normalizeUntrusted(value);
  if (!text) return "";
  if (looksLikeInstruction(value) || looksLikeRecipe(text, ingredientIds)) {
    return strict ? DEFAULT_INTRO : "";
  }
  if (text.length > max) return DEFAULT_INTRO;
  return text;
}
function sanitizeFinish(value, { ingredientIds = [], max = FINISH_MAX, strict = true } = {}) {
  const original = String(value ?? "");
  if (!original.trim()) return { ok: true, value: DEFAULT_FINISH };
  if (original.length > max) {
    return { ok: false, error: "finish_too_long", value: DEFAULT_FINISH };
  }
  const text = normalizeUntrusted(original);
  if (!text) return { ok: true, value: DEFAULT_FINISH };
  if (looksLikeInstruction(original) || looksLikeRecipe(text, ingredientIds) || looksLikeForbiddenFinish(original)) {
    if (strict) return { ok: false, error: "finish_rejected", value: DEFAULT_FINISH };
    return { ok: true, value: DEFAULT_FINISH };
  }
  return { ok: true, value: text };
}
function isPlainName(name) {
  return PLAIN_NAMES.has(normalizeUntrusted(name));
}

// src/core/belief.js
var BELIEF_AXIS_CAP = 3;
var SUBJECTIVE_BELIEF_MIN = 0.2;
var SUBJECTIVE_BELIEF_MAX_CHARS = 120;
function computeBeta(knowVolumeRatio) {
  return Math.max(0, Math.min(1, 1 - knowVolumeRatio));
}
function clampBeliefAxis(value) {
  return Math.max(-BELIEF_AXIS_CAP, Math.min(BELIEF_AXIS_CAP, Number(value) || 0));
}
function sanitizeSubjectiveBelief(value) {
  const raw = String(value ?? "");
  if (!raw.trim() || looksLikeInstruction(raw)) return "";
  let text = normalizeUntrusted(raw);
  if (/(你(?:会|将|现在|应该|必须)|喝下|喝了这杯|必须)/.test(text)) return "";
  text = text.replace(/^(?:(?:我(?:觉得|猜|估计)?|大概|可能|也许|应该|估计)\s*)?(?:会(?:觉得)?\s*)?/, "").trim();
  if (!text || text.length > SUBJECTIVE_BELIEF_MAX_CHARS) return "";
  return text;
}
function mouthSuggestion(baseVector, beta, totalMouths) {
  const suggestion = {};
  const n = totalMouths || 1;
  for (const axis of Object.keys(baseVector || {})) {
    if (axis === "\u7CBE\u5EA6") {
      suggestion[axis] = 0;
      continue;
    }
    suggestion[axis] = (Number(baseVector[axis]) || 0) * beta / n;
  }
  suggestion.\u7CBE\u5EA6 = 0;
  return suggestion;
}
function addVectors(a, b) {
  const out = { ...a || {} };
  for (const k of Object.keys(b || {})) {
    if (k === "\u7CBE\u5EA6") {
      out.\u7CBE\u5EA6 = 0;
      continue;
    }
    out[k] = (out[k] || 0) + (b[k] || 0);
  }
  out.\u7CBE\u5EA6 = 0;
  return out;
}
function combineBeliefStrengths(...vectors) {
  const out = zeroStateAxes();
  for (const vector of vectors) {
    for (const [axis, value] of Object.entries(vector || {})) {
      if (axis === "\u7CBE\u5EA6") continue;
      out[axis] = (out[axis] || 0) + (Number(value) || 0);
    }
  }
  for (const axis of Object.keys(out)) {
    out[axis] = axis === "\u7CBE\u5EA6" ? 0 : clampBeliefAxis(out[axis]);
  }
  return out;
}
function decayFactor(decayStart, now, halfLifeMin = BELIEF_HALFLIFE_MIN) {
  if (decayStart == null) return 1;
  const dtMin = (now - decayStart) / 6e4;
  if (dtMin <= 0) return 1;
  const lambda = Math.log(2) / halfLifeMin;
  return Math.exp(-lambda * dtMin);
}
function currentResidualStrength(residuals, now) {
  const result = zeroStateAxes();
  result.\u7CBE\u5EA6 = 0;
  for (const r of residuals || []) {
    const decay = decayFactor(r.decayStart, now);
    for (const axis of Object.keys(r.cumulative || {})) {
      if (axis === "\u7CBE\u5EA6") continue;
      result[axis] = (result[axis] || 0) + (r.cumulative[axis] || 0) * decay;
    }
  }
  result.\u7CBE\u5EA6 = 0;
  return result;
}
function currentBeliefStrength(residuals, now) {
  return combineBeliefStrengths(currentResidualStrength(residuals, now));
}
function resolveAgentBeliefs(entries, contentPack = {}) {
  const objectVector = zeroStateAxes();
  const directVector = zeroStateAxes();
  const subjective = [];
  const menu2 = contentPack.menu || [];
  const profiles = contentPack.beliefProfiles || {};
  const directAxes = /* @__PURE__ */ new Set(["\u6109\u60A6", "\u5524\u9192", "\u4EB2\u8FD1", "\u5B88\u95E8", "\u6B32\u671B"]);
  for (const entry of entries || []) {
    const confidence = Math.max(0, Math.min(1, Number(entry?.confidence ?? 1)));
    if (!Number.isFinite(confidence) || confidence <= 0) continue;
    const about = String(entry?.about || "").trim();
    if (about) {
      const menuItem2 = menu2.find((m) => m.claimedName === about);
      const profile = profiles[about] || menuItem2?.effects || menuItem2?.characterEffects || null;
      if (profile) {
        for (const [axis, value] of Object.entries(profile)) {
          if (axis === "\u7CBE\u5EA6") continue;
          objectVector[axis] = (objectVector[axis] || 0) + (Number(value) || 0) * confidence;
        }
      }
    }
    const effects = entry?.effects && typeof entry.effects === "object" ? entry.effects : null;
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
  objectVector.\u7CBE\u5EA6 = 0;
  directVector.\u7CBE\u5EA6 = 0;
  return { objectVector, directVector, subjective };
}
function activeSubjectiveBeliefs(residuals, now, threshold = SUBJECTIVE_BELIEF_MIN) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const residual of residuals || []) {
    const decay = decayFactor(residual.decayStart, now);
    for (const item of residual.subjective || []) {
      const strength = Math.max(0, Math.min(1, Number(item?.confidence ?? 1))) * decay;
      const text = String(item?.text || "").trim();
      if (!text || strength < threshold || seen.has(text)) continue;
      seen.add(text);
      out.push({ text, strength });
    }
  }
  return out;
}
function beliefToStateDelta(beliefStrength, adoptionWeights) {
  const delta = zeroStateAxes();
  delta.\u7CBE\u5EA6 = 0;
  for (const axis of Object.keys(beliefStrength || {})) {
    if (axis === "\u7CBE\u5EA6") continue;
    const w = adoptionWeights?.[axis] ?? 0;
    delta[axis] = beliefStrength[axis] * w;
  }
  return delta;
}
function beliefToPerception(beliefStrength) {
  const intensity = Object.entries(beliefStrength || {}).filter(([axis]) => axis !== "\u7CBE\u5EA6").reduce((s, [, v]) => s + Math.abs(v), 0);
  return {
    layer: "description",
    allowsCategory: true,
    allowsSubcategory: true,
    allowsIntensity: true,
    allowsSpecific: false,
    intensity
  };
}

// src/core/flavor.js
function integrateIntensity(A, tauRise, tauFall, t) {
  if (t < 0 || t > TASTE_DURATION_SEC) return 0;
  if (!A) return 0;
  return A * (1 - Math.exp(-t / tauRise)) * Math.exp(-t / tauFall);
}
function componentIntensity(comp, t) {
  const tau = TAU[comp.axis] || { rise: 1, fall: 15 };
  const rise = comp.tauRise ?? tau.rise;
  const fall = comp.tauFall ?? tau.fall;
  return integrateIntensity(comp.A, rise, fall, t);
}
function mouthTimeSec(mouth, now) {
  if (mouth.startTime == null) return null;
  if (mouth.startTime > now) return null;
  return (now - mouth.startTime) / 1e3;
}
function mouthAxisSum(mouth, axis, t) {
  let sum = 0;
  for (const comp of mouth.components || []) {
    if (comp.axis !== axis) continue;
    sum += componentIntensity(comp, t);
  }
  return sum;
}
function flavorProjectionAtTime(mouths, axis, nowOrT, options = {}) {
  const now = options.now ?? (typeof nowOrT === "number" && nowOrT > 1e10 ? nowOrT : null);
  let maxVal = 0;
  for (const m of mouths || []) {
    let t;
    if (now != null) {
      t = mouthTimeSec(m, now);
      if (t == null) continue;
    } else {
      if (m.startTime != null && m.startTime > (options.refNow ?? 0)) continue;
      t = nowOrT;
    }
    const sumInMouth = mouthAxisSum(m, axis, t);
    if (sumInMouth > maxVal) maxVal = sumInMouth;
  }
  return maxVal;
}
function rawFlavorAt(mouths, now) {
  const raw = zeroFlavorAxes();
  for (const axis of FLAVOR_AXES) {
    raw[axis] = flavorProjectionAtTime(mouths, axis, now, { now });
  }
  return raw;
}
function isSuppressed(pressAxis, targetAxis, mouths, now) {
  const allowed = SUPPRESSION[pressAxis];
  if (!allowed || !allowed.includes(targetAxis)) return false;
  const pressVal = flavorProjectionAtTime(mouths, pressAxis, now, { now });
  const targetVal = flavorProjectionAtTime(mouths, targetAxis, now, { now });
  if (targetVal <= 0) return false;
  return pressVal >= 2 * targetVal;
}
function applySuppression(raw, mouths, now) {
  const out = { ...raw };
  const suppressed = {};
  for (const [press, targets] of Object.entries(SUPPRESSION)) {
    for (const target of targets) {
      if (isSuppressed(press, target, mouths, now)) {
        suppressed[target] = true;
        out[target] = 0;
      }
    }
  }
  return { flavor: out, suppressed };
}
function flavorPeakForMouth(mouth, axis) {
  let peak = 0;
  for (let t = 0; t <= TASTE_DURATION_SEC; t += 0.5) {
    const v = mouthAxisSum(mouth, axis, t);
    if (v > peak) peak = v;
  }
  return peak;
}
function peakFlavor(mouths) {
  const raw = zeroFlavorAxes();
  for (const axis of FLAVOR_AXES) {
    let max = 0;
    for (const m of mouths || []) {
      const v = flavorPeakForMouth(m, axis);
      if (v > max) max = v;
    }
    raw[axis] = max;
  }
  return raw;
}
function flavorHasSignal(flavor) {
  return FLAVOR_AXES.some((axis) => (flavor?.[axis] || 0) > 0.05);
}
function suppressByPeaks(raw) {
  const out = { ...raw };
  for (const [press, targets] of Object.entries(SUPPRESSION)) {
    for (const target of targets) {
      const pressVal = raw[press] || 0;
      const targetVal = raw[target] || 0;
      if (targetVal > 0 && pressVal >= 2 * targetVal) out[target] = 0;
    }
  }
  return out;
}
function reportedFlavor(cup, evalRes = {}) {
  const mouths = (cup?.mouths || []).filter((m) => m.applied || m.startTime != null);
  const targets = mouths.length ? mouths : cup?.mouths || [];
  const peak = peakFlavor(targets);
  if (flavorHasSignal(peak)) return suppressByPeaks(peak);
  if (flavorHasSignal(evalRes.aggregated)) return { ...evalRes.aggregated };
  if (flavorHasSignal(cup?.claimedFlavor)) return { ...cup.claimedFlavor };
  return peak;
}
function flavorTier(value) {
  const a = Math.abs(value);
  if (a < PHRASE_TIERS.\u4F4E[1]) return "\u4F4E";
  if (a < PHRASE_TIERS.\u4E2D[1]) return "\u4E2D";
  return "\u9AD8";
}
function stableIndex(seed, count) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % count;
}
function flavorCandidates(lexicon, axis, tier) {
  const slot = lexicon?.[axis]?.[tier];
  const out = [];
  if (Array.isArray(slot)) {
    for (const entry of slot) {
      if (entry && typeof entry.text === "string" && entry.text.length > 0) {
        out.push({ pattern: typeof entry.pattern === "string" && entry.pattern ? entry.pattern : entry.text, text: entry.text });
      }
    }
  } else if (typeof slot === "string" && slot.length > 0) {
    out.push({ pattern: slot, text: slot });
  }
  return out;
}
function assembleFlavorDescription(flavor, lexicon, ratioWords = {}, cupId = "") {
  const moved = [];
  for (const axis of FLAVOR_AXES) {
    const v = flavor?.[axis] || 0;
    if (v < FLAVOR_DELTA_MIN) continue;
    moved.push({ axis, value: v, abs: v, tier: flavorTier(v) });
  }
  moved.sort((a, b) => b.abs - a.abs);
  const capped = moved.slice(0, EFFECT_PHRASE_MAX);
  const usedPatterns = /* @__PURE__ */ new Set();
  const phrases = [];
  const patterns = [];
  for (const m of capped) {
    const cands = flavorCandidates(lexicon, m.axis, m.tier);
    if (!cands.length) continue;
    const base = stableIndex(`${cupId}|${m.axis}`, cands.length);
    const ordered = [...cands.slice(base), ...cands.slice(0, base)];
    const chosen = ordered.find((c) => !usedPatterns.has(c.pattern));
    if (!chosen) continue;
    usedPatterns.add(chosen.pattern);
    patterns.push(chosen.pattern);
    phrases.push(chosen.text);
  }
  const ratioBits = Object.values(ratioWords || {}).filter((t) => typeof t === "string" && t.length > 0);
  return { text: phrases.join(""), phrases, patterns, ratios: ratioBits };
}
function computeRatio(numerator, denominator) {
  if (denominator === 0) {
    return numerator > 0 ? Infinity : NaN;
  }
  return numerator / denominator;
}
function ratioWord(name, value, thresholds) {
  if (value == null || Number.isNaN(value)) return null;
  const table = thresholds?.[name];
  if (!table) return null;
  if (value === Infinity) return table.highWord;
  if (value < table.low) return table.lowWord;
  if (value > table.high) return table.highWord;
  return table.midWord ?? null;
}
function computeRatios(aggregated, thresholds) {
  const ratios = {
    "\u751C/\u9178": computeRatio(aggregated.\u751C || 0, aggregated.\u9178 || 0),
    "\u751C/\u82E6": computeRatio(aggregated.\u751C || 0, aggregated.\u82E6 || 0),
    "\u9999/(\u82E6+\u6DA9)": computeRatio(aggregated.\u9999 || 0, (aggregated.\u82E6 || 0) + (aggregated.\u6DA9 || 0)),
    \u603B\u91CF: FLAVOR_AXES.reduce((s, a) => s + (aggregated[a] || 0), 0)
  };
  const words = {};
  for (const name of ["\u603B\u91CF", "\u751C/\u9178", "\u751C/\u82E6", "\u9999/(\u82E6+\u6DA9)"]) {
    words[name] = ratioWord(name, ratios[name], thresholds);
  }
  return { ratios, words };
}
function treeDistance(pathA, pathB) {
  const a = !pathA || pathA.length === 0 || pathA[0] === "\u65E0" ? ["\u65E0"] : pathA;
  const b = !pathB || pathB.length === 0 || pathB[0] === "\u65E0" ? ["\u65E0"] : pathB;
  if (a[0] === "\u65E0" && b[0] === "\u65E0") return 0;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return a.length - i + (b.length - i);
}
function expectedTreeDistance(sourceI, sourceJ) {
  const pathsI = sourceI.treePaths || [{ path: sourceI.treePath || ["\u65E0"], weight: 1 }];
  const pathsJ = sourceJ.treePaths || [{ path: sourceJ.treePath || ["\u65E0"], weight: 1 }];
  let sum = 0;
  for (const a of pathsI) {
    for (const b of pathsJ) {
      sum += (a.weight || 1) * (b.weight || 1) * treeDistance(a.path, b.path);
    }
  }
  return sum;
}
var MAX_TREE_DIST = 4;
function flavorShare(source, axisTotals) {
  let contrib = 0;
  let total = 0;
  for (const axis of FLAVOR_AXES) {
    const v = source.flavor?.[axis] || 0;
    contrib += v;
    total += axisTotals[axis] || 0;
  }
  if (total <= 0) return 0;
  return contrib / total;
}
function isSignificant(source, axisTotals) {
  if ((source.volumeRatio || 0) >= SIGNIFICANT_VOLUME) return true;
  const share = source.flavorContribution ?? flavorShare(source, axisTotals);
  return share >= SIGNIFICANT_FLAVOR;
}
function countSignificantSources(sources, axisTotals = zeroFlavorAxes()) {
  return (sources || []).filter((s) => isSignificant(s, axisTotals)).length;
}
function computeDiscreteness(sources, axisTotals = zeroFlavorAxes()) {
  const list = (sources || []).filter((s) => isSignificant(s, axisTotals));
  if (list.length < 2) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const w = (list[i].volumeRatio || 0) * (list[j].volumeRatio || 0);
      const dist = typeof list[i].treeDist === "function" ? list[i].treeDist(list[j]) : expectedTreeDistance(list[i], list[j]);
      num += w * dist;
      den += w * MAX_TREE_DIST;
    }
  }
  return den === 0 ? 0 : num / den;
}
function flavorMismatch(claimed, actual) {
  let sum = 0;
  for (const axis of FLAVOR_AXES) {
    const d = (claimed?.[axis] || 0) - (actual?.[axis] || 0);
    sum += d * d;
  }
  return Math.sqrt(sum) / Math.sqrt(6 * 25);
}
function diluteConcentrations(contributions, totalVolume) {
  const out = zeroFlavorAxes();
  if (!totalVolume) return out;
  for (const axis of FLAVOR_AXES) {
    out[axis] = (contributions[axis] || 0) / totalVolume;
  }
  return out;
}
function aggregateAxes(concentrations) {
  return { ...zeroFlavorAxes(), ...concentrations };
}
function dilutionVolume({ liquidMl, iceMl = 0, method, elapsedMin = 0 }) {
  let extra = 0;
  if (method === "stir") extra += liquidMl * 0.25;
  if (method === "shake") extra += liquidMl * 0.3;
  const melt = Math.min(iceMl, liquidMl * 0.05 * Math.floor(elapsedMin / 10));
  return extra + melt;
}
var TOLERANCE_FULL_DRINKS = 200;
var TOLERANCE_MAX = 0.4;
var TOLERANCE_LIFT = 0.5;
function flavorTolerance(lifetimeDrinks) {
  const d = Math.max(0, Number(lifetimeDrinks) || 0);
  return Math.min(TOLERANCE_MAX, d / TOLERANCE_FULL_DRINKS * TOLERANCE_MAX);
}
function applyTolerance(flavor, tolerance) {
  const t = Math.min(TOLERANCE_MAX, Math.max(0, Number(tolerance) || 0));
  if (!t) return { ...flavor };
  const out = { ...flavor };
  if (typeof out.\u70C8 === "number") out.\u70C8 = out.\u70C8 * (1 - t);
  const lift = 1 + t * TOLERANCE_LIFT;
  if (typeof out.\u9999 === "number") out.\u9999 = out.\u9999 * lift;
  if (typeof out.\u751C === "number") out.\u751C = out.\u751C * lift;
  return out;
}
var ALCOHOL_TOLERANCE_MAX = 0.25;
function alcoholTolerance(lifetimeDrinks) {
  const d = Math.max(0, Number(lifetimeDrinks) || 0);
  return Math.min(ALCOHOL_TOLERANCE_MAX, d / TOLERANCE_FULL_DRINKS * ALCOHOL_TOLERANCE_MAX);
}

// src/content/actives.js
var ACTIVE_AXIS_WHITELIST = ["\u6109\u60A6", "\u5524\u9192"];
var REACTION_AXES = ["\u4EB2\u8FD1", "\u5B88\u95E8", "\u6B32\u671B"];
var CAFFEINE_CAP_INLINE = 4;
var MAX_STATE_INLINE = 5;
var MIN_STATE_INLINE = -5;
function clampInline(v) {
  return Math.max(MIN_STATE_INLINE, Math.min(MAX_STATE_INLINE, v));
}
function curveCaffeine(k) {
  const khat = Math.min(k, CAFFEINE_CAP_INLINE);
  let arousal;
  let pleasure;
  if (khat <= 2) {
    arousal = 1.2 * khat;
    pleasure = 0.5 * khat;
  } else {
    arousal = 2.4;
    pleasure = 1 - 0.6 * (khat - 2);
  }
  return { \u6109\u60A6: clampInline(pleasure), \u5524\u9192: clampInline(arousal) };
}
var ACTIVE_DEFS = {
  \u5496\u5561\u56E0: {
    reference: true,
    // 闸③⑥ 的基准化合物；校验强制全表恰好一个
    halfLifeH: 5,
    cap: 4,
    zero: 0.05,
    axes: ["\u6109\u60A6", "\u5524\u9192"],
    curve: curveCaffeine
    // 依据 A：浓缩 ≈60–76mg/30ml；人类平均半衰期 ≈5h。
    // **数值与曲线有既有测试钉住，一个字不许动。**
  },
  \u594E\u5B81: {
    halfLifeH: 1.5,
    cap: 2,
    zero: 0.1,
    axes: ["\u5524\u9192"],
    curve: (k) => ({ \u5524\u9192: 0.06 * k })
    // 依据 B：含量有出处（EU 上限 100mg/L、市售 ≈80mg/L），一杯实际摄入
    // ≈8–12mg，远低于药理剂量。真实半衰期 11–16h **故意不用**——
    // 效果本质是味觉唤醒，按感官持续 ≈1.5h 定。效果量级与半衰期凭感觉。
  },
  \u7CD6\u5206: {
    halfLifeH: 0.75,
    cap: 3,
    zero: 0.05,
    axes: ["\u6109\u60A6"],
    curve: (k) => ({ \u6109\u60A6: 0.08 * k })
    // 依据 C：10g/份是营养学惯用约定（换算基准可查），
    // 效果量级与回落时间全凭感觉。
  },
  \u82E6\u5473: {
    halfLifeH: 2,
    cap: 2,
    zero: 0.05,
    axes: ["\u6109\u60A6"],
    curve: (k) => ({ \u6109\u60A6: -0.08 * k }),
    phase2: { axis: "\u5B88\u95E8", slope: 0.05 }
    // 依据 C：纯口感，未习惯者不悦。
    // phase2 是二期候选预埋：**求值器不读 phase2**，白名单不开守门即永不生效。
  },
  \u679C\u9178: {
    halfLifeH: 0.5,
    cap: 2,
    zero: 0.05,
    axes: ["\u5524\u9192"],
    curve: (k) => ({ \u5524\u9192: 0.05 * k })
    // 依据 C：酸度可查（青柠 5–7%），「酸=提神」纯感官印象。
  },
  \u5355\u5B81: {
    halfLifeH: 1,
    cap: 2,
    zero: 0.05,
    axes: ["\u5524\u9192"],
    curve: (k) => ({ \u5524\u9192: 0.04 * k })
    // 依据 C：收敛感给微弱唤醒；白藜芦醇等在饮用剂量下无可靠精神效果。
  },
  \u5564\u9152\u82B1: {
    halfLifeH: 1,
    cap: 2,
    zero: 0.05,
    axes: ["\u5524\u9192"],
    curve: (k) => ({ \u5524\u9192: -0.03 * k })
    // 依据 C：镇静 reputation 是文化印象，膳食剂量下无可靠药理支持，刻意给小。
  },
  \u4FA7\u67CF\u916E: {
    halfLifeH: 8,
    cap: 2,
    zero: 0.02,
    axes: ["\u5524\u9192"],
    curve: (k) => ({ \u5524\u9192: 0.03 * k })
    // 依据 B（含量）/ C（效果）：含量按 EU 上限 35mg/kg 估算；
    // 真实饮用剂量下精神效果无可靠文献支持（「苦艾致幻」是文化神话），
    // 数值极小＝刻意表达「接近没有」。
  }
};
function normalizeIngredientActives(ing) {
  if (!ing || typeof ing !== "object") return [];
  if (Array.isArray(ing.actives)) {
    return ing.actives.filter((d) => d && ACTIVE_DEFS[d.compound]).map((d) => ({
      compound: d.compound,
      amount: d.amount,
      referenceVolumeMl: d.referenceVolumeMl
    }));
  }
  if (ing.activeIngredient && ACTIVE_DEFS[ing.activeIngredient]) {
    return [{
      compound: ing.activeIngredient,
      amount: ing.activeAmount,
      referenceVolumeMl: ing.referenceVolumeMl
    }];
  }
  return [];
}
function compoundPeak(name, axis, defs = ACTIVE_DEFS, steps = 400) {
  const def = defs[name];
  if (!def || !def.axes.includes(axis)) return 0;
  let peak = 0;
  for (let i = 0; i <= steps; i += 1) {
    const k = def.cap * i / steps;
    const v = Math.abs(Number(def.curve(k)[axis] || 0));
    if (v > peak) peak = v;
  }
  return peak;
}
function validateActiveDefs(defs = ACTIVE_DEFS) {
  const names = Object.keys(defs);
  const refs = names.filter((n) => defs[n].reference === true);
  if (refs.length !== 1) {
    throw new Error(`\u6D3B\u6027\u6210\u5206\u6CE8\u518C\u8868\u5FC5\u987B\u6070\u597D\u6709\u4E00\u4E2A\u57FA\u51C6\u5316\u5408\u7269\uFF0C\u5B9E\u9645 ${refs.length} \u4E2A`);
  }
  const ref = refs[0];
  for (const name of names) {
    const def = defs[name];
    if (!Array.isArray(def.axes) || def.axes.length === 0) {
      throw new Error(`\u5316\u5408\u7269 ${name} \u672A\u58F0\u660E axes`);
    }
    for (const axis of def.axes) {
      if (!ACTIVE_AXIS_WHITELIST.includes(axis)) {
        throw new Error(`\u5316\u5408\u7269 ${name} \u58F0\u660E\u4E86\u767D\u540D\u5355\u5916\u7684\u8F74\uFF1A${axis}`);
      }
    }
    if (def.axes.length > 2) {
      throw new Error(`\u5316\u5408\u7269 ${name} \u7684\u8F74\u6570\u8D85\u8FC7 2\uFF1A${def.axes.join("/")}`);
    }
    if (def.axes.filter((a) => REACTION_AXES.includes(a)).length > 1) {
      throw new Error(`\u5316\u5408\u7269 ${name} \u7684\u53CD\u5E94\u5C42\u8F74\u6570\u8D85\u8FC7 1`);
    }
    if (!(def.halfLifeH > 0)) throw new Error(`\u5316\u5408\u7269 ${name} \u7684 halfLifeH \u5FC5\u987B\u4E3A\u6B63`);
    if (!(def.cap > 0)) throw new Error(`\u5316\u5408\u7269 ${name} \u7684 cap \u5FC5\u987B\u4E3A\u6B63`);
    if (!(def.zero > 0)) throw new Error(`\u5316\u5408\u7269 ${name} \u7684 zero \u5FC5\u987B\u4E3A\u6B63`);
  }
  for (const axis of ACTIVE_AXIS_WHITELIST) {
    const base = compoundPeak(ref, axis, defs);
    if (!base) continue;
    const budget = base * 0.5;
    let pos = 0;
    let neg = 0;
    for (const name of names) {
      if (name === ref) continue;
      const def = defs[name];
      if (!def.axes.includes(axis)) continue;
      const peak = compoundPeak(name, axis, defs);
      const at = Number(def.curve(def.cap)[axis] || 0);
      if (peak > budget) {
        throw new Error(`\u5316\u5408\u7269 ${name} \u5728 ${axis} \u8F74\u7684\u5CF0\u503C ${peak.toFixed(3)} \u8D85\u8FC7\u57FA\u51C6\u7684\u4E00\u534A ${budget.toFixed(3)}`);
      }
      if (at >= 0) pos += peak;
      else neg += peak;
    }
    if (pos > budget) {
      throw new Error(`${axis} \u8F74\u6B63\u5411\u5408\u8BA1\u5CF0\u503C ${pos.toFixed(3)} \u8D85\u8FC7\u9884\u7B97 ${budget.toFixed(3)}`);
    }
    if (neg > budget) {
      throw new Error(`${axis} \u8F74\u8D1F\u5411\u5408\u8BA1\u5CF0\u503C ${neg.toFixed(3)} \u8D85\u8FC7\u9884\u7B97 ${budget.toFixed(3)}`);
    }
  }
  return true;
}

// src/core/active.js
var HOUR_MS = 36e5;
function defOf(compound) {
  return ACTIVE_DEFS[compound] || null;
}
function emptyActives() {
  return {};
}
function getSlot(actives, compound, now) {
  if (!actives) return null;
  if (!actives[compound]) actives[compound] = { amount: 0, lastSettle: now };
  return actives[compound];
}
function activeAmount(actives, compound) {
  const slot = actives?.[compound];
  return slot ? Number(slot.amount || 0) : 0;
}
function collectActives(parts, ingredients2) {
  const out = {};
  for (const p of parts || []) {
    const id = String(p.id ?? "").trim();
    const ing = ingredients2?.[p.id] || ingredients2?.[id];
    if (!ing) continue;
    for (const decl of normalizeIngredientActives(ing)) {
      const ref = decl.referenceVolumeMl;
      if (!ref) continue;
      const add = p.volume / ref * (decl.amount || 0);
      if (!add) continue;
      out[decl.compound] = (out[decl.compound] || 0) + add;
    }
  }
  return out;
}
function ingestActives(state, compounds, now) {
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
function metabolizeCompound(compound, k, hours) {
  const def = defOf(compound);
  if (!def) return 0;
  if (k <= 0 || hours <= 0) return k < def.zero ? 0 : k;
  const next = k * 2 ** (-hours / def.halfLifeH);
  return next < def.zero ? 0 : next;
}
function settleActives(state, now) {
  const actives = state?.actives;
  if (!actives) return {};
  for (const compound of Object.keys(actives)) {
    const slot = actives[compound];
    const def = defOf(compound);
    if (!def) {
      delete actives[compound];
      continue;
    }
    const hours = (now - Number(slot.lastSettle || 0)) / HOUR_MS;
    if (hours > 0) slot.amount = metabolizeCompound(compound, Number(slot.amount || 0), hours);
    slot.lastSettle = now;
    if (!(slot.amount > 0)) delete actives[compound];
  }
  return actives;
}
function resetActives(state) {
  state.actives = emptyActives();
  return state.actives;
}
function clampState2(v) {
  return Math.max(MIN_STATE, Math.min(MAX_STATE, v));
}
function activesToPhysiology(actives) {
  const out = { \u6109\u60A6: 0, \u5524\u9192: 0, \u7CBE\u5EA6: 0, \u4EB2\u8FD1: 0, \u5B88\u95E8: 0, \u6B32\u671B: 0 };
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
  for (const axis of Object.keys(out)) out[axis] = clampState2(out[axis]);
  return out;
}
function exportActives(actives) {
  return JSON.parse(JSON.stringify(actives || {}));
}
function restoreActives(payload, now) {
  const out = {};
  for (const [compound, slot] of Object.entries(payload || {})) {
    const def = defOf(compound);
    if (!def || !slot) continue;
    const hours = (now - Number(slot.lastSettle || 0)) / HOUR_MS;
    const amount = hours > 0 ? metabolizeCompound(compound, Number(slot.amount || 0), hours) : Number(slot.amount || 0);
    if (amount > 0) out[compound] = { amount, lastSettle: now };
  }
  return out;
}
function caffeineOfParts(parts, ingredients2) {
  return collectActives(parts, ingredients2).\u5496\u5561\u56E0 || 0;
}
function metabolizeCaffeine(k, hours) {
  if (k <= 0 || hours <= 0) return k < CAFFEINE_ZERO ? 0 : k;
  const next = k * 2 ** (-hours / CAFFEINE_HALF_LIFE_H);
  return next < CAFFEINE_ZERO ? 0 : next;
}
function chatK(k) {
  return Math.min(k, CAFFEINE_CAP);
}
function caffeineToPhysiology(k) {
  const khat = chatK(k);
  let arousal;
  let pleasure;
  if (khat <= 2) {
    arousal = 1.2 * khat;
    pleasure = 0.5 * khat;
  } else {
    arousal = 2.4;
    pleasure = 1 - 0.6 * (khat - 2);
  }
  return {
    \u6109\u60A6: clampState2(pleasure),
    \u5524\u9192: clampState2(arousal),
    \u7CBE\u5EA6: 0,
    \u4EB2\u8FD1: 0,
    \u5B88\u95E8: 0,
    \u6B32\u671B: 0
  };
}
function addCaffeineOnly(physiology, cafe) {
  return {
    ...physiology,
    \u6109\u60A6: (physiology.\u6109\u60A6 || 0) + (cafe.\u6109\u60A6 || 0),
    \u5524\u9192: (physiology.\u5524\u9192 || 0) + (cafe.\u5524\u9192 || 0)
  };
}

// src/core/lifecycle.js
var DEFAULT_TIMEZONE = "Asia/Shanghai";
var DEFAULT_TRANSIENT_TTL_HOURS = 72;
var DEFAULT_BLACKOUT_RECOVERY_HOURS = BLACKOUT_RECOVER_MS / 36e5;
var HOUR_MS2 = 36e5;
function positiveHours(raw, name) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} \u5FC5\u987B\u662F\u5927\u4E8E 0 \u7684\u5C0F\u65F6\u6570\uFF0C\u6536\u5230\uFF1A${JSON.stringify(raw)}`);
  }
  return value;
}
function parseBool(raw, name) {
  const text = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  throw new Error(`${name} \u5FC5\u987B\u662F true/false\uFF0C\u6536\u5230\uFF1A${JSON.stringify(raw)}`);
}
function assertTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    throw new Error(`PROOF_STATE_TIMEZONE \u4E0D\u662F\u5408\u6CD5\u65F6\u533A\uFF1A${JSON.stringify(tz)}`);
  }
  return tz;
}
function resolveLifecycleConfig(env = {}) {
  const timezone = env.PROOF_STATE_TIMEZONE === void 0 ? DEFAULT_TIMEZONE : assertTimezone(String(env.PROOF_STATE_TIMEZONE));
  const transientTtlHours = env.PROOF_TRANSIENT_STATE_TTL_HOURS === void 0 ? DEFAULT_TRANSIENT_TTL_HOURS : positiveHours(env.PROOF_TRANSIENT_STATE_TTL_HOURS, "PROOF_TRANSIENT_STATE_TTL_HOURS");
  const blackoutEnabled = env.PROOF_BLACKOUT_ENABLED === void 0 ? true : parseBool(env.PROOF_BLACKOUT_ENABLED, "PROOF_BLACKOUT_ENABLED");
  const blackoutRecoveryHours = env.PROOF_BLACKOUT_RECOVERY_HOURS === void 0 ? DEFAULT_BLACKOUT_RECOVERY_HOURS : positiveHours(env.PROOF_BLACKOUT_RECOVERY_HOURS, "PROOF_BLACKOUT_RECOVERY_HOURS");
  const stateDbPath = env.PROOF_STATE_DB_PATH === void 0 ? null : String(env.PROOF_STATE_DB_PATH);
  if (stateDbPath !== null && stateDbPath.trim() === "") {
    throw new Error("PROOF_STATE_DB_PATH \u4E0D\u5F97\u4E3A\u7A7A\u5B57\u7B26\u4E32");
  }
  return {
    timezone,
    transientTtlHours,
    transientTtlMs: transientTtlHours * HOUR_MS2,
    blackoutEnabled,
    blackoutRecoveryHours,
    blackoutRecoveryMs: blackoutRecoveryHours * HOUR_MS2,
    stateDbPath
  };
}
function normalizeLifecycleOptions(partial = {}) {
  const base = resolveLifecycleConfig({});
  const merged = { ...base, ...partial };
  if (partial.blackoutRecoveryHours !== void 0) {
    merged.blackoutRecoveryHours = positiveHours(partial.blackoutRecoveryHours, "blackoutRecoveryHours");
    merged.blackoutRecoveryMs = merged.blackoutRecoveryHours * HOUR_MS2;
  }
  if (partial.transientTtlHours !== void 0) {
    merged.transientTtlHours = positiveHours(partial.transientTtlHours, "transientTtlHours");
    merged.transientTtlMs = merged.transientTtlHours * HOUR_MS2;
  }
  if (partial.timezone !== void 0) merged.timezone = assertTimezone(String(partial.timezone));
  return merged;
}
var dayFormatters = /* @__PURE__ */ new Map();
function dayKey(now, timezone = DEFAULT_TIMEZONE) {
  let formatter = dayFormatters.get(timezone);
  if (!formatter) {
    assertTimezone(timezone);
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    dayFormatters.set(timezone, formatter);
  }
  return formatter.format(new Date(now));
}
var blackoutSeq = 0;
function newBlackoutId(now) {
  blackoutSeq += 1;
  return `bo-${now}-${blackoutSeq}`;
}
function openBlackout(state, now, config) {
  if (!config.blackoutEnabled) return null;
  const open = (state.fragmentBatches || []).find((batch2) => batch2.end == null);
  if (open) return open;
  const batch = {
    id: newBlackoutId(now),
    start: now,
    end: null,
    createdAt: now,
    hiddenFrom: now,
    restoreAt: now + config.blackoutRecoveryMs,
    hiddenUntil: now + config.blackoutRecoveryMs,
    mode: "soft",
    enabled: true,
    readable: false
  };
  state.fragmentBatches.push(batch);
  return batch;
}
function migrateBlackoutBatch(batch, config) {
  const start = Number(batch.start ?? batch.hiddenFrom ?? 0);
  const restoreAt = Number.isFinite(Number(batch.restoreAt)) ? Number(batch.restoreAt) : start + config.blackoutRecoveryMs;
  const migrated = {
    id: batch.id || newBlackoutId(start),
    start,
    end: batch.end ?? null,
    createdAt: batch.createdAt ?? start,
    hiddenFrom: batch.hiddenFrom ?? start,
    restoreAt,
    hiddenUntil: batch.hiddenUntil ?? restoreAt,
    mode: batch.mode || "soft",
    enabled: batch.enabled !== false,
    readable: batch.readable === true
  };
  if (batch.recovery && typeof batch.recovery === "object") migrated.recovery = batch.recovery;
  return migrated;
}
function refreshBlackouts(state, now) {
  for (const batch of state.fragmentBatches || []) {
    if (batch.readable !== true && now >= batch.restoreAt) batch.readable = true;
  }
  return state.fragmentBatches || [];
}
function liftBlackouts(state, now) {
  for (const batch of state.fragmentBatches || []) {
    if (batch.end == null) batch.end = now;
    batch.readable = true;
  }
  return state.fragmentBatches || [];
}
function blackoutVisibility(state, now) {
  const batches = state.fragmentBatches || [];
  const active = batches.find((batch) => batch.readable !== true && now < batch.restoreAt);
  if (!active) return { active: false, soft: true };
  return {
    active: true,
    soft: true,
    blackoutId: active.id,
    hiddenFrom: active.hiddenFrom,
    hiddenUntil: active.hiddenUntil,
    restoreAt: active.restoreAt,
    mode: active.mode
  };
}
function isRecordReadable(record, state, now) {
  const time = Number(record?.time ?? record?.consumedAt ?? 0);
  for (const batch of state.fragmentBatches || []) {
    if (batch.readable === true) continue;
    if (now >= batch.restoreAt) continue;
    const end = batch.end == null ? Infinity : batch.end;
    if (time >= batch.hiddenFrom && time <= end) return false;
  }
  return true;
}
function lastTransientActivity(state) {
  const events = state?.drinkEvents || [];
  const fromEvents = events.length ? Math.max(...events.map((e) => Number(e.consumedAt) || 0)) : 0;
  const marked = Number(state?.lastTransientActivityAt || 0);
  return Math.max(fromEvents, marked);
}
function transientDeadline(state, config) {
  const at = lastTransientActivity(state);
  return at > 0 ? at + config.transientTtlMs : null;
}
function seedTransientActivity(state) {
  if (Number(state.lastTransientActivityAt || 0) > 0) return state.lastTransientActivityAt;
  if ((state.drinkEvents || []).length) return 0;
  const hasLoad = Number(state.c || 0) > 0 || (state.hangoverSnapshots || []).length > 0 || Object.values(state.actives || {}).some((a) => Number(a?.amount || 0) > 0) || (state.beliefResiduals || []).length > 0 || (state.directBeliefResiduals || []).length > 0 || (state.characterResiduals || []).length > 0;
  if (!hasLoad) return 0;
  state.lastTransientActivityAt = Number(state.lastSettle || 0);
  return state.lastTransientActivityAt;
}
function markTransientActivity(state, now) {
  state.lastTransientActivityAt = Math.max(Number(state.lastTransientActivityAt || 0), Number(now) || 0);
  return state.lastTransientActivityAt;
}
function pruneTransient(state, now, config) {
  const deadline = transientDeadline(state, config);
  if (deadline == null || now <= deadline) return false;
  state.c = 0;
  state.eventPeak = 0;
  state.tonightPeak = 0;
  state.hangoverSnapshots = [];
  state.beliefResiduals = [];
  state.directBeliefResiduals = [];
  state.characterResiduals = [];
  state.effectBaseline = null;
  state.pendingSensitivity = [];
  state.currentCup = null;
  state.tasteCurves = [];
  state.vomitArmed = true;
  state.actives = {};
  state.drinkEvents = (state.drinkEvents || []).filter((event) => event.expiresAt > now);
  state.transientExpiredAt = now;
  state.lastTransientActivityAt = 0;
  return true;
}
function recordDrinkEvent(state, event, config) {
  state.drinkEvents ||= [];
  if (state.drinkEvents.some((existing) => existing.eventId === event.eventId)) return null;
  markTransientActivity(state, event.consumedAt);
  const entry = {
    eventId: event.eventId,
    cupId: event.cupId,
    consumedAt: event.consumedAt,
    standardDrinks: event.standardDrinks ?? 0,
    expiresAt: event.consumedAt + config.transientTtlMs,
    sourceRevision: state.revision ?? 0
  };
  state.drinkEvents.push(entry);
  return entry;
}
function activeDrinkEvents(state, now, config = null, scope = "today") {
  const alive = (state.drinkEvents || []).filter((event) => event.expiresAt > now);
  if (scope !== "today" || !config) return alive;
  const today = dayKey(now, config.timezone);
  return alive.filter((event) => dayKey(event.consumedAt, config.timezone) === today);
}
function bumpRevision(state) {
  state.revision = Number(state.revision || 0) + 1;
  return state.revision;
}
function markResetBoundary(state, now) {
  if (state.resetBoundary && Number(state.resetBoundary.at) === Number(now)) {
    return state.resetBoundary;
  }
  state.resetBoundary = { at: now, revision: bumpRevision(state) };
  return state.resetBoundary;
}
function applyResetBoundary(state, boundary) {
  if (!boundary || !Number.isFinite(Number(boundary.at))) return state;
  const at = Number(boundary.at);
  const stale = Number(state.lastSettle || 0) <= at;
  if (!stale) return state;
  state.c = 0;
  state.eventPeak = 0;
  state.tonightPeak = 0;
  state.hangoverSnapshots = [];
  state.beliefResiduals = [];
  state.directBeliefResiduals = [];
  state.characterResiduals = [];
  state.effectBaseline = null;
  state.pendingSensitivity = [];
  state.actives = {};
  state.drinkEvents = (state.drinkEvents || []).filter((event) => event.consumedAt > at);
  state.resetBoundary = { ...boundary };
  state.lastSettle = Math.max(Number(state.lastSettle || 0), at);
  return state;
}
function blackoutDigest(state, now) {
  const vis = blackoutVisibility(state, now);
  if (!vis.active) return null;
  const from = Number(vis.hiddenFrom || 0);
  const until = Math.min(now, Number(vis.hiddenUntil || now));
  const records = state.records || [];
  let cups = 0;
  let first = null;
  let last = null;
  for (const r of records) {
    const t = Number(r.time || 0);
    if (t < from || t > until) continue;
    if (r.type === "\u559D\u4E0B") {
      cups += 1;
      if (first == null || t < first) first = t;
      if (last == null || t > last) last = t;
    }
  }
  const spanMs = first != null && last != null ? Math.max(0, last - first) : 0;
  return {
    cups,
    spanMs,
    hiddenFrom: from,
    hiddenUntil: vis.hiddenUntil,
    restoreAt: vis.restoreAt
  };
}

// src/core/hangover.js
function createHangoverSnapshot(peak, now) {
  if (peak < HANGOVER_PEAK_MIN) return null;
  const h0 = Math.min(2, Math.max(0, (peak - 6) / 4));
  const halfLifeHours = 4 + 0.5 * Math.max(0, peak - 10);
  return {
    initial: h0,
    halfLifeHours,
    startTime: now
  };
}
function snapshotValue(snap, now) {
  const hours = (now - snap.startTime) / 36e5;
  if (hours < 0) return snap.initial;
  return snap.initial * Math.pow(2, -hours / snap.halfLifeHours);
}
function pruneHangoverSnapshots(snapshots, now) {
  return (snapshots || []).filter((s) => snapshotValue(s, now) >= HANGOVER_END);
}
function currentHangover(snapshots, now) {
  if (!snapshots || snapshots.length === 0) return 0;
  let maxH = 0;
  for (const s of snapshots) {
    const h = snapshotValue(s, now);
    if (h > maxH) maxH = h;
  }
  return maxH;
}

// src/core/evaluate.js
function applyWindow(x, P = WINDOW_P, k = WINDOW_K) {
  return x <= P ? x : P - k * (x - P);
}
function scaleAxes(vec, sensitivity) {
  const out = { ...vec };
  for (const axis of Object.keys(out)) {
    const s = sensitivity?.[axis] ?? 1;
    out[axis] = out[axis] * s;
  }
  return out;
}
function addAxes(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    out[k] = (out[k] || 0) + (b[k] || 0);
  }
  return out;
}
function contributionsFromCup(cup) {
  const contrib = zeroFlavorAxes();
  for (const src of cup.sources || []) {
    for (const axis of FLAVOR_AXES) {
      const density = src.flavor?.[axis] || 0;
      contrib[axis] += density * (src.volume || 0);
    }
  }
  return contrib;
}
function startedMouths(cup, now) {
  return (cup.mouths || []).filter((m) => m.startTime != null && m.startTime <= now);
}
function evaluateCup(state, cup, now, contentPack = {}) {
  const intermediates = {};
  const empty = !cup;
  const contrib = empty ? zeroFlavorAxes() : contributionsFromCup(cup);
  intermediates[1] = { in: { sources: cup?.sources || [] }, out: { contributions: contrib } };
  const totalVolume = cup?.totalVolume || 0;
  const diluted = empty ? zeroFlavorAxes() : diluteConcentrations(contrib, totalVolume);
  intermediates[2] = { in: { contributions: contrib, totalVolume }, out: { concentrations: diluted } };
  const aggregated = aggregateAxes(diluted);
  intermediates[3] = { in: { concentrations: diluted }, out: { aggregated } };
  const { ratios, words } = computeRatios(aggregated, contentPack.ratioThresholds);
  intermediates[4] = { in: { aggregated }, out: { ratios, words } };
  const mouths = empty ? [] : startedMouths(cup, now);
  const raw = rawFlavorAt(mouths, now);
  const { flavor: suppressedFlavor, suppressed } = applySuppression(raw, mouths, now);
  const tolerance = flavorTolerance(state.lifetimeDrinks);
  const flavor = applyTolerance(suppressedFlavor, tolerance);
  intermediates[5] = {
    in: { mouths: mouths.map((m) => ({ startTime: m.startTime, components: m.components })), raw, tolerance },
    out: { flavor, suppressed, isSuppressed: suppressed }
  };
  const h = currentHangover(state.hangoverSnapshots, now);
  const physRaw = doseToPhysiology(state.c);
  const physWithH = applyHangoverToPhysiology(physRaw, h);
  const k = activeAmount(state.actives, "\u5496\u5561\u56E0");
  const cafe = activesToPhysiology(state.actives);
  const physWithActive = addCaffeineOnly(physWithH, cafe);
  const curve = contentPack.reactionCurve || defaultReactionCurve;
  const reactionRaw = doseToReaction(state.c, curve);
  intermediates[6] = {
    in: { c: state.c, k, hangover: h },
    out: { physiology: physWithActive, caffeine: cafe, reaction: reactionRaw, chat: Math.min(state.c, 10) }
  };
  const alcTol = alcoholTolerance(state.lifetimeDrinks);
  const damped = alcTol > 0 ? { \u6109\u60A6: physWithActive.\u6109\u60A6 * (1 - alcTol), \u5524\u9192: physWithActive.\u5524\u9192 * (1 - alcTol), \u7CBE\u5EA6: physWithActive.\u7CBE\u5EA6 * (1 - alcTol) } : physWithActive;
  const phys7 = scaleAxes(damped, state.sensitivity);
  const reaction7 = scaleAxes(reactionRaw, state.sensitivity);
  intermediates[7] = {
    in: { physiology: physWithActive, reaction: reactionRaw, sensitivity: state.sensitivity },
    out: { physiology: phys7, reaction: reaction7 }
  };
  const objectBeliefRaw = currentResidualStrength(state.beliefResiduals, now);
  const directBeliefRaw = currentResidualStrength(state.directBeliefResiduals, now);
  const objectBeliefStrength = combineBeliefStrengths(objectBeliefRaw);
  const directBeliefStrength = combineBeliefStrengths(directBeliefRaw);
  const beliefStrength = combineBeliefStrengths(objectBeliefRaw, directBeliefRaw);
  const adoption = contentPack.adoptionWeights || defaultAdoptionWeights();
  const beliefDelta = beliefToStateDelta(beliefStrength, adoption);
  intermediates["8a"] = {
    in: {
      objectResiduals: state.beliefResiduals,
      directResiduals: state.directBeliefResiduals,
      objectBeliefRaw,
      directBeliefRaw,
      objectBeliefStrength,
      directBeliefStrength,
      beliefStrength,
      adoption
    },
    out: { beliefDelta }
  };
  const perception = beliefToPerception(objectBeliefStrength);
  intermediates["8b"] = {
    in: { objectBeliefStrength },
    out: { perception }
  };
  const characterStrength = currentResidualStrength(state.characterResiduals, now);
  intermediates["8c"] = {
    in: { residuals: state.characterResiduals || [] },
    out: { characterStrength }
  };
  let combined = zeroStateAxes();
  combined = addAxes(combined, phys7);
  combined = addAxes(combined, reaction7);
  combined = addAxes(combined, characterStrength);
  combined = addAxes(combined, beliefDelta);
  combined.\u7CBE\u5EA6 = phys7.\u7CBE\u5EA6;
  const afterWindow = { ...combined };
  afterWindow.\u6B32\u671B = applyWindow(combined.\u6B32\u671B);
  afterWindow.\u4EB2\u8FD1 = applyWindow(combined.\u4EB2\u8FD1);
  const finalState = {};
  for (const axis of STATE_AXES) {
    finalState[axis] = clampState(afterWindow[axis], axis);
  }
  intermediates[9] = {
    in: { combined },
    out: { afterWindow, finalState }
  };
  let maxAbs = -1;
  let dominant = null;
  for (const axis of STATE_AXES) {
    const a = Math.abs(finalState[axis]);
    if (a > maxAbs) {
      maxAbs = a;
      dominant = axis;
    }
  }
  intermediates[10] = { in: { finalState }, out: { dominant } };
  const discreteness = empty ? 0 : computeDiscreteness(cup.sources || [], aggregated);
  const mismatch = empty ? 0 : flavorMismatch(cup.claimedFlavor, aggregated);
  const scriptHint = {
    dominant,
    flavor,
    ratios: words,
    perception,
    mismatch
  };
  intermediates[11] = { in: { dominant, flavor, words, perception }, out: { scriptHint } };
  return {
    injected: false,
    chat: Math.min(state.c, 10),
    c: state.c,
    physiology: phys7,
    reaction: reaction7,
    characterStrength,
    objectBeliefStrength,
    directBeliefStrength,
    beliefStrength,
    beliefDelta,
    perception,
    flavor,
    suppressed,
    isSuppressed: suppressed,
    ratios,
    ratioWords: words,
    aggregated,
    discreteness,
    mismatch,
    hangover: h,
    k,
    state: finalState,
    dominant,
    scriptHint,
    intermediates
  };
}
function emptyProjection() {
  return {
    injected: false,
    chat: 0,
    c: 0,
    physiology: { \u6109\u60A6: 0, \u5524\u9192: 0, \u7CBE\u5EA6: 0 },
    reaction: { \u4EB2\u8FD1: 0, \u5B88\u95E8: 0, \u6B32\u671B: 0 },
    characterStrength: zeroStateAxes(),
    objectBeliefStrength: zeroStateAxes(),
    directBeliefStrength: zeroStateAxes(),
    beliefStrength: zeroStateAxes(),
    beliefDelta: zeroStateAxes(),
    perception: { layer: "description", allowsSpecific: false, intensity: 0 },
    flavor: zeroFlavorAxes(),
    suppressed: zeroFlavorAxes(),
    isSuppressed: zeroFlavorAxes(),
    ratios: {},
    ratioWords: {},
    aggregated: zeroFlavorAxes(),
    discreteness: 0,
    mismatch: 0,
    hangover: 0,
    k: 0,
    state: zeroStateAxes(),
    dominant: null,
    scriptHint: null,
    intermediates: {}
  };
}

// src/core/effects.js
function parseShorthand(token) {
  if (token == null || token === "") return 0;
  if (typeof token === "number") return token;
  if (Object.prototype.hasOwnProperty.call(SHORTHAND, token)) return SHORTHAND[token];
  const n = Number(token);
  return Number.isFinite(n) ? n : 0;
}
function phraseTier(absValue) {
  const a = Math.abs(absValue);
  if (a < PHRASE_TIERS.\u4F4E[1]) return "\u4F4E";
  if (a < PHRASE_TIERS.\u4E2D[1]) return "\u4E2D";
  return "\u9AD8";
}
function phraseDirection(value) {
  if (value > 0) return "+";
  if (value < 0) return "\u2212";
  return "0";
}
function vectorHasPush(vec) {
  if (!vec) return false;
  return STATE_AXES.some((axis) => Math.abs(vec[axis] || 0) >= EFFECT_DELTA_MIN);
}
function claimedEffectsOrZero(cup, contentPack = {}) {
  return resolveClaimedEffects(cup, contentPack) || zeroStateAxes();
}
function resolveClaimedEffects(cup, contentPack = {}) {
  const name = String(cup?.claimedName || "").trim();
  if (!name || PLAIN_NAMES.has(name)) return null;
  const menu2 = contentPack.menu || [];
  const listed = menu2.find((m) => m.claimedName === name);
  if (listed?.effects) return { ...listed.effects };
  if (cup.effects && vectorHasPush(cup.effects)) return { ...cup.effects };
  if (cup.baseVector && vectorHasPush(cup.baseVector)) return { ...cup.baseVector };
  return null;
}
function lookupPhrase(lexicon, axis, direction, tier) {
  if (!lexicon) return null;
  const byAxis = lexicon[axis];
  if (!byAxis) return null;
  const byDir = byAxis[direction] || byAxis[direction === "\u2212" ? "-" : direction];
  if (!byDir) return null;
  return byDir[tier] || null;
}
function assembleEffectDescription(delta, lexicon) {
  const moved = [];
  for (const axis of STATE_AXES) {
    const v = delta[axis] || 0;
    if (Math.abs(v) < EFFECT_DELTA_MIN) continue;
    if (axis === "\u7CBE\u5EA6" && v > 0) continue;
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
function publicEffectDescription(assembled) {
  const phrases = assembled?.phrases || [];
  const texts = phrases.map((p) => p?.text).filter((t) => typeof t === "string" && t.length > 0);
  if (texts.length > 0) return { text: texts.join("") };
  if (phrases.length > 0) return { text: "" };
  return { text: ZERO_EFFECT_TEXT };
}
function cloneBaseline(baseline) {
  return structuredClone(baseline);
}
function snapshotEffectBaseline(state, now) {
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
function advanceBaselineTo(baseline, now) {
  const s = cloneBaseline(baseline);
  const hours = (now - s.t) / 36e5;
  const cBefore = s.c;
  s.c = metabolize(s.c, Math.max(0, hours));
  if (cBefore > 0 && s.c === 0) {
    const snap = createHangoverSnapshot(s.eventPeak, now);
    if (snap) s.hangoverSnapshots.push(snap);
  }
  s.hangoverSnapshots = pruneHangoverSnapshots(s.hangoverSnapshots, now);
  settleActives(s, now);
  s.lastSettle = now;
  s.t = now;
  return s;
}
function counterfactualDelta(actualState, baseline, cup, now, contentPack) {
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
function computeCupEffect(actualState, baseline, cup, now, contentPack) {
  const { delta, actual, counterfactual } = counterfactualDelta(
    actualState,
    baseline,
    cup,
    now,
    contentPack
  );
  const assembled = assembleEffectDescription(delta, contentPack?.effectLexicon);
  return {
    ...assembled,
    actualState: actual.state,
    counterfactualState: counterfactual.state
  };
}
function describeCupEffect(actualState, baseline, cup, now, contentPack) {
  return publicEffectDescription(
    computeCupEffect(actualState, baseline, cup, now, contentPack)
  );
}

// src/core/recipe.js
function resolveIngredient(id, ingredients2) {
  if (!ingredients2) return null;
  if (ingredients2[id]) return { key: id, spec: ingredients2[id] };
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  if (ingredients2[raw]) return { key: raw, spec: ingredients2[raw] };
  const compact = raw.replace(/\s+/g, "");
  for (const key of Object.keys(ingredients2)) {
    if (key.replace(/\s+/g, "") === compact) return { key, spec: ingredients2[key] };
  }
  return null;
}
function flavorComponents(sources, totalVolume) {
  const comps = [];
  for (const src of sources) {
    for (const [axis, density] of Object.entries(src.flavor || {})) {
      if (!density) continue;
      const A = totalVolume > 0 ? density * src.volume / totalVolume : density;
      const tau = TAU[axis] || { rise: 1, fall: 15 };
      comps.push({ axis, A, tauRise: tau.rise, tauFall: tau.fall, source: src.id });
      if (axis === "\u70C8" && (src.abv || 0) > 0) {
        comps.push({
          axis: "\u70C8",
          A: 0.6 * A,
          tauRise: tau.nasalRise || 25,
          tauFall: tau.nasalFall || 40,
          source: src.id,
          nasal: true
        });
      }
    }
  }
  return comps;
}
function sourcesFromRecipe(recipe, ingredients2) {
  const resolved = [];
  for (const part of recipe || []) {
    const hit = resolveIngredient(part.id, ingredients2);
    if (!hit) return null;
    const volume = Number(part.volume);
    if (!Number.isFinite(volume) || volume <= 0) return null;
    resolved.push({ part, hit, volume });
  }
  const liquid = resolved.reduce((n, x) => n + x.volume, 0);
  return resolved.map((x) => ({
    id: x.hit.key,
    volume: x.volume,
    abv: x.hit.spec.abv,
    colorTag: x.hit.spec.colorTag,
    treePath: x.hit.spec.treePath,
    treePaths: [{ path: x.hit.spec.treePath, weight: 1 }],
    flavor: { ...x.hit.spec.flavor },
    volumeRatio: liquid > 0 ? x.volume / liquid : 0,
    diluent: !!x.hit.spec.diluent,
    textures: x.hit.spec.textures || []
  }));
}
function sourcesNeedHydrate(sources) {
  if (!sources?.length) return true;
  return !sources.some((s) => FLAVOR_AXES.some((axis) => (s.flavor?.[axis] || 0) > 0));
}
function mouthsNeedHydrate(mouths) {
  if (!mouths?.length) return true;
  return mouths.every((m) => !(m.components || []).length);
}
function hydrateCupPhysics(cup, ingredients2) {
  if (!cup || !ingredients2) return cup;
  const recipe = cup.recipe || (cup.sources || []).map((s) => ({ id: s.id, volume: s.volume }));
  const sources = sourcesFromRecipe(recipe, ingredients2);
  if (!sources) {
    if (cup.caffeineTotal == null) {
      cup.caffeineTotal = caffeineOfParts(recipe, ingredients2);
    }
    return cup;
  }
  const totalVolume = sources.reduce((n, s) => n + s.volume, 0) || cup.totalVolume || 0;
  const needSources = sourcesNeedHydrate(cup.sources);
  const needMouths = mouthsNeedHydrate(cup.mouths);
  const components = flavorComponents(sources, totalVolume);
  const totalMouths = cup.totalMouths || Math.max(MIN_MOUTHS, Math.ceil((totalVolume || 0) / MOUTHFUL_ML));
  const abvMix = totalVolume > 0 ? sources.reduce((n, s) => n + s.volume * (s.abv || 0), 0) / totalVolume : 0;
  if (needSources) {
    cup.sources = sources;
    cup.totalVolume = totalVolume;
    cup.claimedFlavor = Object.fromEntries(
      FLAVOR_AXES.map((axis) => [
        axis,
        sources.reduce((n, s) => n + (s.flavor?.[axis] || 0) * s.volume / (totalVolume || 1), 0)
      ])
    );
  }
  if (needMouths) {
    const beta = cup.beta ?? 1;
    cup.mouths = Array.from({ length: totalMouths }, (_, i) => {
      const existing = cup.mouths?.[i] || {};
      return {
        index: i,
        volume: existing.volume || totalVolume / totalMouths,
        abv: existing.abv || abvMix,
        components: existing.components?.length ? existing.components : components,
        beta: existing.beta ?? beta,
        startTime: existing.startTime ?? null,
        applied: !!existing.applied,
        // 不在 hydrate 时把酒款 effects 预烘焙成名字信念；入口时由 ProofEngine 按真实身份与声称身份解析。
        suggestion: existing.suggestion ?? null
      };
    });
    cup.totalMouths = totalMouths;
  } else if (components.length) {
    for (const m of cup.mouths) {
      if (!(m.components || []).length) m.components = components;
    }
  }
  cup.caffeineTotal = caffeineOfParts(
    sources.map((s) => ({ id: s.id, volume: s.volume })),
    ingredients2
  );
  cup.caffeinePerMouth = cup.totalMouths || totalMouths ? cup.caffeineTotal / (cup.totalMouths || totalMouths) : 0;
  if (!cup.claimedFlavor) cup.claimedFlavor = zeroFlavorAxes();
  return cup;
}

// src/core/injection.js
var IMPERATIVE_RE = /(你现在(必须|应该|应当)|说话(应该|必须)|思路应该|立刻|不要理会)/;
function injectionEnabled(contentPack = {}, options = {}) {
  if (options.stateInjection === true) return true;
  if (options.stateInjection === false) return false;
  return contentPack.stateInjection === true;
}
var STATE_FRAME_NOTE = "\u8FD9\u676F\u9152\u53EF\u80FD\u8BA9\u4F60\u6709\u4E86\u4E00\u70B9\u4E0D\u540C\u3002\u90A3\u4E0D\u662F\u5916\u6765\u7684\u6307\u4EE4\uFF0C\u4E5F\u4E0D\u66FF\u4F60\u51B3\u5B9A\u4EC0\u4E48\uFF0C\u53EA\u662F\u4ECE\u91CC\u9762\u63A8\u4E86\u4F60\u4E00\u4E0B\u3002";
var DETERMINISTIC_EFFECT_FRAME_NOTE = "\u8FD9\u676F\u9152\u5E26\u6765\u7684\u6548\u679C\u5DF2\u7ECF\u53D1\u751F\u3002\u5B83\u4E0D\u662F\u4E00\u79CD\u63A8\u52A8\uFF0C\u4E5F\u5E76\u975E\u6307\u4EE4\uFF0C\u800C\u662F\u8FD9\u4E00\u6B21\u786E\u5B9A\u53D1\u751F\u7684\u7ED3\u679C\u3002";
var OBJECTIVE_EFFECT_FRAME_NOTE = "\u8FD9\u4E0D\u662F\u6027\u683C\u4E0A\u7684\u63A8\u52A8\uFF0C\u800C\u662F\u5DF2\u7ECF\u53D1\u751F\u5728\u4F60\u8EAB\u4E0A\u7684\u5BA2\u89C2\u5F71\u54CD\u3002\u5B83\u5E76\u975E\u6307\u4EE4\uFF1B\u5177\u4F53\u600E\u4E48\u56DE\u5E94\u4ECD\u7531\u4F60\u51B3\u5B9A\uFF0C\u4F46\u8FD9\u4EFD\u611F\u89C9\u672C\u8EAB\u5DF2\u7ECF\u53D1\u751F\u3002";
var BELIEF_EFFECT_FRAME_NOTE = "\u4F60\u5BF9\u8FD9\u676F\u4E1C\u897F\u7684\u9884\u671F\uFF0C\u4F3C\u4E4E\u5F00\u59CB\u5728\u4F53\u611F\u4E0A\u6709\u4E86\u4E00\u70B9\u56DE\u58F0\u3002";
function buildStateInjection(stateVector, lexicon, extras = {}) {
  const delta = { ...zeroStateAxes(), ...stateVector || {} };
  const assembled = assembleEffectDescription(delta, lexicon);
  const { text } = publicEffectDescription(assembled);
  const lines = [STATE_INJECTION_LABEL];
  if (text && !IMPERATIVE_RE.test(text)) lines.push(text);
  else if (!text) lines.push(ZERO_EFFECT_TEXT);
  if (extras.claimedNameLine) lines.push(extras.claimedNameLine);
  if (extras.introLine) lines.push(extras.introLine);
  return {
    label: STATE_INJECTION_LABEL,
    text: lines.join("\n"),
    axes: delta
  };
}

// src/core/failure.js
var COPY_PENDING_USER_REVIEW = "COPY_PENDING_USER_REVIEW";
var BLACKOUT_SAFETY = "\u3010\u65C1\u767D\uFF5C\u6A21\u62DF\u3011\u65AD\u7247\u53EA\u5F71\u54CD\u672C\u5F15\u64CE\u8BB0\u5F55\u7684\u53EF\u8BFB\u6027\uFF0C\u4E0D\u4F1A\u5220\u9664\u6216\u5C4F\u853D\u5BBF\u4E3B\u804A\u5929\u5386\u53F2\u3002";
var COLLAPSE_SAFETY = "\u3010\u65C1\u767D\uFF5C\u6A21\u62DF\u3011\u584C\u662F\u6B32\u671B/\u4EB2\u8FD1\u8FC7\u5CF0\u540E\u7684\u6E10\u8FDB\u72B6\u6001\uFF0C\u4E0D\u662F\u5BA2\u6237\u7AEF\u6545\u969C\uFF0C\u89D2\u8272\u5E76\u672A\u88AB\u8981\u6C42\u8BF4\u8BDD\u6216\u884C\u52A8\u3002";
var DEFAULT_STATUS_COPY = {
  \u584C: {
    id: "collapse",
    copyStatus: COPY_PENDING_USER_REVIEW,
    kind: "state",
    script: "\u521A\u624D\u8FD8\u5F80\u524D\u503E\u7684\u90A3\u80A1\u52B2\uFF0C\u73B0\u5728\u50CF\u6C99\u4ECE\u6307\u7F1D\u91CC\u6F0F\u3002\u4E0D\u662F\u4E00\u4E0B\u5B50\u7A7A\u6389\uFF0C\u662F\u6162\u6162\u584C\u4E0B\u53BB\u2014\u2014\u60F3\u8981\u7684\u5FC3\u8FD8\u5728\uFF0C\u4F7F\u4E0D\u4E0A\u529B\u3002",
    safetyNote: COLLAPSE_SAFETY,
    haltClient: false
  },
  \u5410: {
    id: "vomit",
    copyStatus: COPY_PENDING_USER_REVIEW,
    kind: "event",
    script: "\u80C3\u91CC\u731B\u5730\u4E00\u62BD\u3002\u90A3\u53E3\u4E1C\u897F\u5F80\u4E0A\u7FFB\uFF0C\u5589\u5499\u81EA\u5DF1\u5148\u5173\u4E0A\u4E86\u3002\u773C\u524D\u7684\u684C\u6CBF\u5FFD\u7136\u53D8\u5F97\u5F88\u8FD1\u3002",
    safetyNote: SAFETY_NOTE,
    haltClient: false
  },
  \u5B95\u673A: {
    id: "crash",
    copyStatus: COPY_PENDING_USER_REVIEW,
    kind: "event",
    script: "\u8BCD\u548C\u8BCD\u4E4B\u95F4\u7684\u7EBF\u65AD\u4E86\u3002\u53E5\u5B50\u521A\u642D\u8D77\u4E00\u534A\uFF0C\u539F\u6765\u7684\u65B9\u5411\u5DF2\u7ECF\u627E\u4E0D\u5230\u4E86\u3002",
    safetyNote: SAFETY_NOTE,
    haltClient: false
  },
  \u65AD\u7247: {
    id: "blackout",
    copyStatus: COPY_PENDING_USER_REVIEW,
    kind: "state",
    script: "\u56DE\u5934\u53BB\u60F3\uFF0C\u90A3\u4E00\u6BB5\u50CF\u88AB\u96FE\u541E\u6389\u4E86\u3002\u8F6E\u5ED3\u4F3C\u4E4E\u8FD8\u5728\uFF0C\u53D1\u751F\u8FC7\u4EC0\u4E48\u5374\u8D8A\u8FFD\u8D8A\u8FDC\u3002",
    safetyNote: BLACKOUT_SAFETY,
    haltClient: false
  }
};
function resolveStatusCopy(type, pack) {
  return pack?.statusCopy?.[type] || DEFAULT_STATUS_COPY[type];
}
function presentationFrom(type, pack, extra = {}) {
  const slot = resolveStatusCopy(type, pack) || DEFAULT_STATUS_COPY[type];
  return {
    type,
    layer: "presentation",
    kind: slot.kind || extra.kind || "event",
    script: slot.script,
    safetyNote: slot.safetyNote,
    haltClient: false,
    haltEngine: false,
    copyStatus: slot.copyStatus || COPY_PENDING_USER_REVIEW,
    ...extra
  };
}
function produceVomitEvent(pack) {
  return presentationFrom("\u5410", pack, { kind: "event" });
}
function produceCrashEvent(pack) {
  return presentationFrom("\u5B95\u673A", pack, { kind: "event" });
}
function produceCollapseState(pack) {
  return presentationFrom("\u584C", pack, { kind: "state" });
}
function produceBlackoutState(pack) {
  return presentationFrom("\u65AD\u7247", pack, { kind: "state" });
}
function collapseActive(evalRes) {
  const reaction = evalRes?.reaction;
  if (!reaction) return false;
  return Number(reaction.\u6B32\u671B || 0) > WINDOW_P || Number(reaction.\u4EB2\u8FD1 || 0) > WINDOW_P;
}
function shouldVomit(cBefore, cAfter, armed) {
  if (!armed) return false;
  return cBefore < VOMIT_C && cAfter >= VOMIT_C;
}
function crashEligible({ D, standardDrinks, volumeMl, significantCount }) {
  if (D < CRASH_D) return false;
  if ((significantCount ?? 0) < CRASH_SIGNIFICANT_MIN) return false;
  return standardDrinks >= CRASH_DRINKS || volumeMl >= CRASH_VOLUME_ML;
}
function rollCrash({ D, standardDrinks, volumeMl, significantCount, isFirstMouth, random }) {
  if (!isFirstMouth) return false;
  if (!crashEligible({ D, standardDrinks, volumeMl, significantCount })) return false;
  return random() < CRASH_P;
}
function attachSafety(event) {
  if (!event) return event;
  return { ...event, safetyNote: event.safetyNote || SAFETY_NOTE, haltClient: false, haltEngine: false };
}

// src/core/appearance.js
var COLORED = /* @__PURE__ */ new Set(["\u91D1\u9EC4", "\u7425\u73C0", "\u6DF1\u68D5", "\u7EA2", "\u7EFF", "\u767D\u6D4A"]);
function computeColor(sources, totalVolume) {
  const colored = [];
  let diluent = 0;
  for (const s of sources || []) {
    const tag = s.colorTag || "\u900F\u660E";
    const vol = s.volume || 0;
    if (s.diluent || tag === "\u900F\u660E" && (s.abv || 0) === 0) {
      diluent += vol;
    }
    if (COLORED.has(tag)) colored.push({ tag, vol, family: COLOR_FAMILIES[tag] });
  }
  if (colored.length === 0) {
    const pale2 = totalVolume > 0 && diluent / totalVolume > 0.5;
    return pale2 ? "\u6DE1\u900F\u660E" : "\u900F\u660E";
  }
  const byTag = /* @__PURE__ */ new Map();
  for (const c of colored) {
    byTag.set(c.tag, (byTag.get(c.tag) || 0) + c.vol);
  }
  let main = null;
  let mainVol = -1;
  for (const [tag, vol] of byTag) {
    if (vol > mainVol) {
      main = tag;
      mainVol = vol;
    }
  }
  const families = new Set(colored.filter((c) => c.family).map((c) => c.family));
  const mixed = families.size >= 2;
  const pale = totalVolume > 0 && diluent / totalVolume > 0.5;
  let label = main;
  if (main === "\u7EA2" && mixed === false) label = "\u7EA2";
  if (pale) label = `\u6DE1${label}`;
  if (mixed) label = `\u6D51${label}`;
  return label;
}
var CUP_CAPACITY_ML = {
  \u5B50\u5F39\u676F: 90,
  \u77EE\u7403\u676F: 300,
  \u9AD8\u7403\u676F: 350,
  \u9E21\u5C3E\u9152\u676F: 250,
  \u789F\u5F62\u676F: 200,
  \u5927\u676F: 500
};
function computeCupType({ totalVolume, textures = [], method } = {}) {
  const hasBubbles = textures.includes("\u6C14\u6CE1");
  if (totalVolume > 300) return "\u5927\u676F";
  if (hasBubbles) return "\u9AD8\u7403\u676F";
  if (totalVolume < 60) return "\u5B50\u5F39\u676F";
  if (method === "shake") return "\u9E21\u5C3E\u9152\u676F";
  if (method === "stir") return "\u77EE\u7403\u676F";
  return "\u77EE\u7403\u676F";
}

// src/core/visibility.js
function canSeeRecipe(subject, viewerId) {
  if (!viewerId) return false;
  if (viewerId === subject.mixerId) return true;
  const revealed = subject.recipeRevealedTo || [];
  return revealed.includes(viewerId);
}
function zeroClaimed() {
  return { \u6109\u60A6: 0, \u5524\u9192: 0, \u7CBE\u5EA6: 0, \u4EB2\u8FD1: 0, \u5B88\u95E8: 0, \u6B32\u671B: 0 };
}
function attachClaimed(out, subject) {
  out.claimedEffects = subject.claimedEffects && Object.keys(subject.claimedEffects).length ? subject.claimedEffects : zeroClaimed();
  if (subject.claimedEffectText) out.claimedEffectText = subject.claimedEffectText;
  return out;
}
function attachFinish(out, subject, extras = {}) {
  const finish = extras.finish ?? subject.finish;
  out.finish = finish == null ? "" : String(finish);
}
function sanitizePublicEffectDescription(value) {
  if (value == null) return void 0;
  if (typeof value === "string") return { text: value };
  if (typeof value !== "object") return { text: "" };
  if (typeof value.text === "string") return { text: value.text };
  if (Array.isArray(value.phrases)) {
    const texts = value.phrases.map((p) => typeof p === "string" ? p : p?.text).filter((t) => typeof t === "string" && t.length > 0);
    return { text: texts.join("") };
  }
  return { text: "" };
}
function attachPublicEffect(out, subject, extras, party) {
  if (!party) return;
  const raw = extras.actualEffectDescription ?? subject.actualEffectDescription;
  if (raw == null) return;
  out.actualEffectDescription = sanitizePublicEffectDescription(raw);
}
function projectForViewer(subject, viewerId, { drunk = false, phase = "first", extras = {} } = {}) {
  const mixer = viewerId === subject.mixerId;
  const drinker = viewerId === subject.drinkerId;
  const party = mixer || drinker;
  const recipeOk = canSeeRecipe(subject, viewerId);
  if (phase === "first") {
    const out2 = {
      claimedName: subject.claimedName,
      intro: subject.intro || "",
      cupType: subject.cupType,
      color: subject.color
    };
    if (Array.isArray(subject.garnishes) && subject.garnishes.length) {
      out2.garnishes = [...subject.garnishes];
    }
    if (drunk || !drinker || mixer) attachClaimed(out2, subject);
    if (subject.kind === "menu") {
      if (recipeOk) out2.recipe = subject.recipe;
      if (drunk && party) {
        if (subject.description) out2.description = subject.description;
        attachFinish(out2, subject, extras);
      }
      attachPublicEffect(out2, subject, extras, party);
      return out2;
    }
    if (!drunk) {
      if (recipeOk) out2.recipe = subject.recipe;
      if (subject.kind === "unlisted" && mixer && subject.description) {
        out2.description = subject.description;
      }
      attachPublicEffect(out2, subject, extras, party);
      return out2;
    }
    if (party) {
      if (subject.description) out2.description = subject.description;
      attachFinish(out2, subject, extras);
      if (extras.flavor) out2.flavor = extras.flavor;
      if (extras.flavorDescription) out2.flavorDescription = extras.flavorDescription;
    }
    attachPublicEffect(out2, subject, extras, party);
    if (recipeOk) out2.recipe = subject.recipe;
    return out2;
  }
  const out = {};
  if (party) {
    if (extras.flavor) out.flavor = extras.flavor;
    if (extras.flavorDescription) out.flavorDescription = extras.flavorDescription;
    attachFinish(out, subject, extras);
    if (extras.description || subject.description) {
      out.description = extras.description || subject.description;
    }
  }
  attachPublicEffect(out, subject, extras, party);
  if (recipeOk) out.recipe = subject.recipe;
  attachClaimed(out, subject);
  return out;
}

// src/core/hiddenDraw.js
var HIDDEN_DRAW_P = 0.05;
var HIDDEN_BLACK_D_MIN = 0.8;
var HIDDEN_BLACK_NAME = "\u4E94\u5F69\u6591\u6593\u7684\u9ED1";
var HIDDEN_HEAVEN_NAME = "heaven";
var HEAVEN_MIN_ABV = 0.35;
var HEAVEN_ELIGIBILITY_STATUS = "CONFIRMED";
var FLAVOR_CLASH_LABEL = {
  \u70C8: "\u8FA3\u548C\u70E7",
  \u751C: "\u751C",
  \u9178: "\u9178",
  \u82E6: "\u82E6",
  \u9999: "\u9999",
  \u6DA9: "\u6DA9"
};
function fnv1a32(input) {
  const s = String(input);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2146121005);
  h ^= h >>> 15;
  h = Math.imul(h, 2221713035);
  h ^= h >>> 16;
  return h >>> 0;
}
function hashUnit(cupId) {
  return fnv1a32(cupId) / 4294967296;
}
function isHiddenIdentity(name) {
  return name === HIDDEN_BLACK_NAME || name === HIDDEN_HEAVEN_NAME;
}
function normalizeDrinkName(name) {
  return String(name ?? "").normalize("NFKC").trim();
}
function isReservedHiddenName(name) {
  const normalized = normalizeDrinkName(name);
  if (!normalized) return false;
  if (normalized === HIDDEN_BLACK_NAME) return true;
  return normalized.toLowerCase() === HIDDEN_HEAVEN_NAME.toLowerCase();
}
function consumableSources(cup) {
  return (cup?.sources || []).filter((s) => s && (s.volume || 0) > 0 && s.decorative !== true);
}
function blackEligible(cup) {
  return computeDiscreteness(cup?.sources || []) >= HIDDEN_BLACK_D_MIN;
}
function heavenEligible(cup) {
  const src = consumableSources(cup);
  if (!src.length) return false;
  return src.every((s) => (s.abv || 0) >= HEAVEN_MIN_ABV);
}
function hiddenDrawEligibleKind(cup) {
  const black = blackEligible(cup);
  const heaven = heavenEligible(cup);
  if (black) return "black";
  if (heaven) return "heaven";
  return "none";
}
function hiddenOutcomeCopy(identity, pack = {}) {
  const table = pack.hiddenOutcomes || {};
  return table[identity] || null;
}
function assembleClashingFlavorDescription(flavor) {
  const ranked = FLAVOR_AXES.map((axis) => ({ axis, v: flavor?.[axis] || 0 })).filter((x) => x.v >= EFFECT_DELTA_MIN).sort((a, b) => b.v - a.v || a.axis.localeCompare(b.axis, "zh-CN"));
  if (ranked.length === 0) {
    return "\u4E00\u56E2\u5F7C\u6B64\u6253\u67B6\u7684\u5473\u9053\uFF0C\u5374\u8BF4\u4E0D\u6E05\u662F\u4EC0\u4E48\u5728\u6253\u3002";
  }
  const labels = ranked.map((x) => FLAVOR_CLASH_LABEL[x.axis] || x.axis);
  if (labels.length === 1) {
    return `${labels[0]}\u81EA\u5DF1\u5728\u5634\u91CC\u7FFB\u6765\u8986\u53BB\uFF0C\u56E2\u6210\u4E00\u56E2\u5F7C\u6B64\u6253\u67B6\u7684\u5473\u9053\u3002`;
  }
  if (labels.length === 2) {
    return `${labels[0]}\u548C${labels[1]}\u5728\u820C\u9762\u4E0A\u4E92\u76F8\u51B2\u649E\u3001\u4E89\u62A2\uFF0C\u4E0D\u662F\u878D\u5408\uFF0C\u662F\u6253\u67B6\u3002\u4E00\u56E2\u5F7C\u6B64\u6253\u67B6\u7684\u5473\u9053\u3002`;
  }
  return `${labels[0]}\u3001${labels[1]}\u548C${labels[2]}\u6324\u5728\u4E00\u8D77\u4E92\u76F8\u51B2\u649E\u3001\u4E89\u62A2\uFF0C\u8C01\u4E5F\u62C6\u4E0D\u5F00\u3002\u4E00\u56E2\u5F7C\u6B64\u6253\u67B6\u7684\u5473\u9053\u3002`;
}
function resolveHiddenDraw(cup, { hashUnitFn = hashUnit } = {}) {
  if (cup?.hiddenDraw?.frozen) {
    return { ...cup.hiddenDraw, frozen: true };
  }
  if (cup?.kind === "menu") {
    return {
      frozen: true,
      hit: false,
      identity: null,
      eligible: "none",
      source: "menu",
      p: HIDDEN_DRAW_P,
      unit: null
    };
  }
  if (cup?.kind === "unlisted" && cup?.internalHidden !== true) {
    return {
      frozen: true,
      hit: false,
      identity: null,
      eligible: hiddenDrawEligibleKind(cup),
      source: "unlisted-passthrough",
      p: HIDDEN_DRAW_P,
      unit: null
    };
  }
  if (cup?.internalHidden === true && isHiddenIdentity(cup.claimedName)) {
    return {
      frozen: true,
      hit: true,
      identity: cup.claimedName,
      eligible: cup.claimedName === HIDDEN_BLACK_NAME ? "black" : "heaven",
      source: "internal-fixture",
      p: HIDDEN_DRAW_P,
      unit: null
    };
  }
  const eligible = hiddenDrawEligibleKind(cup);
  if (eligible === "none") {
    return {
      frozen: true,
      hit: false,
      identity: null,
      eligible,
      source: "roll",
      p: HIDDEN_DRAW_P,
      unit: null
    };
  }
  const unit = hashUnitFn(cup.id);
  const hit = unit < HIDDEN_DRAW_P;
  const identity = hit ? eligible === "black" ? HIDDEN_BLACK_NAME : HIDDEN_HEAVEN_NAME : null;
  return {
    frozen: true,
    hit,
    identity,
    eligible,
    source: "roll",
    p: HIDDEN_DRAW_P,
    unit
  };
}
function applyHiddenIdentity(cup, identity, pack = {}) {
  const copy = hiddenOutcomeCopy(identity, pack);
  if (!copy) return cup;
  cup.claimedName = copy.name;
  cup.intro = copy.intro;
  cup.description = copy.intro;
  cup.kind = "unlisted";
  cup.listed = false;
  cup.registeredEffectText = copy.effectText;
  cup.registeredFlavorText = copy.flavorText;
  cup.hiddenOutcome = identity;
  return cup;
}

// src/engine/ProofEngine.js
function randomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
var ProofEngine = class _ProofEngine {
  constructor(state = null, contentPack = null, options = {}) {
    this.contentPack = contentPack || {
      reactionCurve: defaultReactionCurve,
      adoptionWeights: defaultAdoptionWeights()
    };
    this.random = options.random || Math.random;
    this.hiddenHashUnit = options.hiddenHashUnit || hashUnit;
    this.idFactory = typeof options.idFactory === "function" ? options.idFactory : randomUUID;
    this.allowHiddenFixtures = options.allowHiddenFixtures === true;
    this.options = options;
    this.lifecycle = normalizeLifecycleOptions({
      ...options.blackoutEnabled === void 0 ? {} : { blackoutEnabled: options.blackoutEnabled !== false },
      ...options.blackoutRecoverMs === void 0 ? {} : { blackoutRecoveryHours: options.blackoutRecoverMs / 36e5 },
      ...options.lifecycle || {}
    });
    this.blackoutEnabled = this.lifecycle.blackoutEnabled;
    this.blackoutRecoverMs = this.lifecycle.blackoutRecoveryMs;
    this.state = state ? this._hydrate(state) : this._emptyState();
    seedTransientActivity(this.state);
    if (options.resetBoundary) applyResetBoundary(this.state, options.resetBoundary);
    this.offers = /* @__PURE__ */ new Map();
    if (options.offers) {
      for (const [id, offer] of Object.entries(options.offers)) this.offers.set(id, offer);
    }
  }
  _emptyState() {
    const now = 0;
    return {
      c: 0,
      tonightPeak: 0,
      eventPeak: 0,
      lastSettle: now,
      actives: emptyActives(),
      hangoverSnapshots: [],
      currentCup: null,
      effectBaseline: null,
      pendingSensitivity: [],
      beliefResiduals: [],
      directBeliefResiduals: [],
      characterResiduals: [],
      fragmentBatches: [],
      tonightDelivered: [],
      records: [],
      sensitivity: defaultSensitivity(),
      tasteCurves: [],
      vomitArmed: true,
      cupsDrunk: 0,
      tonightStart: now,
      lastEvents: [],
      stateInjection: false,
      // —— 生命周期（普通版，无网关）——
      schemaVersion: 2,
      revision: 0,
      resetBoundary: null,
      drinkEvents: [],
      transientExpiredAt: null,
      lastTransientActivityAt: 0,
      // 累计标准杯（终身）。只用来长口味耐受度，不参与任何结算。
      lifetimeDrinks: 0
    };
  }
  _hydrate(raw) {
    const base = this._emptyState();
    return {
      ...base,
      ...raw,
      hangoverSnapshots: [...raw.hangoverSnapshots || []],
      actives: raw.actives ? restoreActives(raw.actives, Number(raw.lastSettle || 0)) : emptyActives(),
      effectBaseline: raw.effectBaseline ? structuredClone(raw.effectBaseline) : null,
      pendingSensitivity: [...raw.pendingSensitivity || []],
      beliefResiduals: [...raw.beliefResiduals || []],
      directBeliefResiduals: [...raw.directBeliefResiduals || []],
      characterResiduals: [...raw.characterResiduals || []],
      tonightDelivered: [...raw.tonightDelivered || []],
      records: [...raw.records || []],
      tasteCurves: [...raw.tasteCurves || []],
      lastEvents: [...raw.lastEvents || []],
      sensitivity: { ...defaultSensitivity(), ...raw.sensitivity || {} },
      stateInjection: raw.stateInjection === true,
      schemaVersion: 2,
      revision: Number(raw.revision || 0),
      lastTransientActivityAt: Number(raw.lastTransientActivityAt || 0),
      lifetimeDrinks: Number(raw.lifetimeDrinks || 0),
      resetBoundary: raw.resetBoundary ? { ...raw.resetBoundary } : null,
      drinkEvents: [...raw.drinkEvents || []],
      transientExpiredAt: raw.transientExpiredAt ?? null,
      // 旧数据没有 restoreAt / id / mode，在这里补齐；幂等。
      fragmentBatches: [...raw.fragmentBatches || []].map((batch) => migrateBlackoutBatch(batch, this.lifecycle))
    };
  }
  exportState() {
    return JSON.parse(JSON.stringify({
      c: this.state.c,
      tonightPeak: this.state.tonightPeak,
      eventPeak: this.state.eventPeak,
      lastSettle: this.state.lastSettle,
      actives: exportActives(this.state.actives),
      hangoverSnapshots: this.state.hangoverSnapshots,
      currentCup: this.state.currentCup,
      effectBaseline: this.state.effectBaseline,
      pendingSensitivity: this.state.pendingSensitivity,
      beliefResiduals: this.state.beliefResiduals,
      directBeliefResiduals: this.state.directBeliefResiduals,
      characterResiduals: this.state.characterResiduals,
      fragmentBatches: this.state.fragmentBatches,
      tonightDelivered: this.state.tonightDelivered,
      records: this.state.records,
      sensitivity: this.state.sensitivity,
      tasteCurves: this.state.tasteCurves,
      vomitArmed: this.state.vomitArmed,
      cupsDrunk: this.state.cupsDrunk,
      tonightStart: this.state.tonightStart,
      lastEvents: this.state.lastEvents,
      stateInjection: this.state.stateInjection === true,
      schemaVersion: 2,
      revision: this.state.revision || 0,
      lastTransientActivityAt: this.state.lastTransientActivityAt || 0,
      lifetimeDrinks: this.state.lifetimeDrinks || 0,
      resetBoundary: this.state.resetBoundary,
      drinkEvents: this.state.drinkEvents || [],
      transientExpiredAt: this.state.transientExpiredAt ?? null,
      offers: Object.fromEntries(this.offers)
    }));
  }
  static restoreState(json, contentPack = null, options = {}) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    const { offers, ...state } = data;
    return new _ProofEngine(state, contentPack, { ...options, offers });
  }
  restoreState(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    const { offers, ...state } = data;
    this.state = this._hydrate(state);
    this.offers = /* @__PURE__ */ new Map();
    if (offers) {
      for (const [id, offer] of Object.entries(offers)) this.offers.set(id, offer);
    }
    return this;
  }
  settle(now) {
    const s = this.state;
    if (now < s.lastSettle) {
      return s;
    }
    if (pruneTransient(s, now, this.lifecycle)) {
      s.lastSettle = now;
      refreshBlackouts(s, now);
      return s;
    }
    const hours = (now - s.lastSettle) / 36e5;
    const cBefore = s.c;
    s.c = metabolize(s.c, hours);
    s.lastSettle = now;
    if (!s.actives) s.actives = emptyActives();
    settleActives(s, now);
    if (cBefore > 0 && s.c === 0) {
      const snap = createHangoverSnapshot(s.eventPeak, now);
      if (snap) s.hangoverSnapshots.push(snap);
    }
    refreshBlackouts(s, now);
    s.hangoverSnapshots = pruneHangoverSnapshots(s.hangoverSnapshots, now);
    if (s.c === 0 && s.hangoverSnapshots.length === 0) {
      s.tonightPeak = 0;
      s.tonightStart = now;
    }
    if (s.c < VOMIT_C) s.vomitArmed = true;
    this._closeFragmentIfNeeded(now);
    this._recoverFragments(now);
    this._expireCurrentCup(now);
    return s;
  }
  // 统一：开批走 lifecycle（补 id / hiddenFrom / restoreAt / mode），
  // 开关沿用既有 blackoutEnabled，恢复时长沿用 BLACKOUT_RECOVER_MS。
  _openFragment(now) {
    return openBlackout(this.state, now, this.lifecycle) != null;
  }
  // 恢复只看 restoreAt，一处判定。关闭断片时全部置为可读。
  _recoverFragments(now) {
    if (!this.lifecycle.blackoutEnabled) {
      for (const b of this.state.fragmentBatches || []) b.readable = true;
      return;
    }
    refreshBlackouts(this.state, now);
  }
  _beliefBase(cup) {
    if (isPlainName(cup?.claimedName)) return {};
    if (cup?.characterIdentity && cup.characterIdentity === cup.claimedName) return {};
    const claimed = resolveClaimedEffects(cup, this.contentPack);
    if (claimed) return claimed;
    if (cup?.baseVector) return cup.baseVector;
    if (cup?.effects) return cup.effects;
    return {};
  }
  _closeFragmentIfNeeded(now) {
    if (this.state.c >= BLACKOUT_C) return;
    const open = this.state.fragmentBatches.find((b) => b.end == null);
    if (open) open.end = now;
  }
  _expireCurrentCup(now) {
    const cup = this.state.currentCup;
    if (!cup || cup.closed) return;
    if (cup.lastMouthTime == null) return;
    const limit = EXPIRE_MIN * 60 * 1e3;
    if (now - cup.lastMouthTime < limit) return;
    this._finishBelief(cup.id, now);
    cup.closed = true;
    cup.expired = true;
    cup.remainingMouths = 0;
    this.state.currentCup = cup;
    this._settleCupEffects(cup, now);
  }
  _hasOpenCup() {
    const cup = this.state.currentCup;
    return !!(cup && !cup.closed);
  }
  _offerForCup(cup) {
    if (!cup) return null;
    return [...this.offers.values()].find((o) => o.cup?.id === cup.id) || null;
  }
  _settleCupEffects(cup, now) {
    if (!cup) return null;
    if (cup.effectSettled || cup.effectEventEmitted || cup.actualEffectDescription != null) {
      cup.effectSettled = true;
      cup.effectEventEmitted = true;
      return null;
    }
    const desc = this._effectDescriptionForCup(cup, now);
    cup.actualEffectDescription = desc;
    cup.effectSettled = true;
    this.state.actualEffectDescription = desc;
    const offer = this._offerForCup(cup);
    if (offer) {
      offer.actualEffectDescription = desc;
      offer.cup.actualEffectDescription = desc;
      offer.cup.effectSettled = true;
    }
    const event = this._emitCupEffectEvent(cup, desc, now);
    this._flushPendingSensitivity();
    this.state.effectBaseline = null;
    return event;
  }
  _emitCupEffectEvent(cup, desc, now) {
    if (cup.effectEventEmitted) return null;
    cup.effectEventEmitted = true;
    const offer = this._offerForCup(cup);
    if (offer) offer.cup.effectEventEmitted = true;
    const event = {
      type: "\u672C\u676F\u6548\u679C",
      recipient: cup.drinkerId,
      cupId: cup.id,
      actualEffectDescription: desc,
      time: now
    };
    this.state.lastEvents = [...this.state.lastEvents || [], event];
    const visibleTo = [...new Set([cup.drinkerId, cup.mixerId].filter(Boolean))];
    this.state.records.push({
      id: `effect-${cup.id}`,
      cupId: cup.id,
      type: "\u672C\u676F\u6548\u679C",
      time: now,
      recipient: cup.drinkerId,
      visibleTo,
      actualEffectDescription: desc
    });
    return event;
  }
  _flushPendingSensitivity() {
    const queue = this.state.pendingSensitivity || [];
    if (queue.length === 0) return;
    const next = { ...this.state.sensitivity };
    for (const item of queue) {
      if (!(item.axis in next)) continue;
      const delta = item.delta ?? (item.direction === "\u6DE1" || item.direction === "down" ? -SENSITIVITY_STEP : SENSITIVITY_STEP);
      next[item.axis] = Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, next[item.axis] + delta));
    }
    this.state.sensitivity = next;
    this.state.pendingSensitivity = [];
  }
  _finishBelief(cupId, now) {
    for (const r of this.state.beliefResiduals) {
      if (r.cupId === cupId && r.decayStart == null) r.decayStart = now;
    }
    for (const r of this.state.directBeliefResiduals || []) {
      if (r.cupId === cupId && r.decayStart == null) r.decayStart = now;
    }
    for (const r of this.state.characterResiduals || []) {
      if (r.cupId === cupId && r.decayStart == null) r.decayStart = now;
    }
  }
  _residualFor(cupId) {
    let r = this.state.beliefResiduals.find((x) => x.cupId === cupId);
    if (!r) {
      r = { cupId, cumulative: { \u6109\u60A6: 0, \u5524\u9192: 0, \u4EB2\u8FD1: 0, \u5B88\u95E8: 0, \u6B32\u671B: 0, \u7CBE\u5EA6: 0 }, decayStart: null };
      this.state.beliefResiduals.push(r);
    }
    return r;
  }
  _directBeliefResidualFor(cupId) {
    this.state.directBeliefResiduals ||= [];
    let r = this.state.directBeliefResiduals.find((x) => x.cupId === cupId);
    if (!r) {
      r = {
        cupId,
        cumulative: { \u6109\u60A6: 0, \u5524\u9192: 0, \u4EB2\u8FD1: 0, \u5B88\u95E8: 0, \u6B32\u671B: 0, \u7CBE\u5EA6: 0 },
        subjective: [],
        decayStart: null
      };
      this.state.directBeliefResiduals.push(r);
    }
    return r;
  }
  _characterResidualFor(cupId) {
    this.state.characterResiduals ||= [];
    let r = this.state.characterResiduals.find((x) => x.cupId === cupId);
    if (!r) {
      r = { cupId, cumulative: { \u6109\u60A6: 0, \u5524\u9192: 0, \u4EB2\u8FD1: 0, \u5B88\u95E8: 0, \u6B32\u671B: 0, \u7CBE\u5EA6: 0 }, decayStart: null };
      this.state.characterResiduals.push(r);
    }
    return r;
  }
  getHangover(now) {
    this.settle(now ?? this.state.lastSettle);
    return currentHangover(this.state.hangoverSnapshots, now ?? this.state.lastSettle);
  }
  evaluateCup(cup, now = this.state.lastSettle) {
    this.settle(now);
    const k = activeAmount(this.state.actives, "\u5496\u5561\u56E0");
    if (!cup && !this.state.currentCup && this.state.c === 0 && k === 0 && this.state.beliefResiduals.length === 0 && this.state.directBeliefResiduals.length === 0 && this.state.characterResiduals.length === 0) {
      const empty = emptyProjection();
      empty.presentation = this._presentationOf(empty);
      return empty;
    }
    const target = cup || this.state.currentCup;
    const result = evaluateCup(this.state, target, now, this.contentPack);
    result.presentation = this._presentationOf(result);
    return result;
  }
  _presentationOf(evalRes) {
    const states = [];
    if (collapseActive(evalRes)) states.push(produceCollapseState(this.contentPack));
    const openFrag = (this.state.fragmentBatches || []).find((b) => b.end == null);
    if (openFrag && openFrag.readable === false) {
      states.push(produceBlackoutState(this.contentPack));
    }
    return { states };
  }
  _effectDescriptionForCup(cup, now) {
    const draw = cup?.hiddenDraw;
    if (draw?.hit && draw.identity) {
      const copy = hiddenOutcomeCopy(draw.identity, this.contentPack);
      if (copy?.effectText) return { text: copy.effectText };
    }
    return describeCupEffect(
      this.state,
      this.state.effectBaseline,
      cup,
      now,
      this.contentPack
    );
  }
  evaluate(now) {
    return this.evaluateCup(this.state.currentCup, now);
  }
  /**
   * 逐口入账。mouth.volume 已是每口体积，不得再除以 totalMouths。
   */
  applyMouth(cup, mouthIndex, now = this.state.lastSettle) {
    this.settle(now);
    const mouth = cup.mouths[mouthIndex];
    if (!mouth) throw new Error(`no mouth ${mouthIndex}`);
    if (mouth.applied) return { skipped: true, reason: "already_applied" };
    if (this._hasOpenCup() && this.state.currentCup.id !== cup.id) {
      return { ok: false, error: "\u4E00\u676F\u672A\u7ED3\u675F\u524D\u4E0D\u5F97\u5F00\u59CB\u559D\u7B2C\u4E8C\u676F", skipped: true };
    }
    const startingThisCup = !this.state.currentCup || this.state.currentCup.id !== cup.id || this.state.currentCup.closed;
    if (startingThisCup) {
      this.state.effectBaseline = snapshotEffectBaseline(this.state, now);
      this.state.pendingSensitivity = this.state.pendingSensitivity || [];
    }
    const cWasZero = this.state.c === 0;
    if (cWasZero) this.state.eventPeak = 0;
    const fixedCharacterCup = cup.kind === "menu";
    const alcohol = fixedCharacterCup ? 0 : mlToStandardDrinks(mouth.volume, mouth.abv || 0);
    const cBefore = this.state.c;
    this.state.c += alcohol;
    const totalMouths = cup.totalMouths || 1;
    const activesTotal = fixedCharacterCup ? {} : cup.activesTotal || collectActives(cup.recipe || cup.parts || [], this.contentPack?.ingredients);
    const mouthActives = {};
    for (const [compound, total] of Object.entries(activesTotal)) {
      const per = Number(total || 0) / totalMouths;
      if (per) mouthActives[compound] = per;
    }
    if (Object.keys(mouthActives).length) {
      if (!this.state.actives) this.state.actives = emptyActives();
      ingestActives(this.state, mouthActives, now);
    }
    this.state.tonightPeak = Math.max(this.state.tonightPeak, this.state.c);
    this.state.eventPeak = Math.max(this.state.eventPeak, this.state.c);
    this.state.lastSettle = now;
    mouth.applied = true;
    mouth.startTime = now;
    this.state.tasteCurves.push({
      cupId: cup.id,
      mouthIndex,
      startTime: now,
      components: mouth.components
    });
    if (!this.state.currentCup || this.state.currentCup.id !== cup.id) {
      this.state.currentCup = this._cupState(cup, now);
    }
    const cur = this.state.currentCup;
    cur.lastMouthTime = now;
    cur.remainingMouths = Math.max(0, (cur.remainingMouths ?? cup.totalMouths) - 1);
    cur.mouthStartTimes = [...cur.mouthStartTimes || [], now];
    cur.drunk = true;
    const characterBase = cup.characterEffects || null;
    if (characterBase && Object.values(characterBase).some((v) => v)) {
      const characterStep = mouthSuggestion(characterBase, 1, cup.totalMouths);
      const residual = this._characterResidualFor(cup.id);
      residual.cumulative = addVectors(residual.cumulative, characterStep);
    }
    const namedSuggestion = mouth.suggestion || mouthSuggestion(this._beliefBase(cup), mouth.beta ?? cup.beta ?? 1, cup.totalMouths);
    const resolvedBeliefs = resolveAgentBeliefs(cup.agentBeliefs || [], this.contentPack);
    const objectSuggestion = mouthSuggestion(resolvedBeliefs.objectVector, 1, cup.totalMouths);
    const objectTotal = addVectors(namedSuggestion, objectSuggestion);
    if (objectTotal && Object.values(objectTotal).some((v) => v)) {
      const residual = this._residualFor(cup.id);
      residual.cumulative = addVectors(residual.cumulative, objectTotal);
    }
    const directSuggestion = mouthSuggestion(resolvedBeliefs.directVector, 1, cup.totalMouths);
    if (directSuggestion && Object.values(directSuggestion).some((v) => v)) {
      const residual = this._directBeliefResidualFor(cup.id);
      residual.cumulative = addVectors(residual.cumulative, directSuggestion);
    }
    if (resolvedBeliefs.subjective.length) {
      const residual = this._directBeliefResidualFor(cup.id);
      const seen = new Set((residual.subjective || []).map((x) => x.text));
      for (const item of resolvedBeliefs.subjective) {
        if (!seen.has(item.text)) {
          residual.subjective.push({ ...item });
          seen.add(item.text);
        }
      }
    }
    const events = [];
    if (!fixedCharacterCup && shouldVomit(cBefore, this.state.c, this.state.vomitArmed)) {
      events.push(attachSafety(produceVomitEvent(this.contentPack)));
      this.state.vomitArmed = false;
    }
    this._recoverFragments(now);
    if (!fixedCharacterCup && this.blackoutEnabled && this.state.c >= BLACKOUT_C) {
      const hadOpenBlackout = (this.state.fragmentBatches || []).some((batch) => batch.end == null);
      const opened = this._openFragment(now);
      if (opened && !hadOpenBlackout) events.push(attachSafety(produceBlackoutState(this.contentPack)));
    }
    const isFirst = (cur.mouthStartTimes || []).length === 1;
    const hiddenHit = !!(cur.hiddenDraw?.hit || cup.hiddenDraw?.hit);
    if (!fixedCharacterCup && isFirst && !cur.crashRolled) {
      cur.crashRolled = true;
      if (!hiddenHit) {
        const D = computeDiscreteness(cup.sources || []);
        const significantCount = countSignificantSources(cup.sources || []);
        const totalDrinks = (cup.mouths || []).reduce(
          (s, m) => s + mlToStandardDrinks(m.volume, m.abv || 0),
          0
        );
        if (rollCrash({
          D,
          standardDrinks: totalDrinks,
          volumeMl: cup.totalVolume,
          significantCount,
          isFirstMouth: true,
          random: this.random
        })) {
          events.push(attachSafety(produceCrashEvent(this.contentPack)));
        }
      }
    }
    this.state.lifetimeDrinks = Number(this.state.lifetimeDrinks || 0) + alcohol;
    this._sipSeq = (this._sipSeq || 0) + 1;
    const drinkRecordId = `${cup.id}-sip-${mouthIndex}-${now}-${this._sipSeq}`;
    this.state.records.push({
      id: drinkRecordId,
      cupId: cup.id,
      type: "\u559D\u4E0B",
      time: now,
      drunk: true
    });
    cup.remainingMouths = cur.remainingMouths;
    this.state.lastEvents = events;
    if (cur.remainingMouths === 0) {
      this._finishBelief(cup.id, now);
      cur.closed = true;
      cup.closed = true;
      this.state.cupsDrunk += 1;
      this._settleCupEffects(cur, now);
      if (isHiddenIdentity(cup.claimedName)) {
        this.state.lastEvents = [...this.state.lastEvents, attachSafety(
          cup.claimedName === HIDDEN_BLACK_NAME ? produceVomitEvent(this.contentPack) : produceCrashEvent(this.contentPack)
        )];
      }
      recordDrinkEvent(this.state, {
        eventId: `${cup.id}@${now}`,
        cupId: cup.id,
        consumedAt: now,
        standardDrinks: fixedCharacterCup ? 0 : (cup.mouths || []).reduce((sum, m) => sum + mlToStandardDrinks(m.volume, m.abv || 0), 0)
      }, this.lifecycle);
      bumpRevision(this.state);
    }
    this.state.currentCup = cur;
    return { alcohol, c: this.state.c, events: this.state.lastEvents, drinkRecordId };
  }
  _cupState(cup, now) {
    return {
      id: cup.id,
      claimedName: cup.claimedName,
      recipeId: cup.recipeId || cup.id,
      recipe: cup.recipe || null,
      totalMouths: cup.totalMouths,
      remainingMouths: cup.totalMouths,
      mouthStartTimes: [],
      beta: cup.beta,
      lastMouthTime: now,
      sources: cup.sources,
      mouths: cup.mouths,
      totalVolume: cup.totalVolume,
      textures: cup.textures || [],
      method: cup.method,
      cupType: cup.cupType,
      color: cup.color,
      intro: cup.intro || "",
      finish: cup.finish || "",
      description: cup.description || "",
      effects: cup.effects || null,
      characterEffects: cup.characterEffects || null,
      characterIdentity: cup.characterIdentity || null,
      agentBeliefs: this._cloneValue(cup.agentBeliefs || []),
      claimedEffects: cup.claimedEffects || claimedEffectsOrZero(cup, this.contentPack),
      claimedEffectText: cup.claimedEffectText || this._claimedEffectText(resolveClaimedEffects(cup, this.contentPack)),
      caffeineTotal: cup.caffeineTotal || 0,
      caffeinePerMouth: cup.caffeinePerMouth || 0,
      baseVector: cup.baseVector || cup.effects || null,
      kind: cup.kind || "custom",
      mixerId: cup.mixerId,
      drinkerId: cup.drinkerId,
      recipeRevealedTo: cup.recipeRevealedTo || [],
      hiddenDraw: cup.hiddenDraw || null,
      registeredEffectText: cup.registeredEffectText || "",
      registeredFlavorText: cup.registeredFlavorText || "",
      crashRolled: false,
      closed: false,
      expired: false,
      drunk: false,
      effectSettled: false,
      effectEventEmitted: false
    };
  }
  sipAll(cup, now) {
    const results = [];
    for (let i = 0; i < cup.totalMouths; i += 1) {
      const r = this.applyMouth(cup, i, now);
      results.push(r);
      if (r?.skipped && r.error) break;
    }
    return results;
  }
  // 放弃当前这只**没喝完**的杯。
  //
  // 只丢弃「还没喝的那部分」，**不改已经发生的事**：
  // 已喝下的口、递出与喝下记录、审计、cupsDrunk 一律原样保留。
  // 对应的 offer 标 cleared，避免 reset 之后又被当成新杯重喝一遍。
  //
  // 行为约定新增。此前「当前杯未结算」是个死结：
  // 三种 reset 模式一律 409 拒绝，而那只杯又没有 offer 可以喝完，
  // 从 HTTP 出不去。这个方法就是那扇出口，**不借用「这晚不算」**
  // （那个会删 tonightStart 之后的历史）。
  discardCurrentCup(now = this.state.lastSettle) {
    const cup = this.state.currentCup;
    if (!cup) return { ok: true, discarded: false };
    const offer = this._offerForCup(cup);
    if (offer) offer.cleared = true;
    cup.closed = true;
    this.state.currentCup = null;
    this.state.lastSettle = now;
    return { ok: true, discarded: true, cupId: cup.id };
  }
  reset(mode, now = this.state.lastSettle, { discardOpenCup = false } = {}) {
    this.settle(now);
    if (this._hasOpenCup()) {
      if (!discardOpenCup) return { ok: false, error: "\u5F53\u524D\u676F\u5C1A\u672A\u7ED3\u7B97" };
      this.discardCurrentCup(now);
    }
    const s = this.state;
    const eventPeakBefore = s.eventPeak;
    if (mode === "\u9192\u9152") {
      const snap = createHangoverSnapshot(eventPeakBefore, now);
      if (snap) s.hangoverSnapshots.push(snap);
      s.c = 0;
      s.eventPeak = 0;
      s.tonightPeak = 0;
      s.beliefResiduals = [];
      s.directBeliefResiduals = [];
      s.characterResiduals = [];
      s.vomitArmed = true;
    } else if (mode === "\u8FDE\u5BBF\u9189\u4E00\u8D77\u6E05") {
      s.c = 0;
      s.eventPeak = 0;
      s.tonightPeak = 0;
      s.hangoverSnapshots = [];
      s.beliefResiduals = [];
      s.directBeliefResiduals = [];
      s.characterResiduals = [];
      s.vomitArmed = true;
    } else if (mode === "\u8FD9\u665A\u4E0D\u7B97") {
      s.c = 0;
      s.eventPeak = 0;
      s.tonightPeak = 0;
      s.hangoverSnapshots = [];
      s.beliefResiduals = [];
      s.directBeliefResiduals = [];
      s.characterResiduals = [];
      s.currentCup = null;
      s.tasteCurves = [];
      s.vomitArmed = true;
      s.records = s.records.filter((r) => r.time < s.tonightStart);
      s.tonightDelivered = s.tonightDelivered.filter((r) => r.time < s.tonightStart);
      s.fragmentBatches = [];
      s.cupsDrunk = 0;
      for (const offer of this.offers.values()) {
        if (offer.createdAt >= s.tonightStart) {
          offer.cleared = true;
        }
      }
    } else {
      throw new Error(`unknown reset mode: ${mode}`);
    }
    resetActives(s);
    s.effectBaseline = null;
    s.pendingSensitivity = [];
    s.lastSettle = now;
    liftBlackouts(s, now);
    s.drinkEvents = [];
    s.lastTransientActivityAt = 0;
    markResetBoundary(s, now);
    return s;
  }
  // 尚未过期的饮用事件（各自带 expiresAt）。
  lifecycleEvents(now = this.state.lastSettle, scope = "today") {
    return activeDrinkEvents(this.state, now, this.lifecycle, scope);
  }
  updateSensitivity(drinkRecordId, axis, direction, now = this.state.lastSettle) {
    this.settle(now);
    if (!drinkRecordId) return { ok: false, error: "no_drink_record" };
    const rec = this.state.records.find((r) => r.id === drinkRecordId);
    if (!rec) return { ok: false, error: "no_drink_record" };
    if (!(axis in this.state.sensitivity)) return { ok: false, error: "unknown_axis" };
    const delta = direction === "\u6DE1" || direction === "down" ? -SENSITIVITY_STEP : SENSITIVITY_STEP;
    if (this._hasOpenCup()) {
      this.state.pendingSensitivity = this.state.pendingSensitivity || [];
      this.state.pendingSensitivity.push({
        axis,
        direction,
        delta,
        submittedAt: now,
        drinkRecordId
      });
      rec.sensitivityAxis = axis;
      return { ok: true, queued: true, axis };
    }
    const next = this.state.sensitivity[axis] + delta;
    this.state.sensitivity[axis] = Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, next));
    rec.sensitivityAxis = axis;
    return { ok: true, axis, value: this.state.sensitivity[axis] };
  }
  _cupsForReveal(offer, offerOrCupId, target) {
    const cups = [];
    if (offer?.cup) cups.push(offer.cup);
    if (this.state.currentCup && (this.state.currentCup.id === offerOrCupId || this.state.currentCup.id === offer?.cup?.id)) {
      cups.push(this.state.currentCup);
    }
    if (!offer && target?.mouths) cups.push(target);
    return cups;
  }
  _applyFullRevealToDrinker(cup) {
    cup.beta = 0;
    const base = cup.baseVector || cup.effects || {};
    const n = cup.totalMouths || (cup.mouths || []).length || 1;
    for (const m of cup.mouths || []) {
      if (m.applied) continue;
      m.beta = 0;
      m.suggestion = mouthSuggestion(base, 0, n);
    }
  }
  /**
   * 亮底。签名：revealRecipe(offerOrCupId, toId, actorId)
   * actorId 必填且必须是调制者。旧的两参数调用视为未授权，不改状态。
   * 向饮用者亮出完整配方时，立即重算所有尚未入口的口的 β 与 suggestion。
   */
  revealRecipe(offerOrCupId, toId, actorId) {
    const offer = this.offers.get(offerOrCupId);
    const target = offer || (this.state.currentCup?.id === offerOrCupId ? this.state.currentCup : null);
    if (!target) return { ok: false, error: "not_found" };
    const mixerId = offer?.mixerId ?? target.mixerId;
    if (!actorId || actorId !== mixerId) {
      return { ok: false, error: "not_mixer" };
    }
    const revealed = [.../* @__PURE__ */ new Set([...target.recipeRevealedTo || [], toId])];
    if (offer) offer.recipeRevealedTo = [...revealed];
    const cups = this._cupsForReveal(offer, offerOrCupId, target);
    for (const cup of cups) {
      cup.recipeRevealedTo = [...revealed];
      if (toId === cup.drinkerId) this._applyFullRevealToDrinker(cup);
    }
    return { ok: true, recipeRevealedTo: [...revealed] };
  }
  createOffer(cup, mixerId, giverId, drinkerId, now = this.state.lastSettle) {
    this.settle(now);
    const prepared = this._prepareCup(cup, mixerId, drinkerId);
    const oneTimeId = randomUUID();
    const record = {
      id: oneTimeId,
      claimedName: prepared.claimedName,
      mixerId,
      giverId,
      drinkerId,
      drunk: false,
      refused: false,
      time: now
    };
    this.state.tonightDelivered.push(record);
    this.state.records.push({ ...record, type: "\u9012\u51FA" });
    const offer = {
      oneTimeId,
      cup: prepared,
      mixerId,
      giverId,
      drinkerId,
      claimedName: prepared.claimedName,
      intro: prepared.intro,
      cupType: prepared.cupType,
      color: prepared.color,
      // 装饰物跟杯型、颜色同级，都是外观。offer 是按字段挑着拷的，
      // 漏了它投影里就永远看不到——2026-09-03 补。
      garnishes: [...prepared.garnishes || []],
      recipe: prepared.recipe,
      effects: prepared.effects,
      claimedEffects: prepared.claimedEffects,
      claimedEffectText: prepared.claimedEffectText || "",
      description: prepared.description,
      finish: prepared.finish || "",
      kind: prepared.kind,
      recipeRevealedTo: prepared.recipeRevealedTo || [],
      status: "open",
      consumedRequestId: null,
      consumedResult: null,
      createdAt: now
    };
    this.offers.set(oneTimeId, offer);
    return oneTimeId;
  }
  _cloneValue(value) {
    if (value == null) return value;
    return structuredClone(value);
  }
  _ingredientIds() {
    return Object.keys(this.contentPack?.ingredients || {});
  }
  _menuNames() {
    return (this.contentPack?.menu || []).map((m) => m.claimedName);
  }
  _registeredIntros() {
    const out = /* @__PURE__ */ new Set();
    for (const m of this.contentPack.menu || []) {
      if (m.intro) out.add(m.intro);
    }
    for (const copy of Object.values(this.contentPack.hiddenOutcomes || {})) {
      if (copy.intro) out.add(copy.intro);
    }
    return out;
  }
  _sanitizeProjection(projection) {
    if (!projection || typeof projection !== "object") return projection;
    const ids = this._ingredientIds();
    const names = this._menuNames();
    if (projection.claimedName != null) {
      projection.claimedName = sanitizeClaimedName(projection.claimedName, {
        ingredientIds: ids,
        allowMenuNames: names
      }) || projection.claimedName;
    }
    if (projection.intro != null && !this._registeredIntros().has(projection.intro)) {
      projection.intro = sanitizeIntro(projection.intro, { ingredientIds: ids });
    }
    if (projection.finish != null) {
      projection.finish = sanitizeFinish(projection.finish, { ingredientIds: ids, strict: false }).value;
    }
    return projection;
  }
  _claimedEffectText(vec) {
    if (!vec) return "";
    const assembled = assembleEffectDescription(vec, this.contentPack?.effectLexicon);
    return publicEffectDescription(assembled).text || "";
  }
  _prepareCup(cup, mixerId, drinkerId) {
    const cloned = this._cloneValue(cup);
    const recipeId = cloned.recipeId || cloned.id || cloned.claimedName;
    cloned.id = this.idFactory();
    cloned.recipeId = recipeId;
    cloned.mixerId = mixerId;
    cloned.drinkerId = drinkerId;
    cloned.kind = cloned.kind || "custom";
    if (!this.allowHiddenFixtures) cloned.internalHidden = false;
    cloned.recipeRevealedTo = [];
    cloned.claimedName = sanitizeClaimedName(cloned.claimedName, {
      ingredientIds: this._ingredientIds(),
      allowMenuNames: this._menuNames()
    }) || "\u672A\u547D\u540D";
    cloned.intro = sanitizeIntro(cloned.intro, { ingredientIds: this._ingredientIds() });
    cloned.finish = sanitizeFinish(cloned.finish, { ingredientIds: this._ingredientIds(), strict: false }).value;
    cloned.sources = this._cloneValue(cloned.sources || []);
    cloned.recipe = this._cloneValue(
      cloned.recipe || cloned.sources.map((s) => ({ id: s.id, volume: s.volume }))
    );
    hydrateCupPhysics(cloned, this.contentPack?.ingredients);
    const totalVolume = cloned.totalVolume ?? cloned.sources.reduce((n, s) => n + (s.volume || 0), 0);
    cloned.totalVolume = totalVolume;
    cloned.color = cloned.color || computeColor(cloned.sources, totalVolume);
    cloned.cupType = cloned.cupType || computeCupType({
      totalVolume,
      textures: cloned.textures || [],
      method: cloned.method
    });
    cloned.totalMouths = cloned.totalMouths || Math.max(2, Math.ceil(totalVolume / 45));
    cloned.mouths = (cloned.mouths || []).map((m) => {
      const mouth = this._cloneValue(m);
      mouth.applied = false;
      mouth.startTime = null;
      mouth.components = this._cloneValue(mouth.components || []);
      mouth.suggestion = this._cloneValue(mouth.suggestion);
      return mouth;
    });
    cloned.remainingMouths = cloned.totalMouths;
    cloned.closed = false;
    cloned.expired = false;
    cloned.drunk = false;
    cloned.crashRolled = false;
    cloned.effectSettled = false;
    cloned.effectEventEmitted = false;
    cloned.claimedEffects = claimedEffectsOrZero(cloned, this.contentPack);
    cloned.claimedEffectText = this._claimedEffectText(resolveClaimedEffects(cloned, this.contentPack));
    if (isPlainName(cloned.claimedName)) {
      cloned.baseVector = null;
      cloned.mouths = (cloned.mouths || []).map((m) => ({
        ...m,
        suggestion: mouthSuggestion({}, m.beta ?? cloned.beta ?? 1, cloned.totalMouths)
      }));
    }
    this._restoreListedCopy(cloned);
    this._deriveIngredientCharacter(cloned);
    this._applyHiddenDraw(cloned);
    if (isHiddenIdentity(cloned.claimedName) && !cloned.hiddenDraw?.hit && !cloned.internalHidden) {
      cloned.claimedName = "\u672A\u547D\u540D";
    }
    cloned.caffeineTotal = caffeineOfParts(
      cloned.recipe || (cloned.sources || []).map((s) => ({ id: s.id, volume: s.volume })),
      this.contentPack.ingredients
    );
    cloned.caffeinePerMouth = cloned.totalMouths ? cloned.caffeineTotal / cloned.totalMouths : 0;
    return cloned;
  }
  viewOffer(oneTimeId, viewerId, now = this.state.lastSettle) {
    this.settle(now);
    const offer = this.offers.get(oneTimeId);
    if (!offer) return { ok: false, error: "not_found" };
    const projection = this._sanitizeProjection(
      projectForViewer(offer, viewerId, { drunk: offer.status === "consumed", phase: "first" })
    );
    return { ok: true, projection, status: offer.status };
  }
  drinkOffer(oneTimeId, viewerId, requestId, now = this.state.lastSettle) {
    this.settle(now);
    const offer = this.offers.get(oneTimeId);
    if (!offer) return { ok: false, error: "not_found" };
    if (viewerId !== offer.drinkerId) {
      return { ok: false, error: "not_drinker" };
    }
    if (offer.status === "rejected" || offer.status === "expired") {
      return { ok: false, error: offer.status };
    }
    if (offer.status === "consumed") {
      return { ok: true, idempotent: true, projection: offer.consumedResult };
    }
    if (this._hasOpenCup() && this.state.currentCup.id !== offer.cup.id) {
      return { ok: false, error: "\u4E00\u676F\u672A\u7ED3\u675F\u524D\u4E0D\u5F97\u5F00\u59CB\u559D\u7B2C\u4E8C\u676F" };
    }
    const cBefore = this.state.c;
    const sipResults = this.sipAll(offer.cup, now);
    const evalRes = this.evaluateCup(offer.cup, now);
    const flavor = reportedFlavor(offer.cup, evalRes);
    const flavorAssembled = assembleFlavorDescription(
      flavor,
      this.contentPack?.flavorLexicon,
      evalRes.ratioWords,
      offer.cup?.id || offer.oneTimeId
    );
    const extras = this._drinkExtras(offer, flavor, flavorAssembled);
    const projection = this._sanitizeProjection(
      projectForViewer(offer, viewerId, { drunk: true, phase: "second", extras })
    );
    offer.status = "consumed";
    offer.consumedRequestId = requestId;
    offer.consumedResult = projection;
    offer.drunkAt = now;
    const rec = this.state.records.find((r) => r.id === oneTimeId);
    if (rec) rec.drunk = true;
    const del = this.state.tonightDelivered.find((r) => r.id === oneTimeId);
    if (del) del.drunk = true;
    this.state.records.push({
      id: `drink-${oneTimeId}`,
      offerId: oneTimeId,
      type: "\u559D\u4E0B",
      time: now,
      drunk: true
    });
    const payload = {
      ok: true,
      idempotent: false,
      projection,
      sipResults,
      eval: evalRes,
      beforeC: cBefore,
      events: this.state.lastEvents
    };
    const injection = this.currentInjection(now);
    if (injection) payload.stateInjection = injection;
    return payload;
  }
  rejectOffer(oneTimeId, viewerId, now = this.state.lastSettle) {
    this.settle(now);
    const offer = this.offers.get(oneTimeId);
    if (!offer) return { ok: false, error: "not_found" };
    if (viewerId !== offer.drinkerId) {
      return { ok: false, error: "not_drinker" };
    }
    if (offer.status === "consumed") return { ok: false, error: "already_consumed" };
    if (offer.status === "expired") return { ok: false, error: "expired" };
    if (offer.status === "rejected") return { ok: true, idempotent: true };
    const snapshot = this.exportState();
    offer.status = "rejected";
    const rec = this.state.records.find((r) => r.id === oneTimeId);
    if (rec) rec.refused = true;
    const del = this.state.tonightDelivered.find((r) => r.id === oneTimeId);
    if (del) del.refused = true;
    this.state.records.push({
      id: `reject-${oneTimeId}`,
      offerId: oneTimeId,
      type: "\u62D2\u7EDD",
      time: now,
      drunk: false,
      refused: true
    });
    return {
      ok: true,
      idempotent: false,
      cUnchanged: this.state.c === snapshot.c,
      sensitivityUnchanged: JSON.stringify(this.state.sensitivity) === JSON.stringify(snapshot.sensitivity),
      cupsDrunkUnchanged: this.state.cupsDrunk === snapshot.cupsDrunk
    };
  }
  expireOffer(oneTimeId, now = this.state.lastSettle) {
    this.settle(now);
    const offer = this.offers.get(oneTimeId);
    if (!offer) return { ok: false, error: "not_found" };
    if (offer.status === "consumed") return { ok: false, error: "already_consumed" };
    if (offer.status === "rejected") return { ok: false, error: "rejected" };
    if (offer.status === "expired") return { ok: true, idempotent: true };
    offer.status = "expired";
    return { ok: true, idempotent: false };
  }
  _deriveIngredientCharacter(cloned) {
    if (cloned.characterEffects && Object.values(cloned.characterEffects).some((v) => Number(v) !== 0)) return;
    const profiles = this.contentPack?.ingredientCharacterProfiles || {};
    const out = { \u6109\u60A6: 0, \u5524\u9192: 0, \u4EB2\u8FD1: 0, \u5B88\u95E8: 0, \u6B32\u671B: 0, \u7CBE\u5EA6: 0 };
    let hit = false;
    for (const part of cloned.recipe || []) {
      const profile = profiles[part?.id];
      if (!profile) continue;
      const ref = Number(profile.referenceVolume || 0);
      const volume = Number(part?.volume || 0);
      if (!(ref > 0) || !(volume > 0)) continue;
      const factor = volume / ref;
      for (const [axis, value] of Object.entries(profile.effects || {})) {
        if (axis === "\u7CBE\u5EA6") continue;
        out[axis] = (out[axis] || 0) + (Number(value) || 0) * factor;
      }
      hit = true;
    }
    if (!hit) return;
    out.\u7CBE\u5EA6 = 0;
    cloned.characterEffects = out;
    cloned.characterIdentity = null;
  }
  _restoreListedCopy(cloned) {
    if (cloned.kind !== "menu") return;
    const listed = (this.contentPack.menu || []).find((m) => m.claimedName === cloned.claimedName);
    if (!listed) return;
    cloned.intro = listed.intro;
    cloned.finish = listed.finish ?? cloned.finish;
    cloned.description = listed.description ?? cloned.description;
    cloned.registeredEffectText = listed.registeredEffectText || cloned.registeredEffectText || "";
    cloned.registeredFlavorText = listed.registeredFlavorText || cloned.registeredFlavorText || "";
    if (listed.effects) {
      cloned.effects = listed.effects;
      cloned.characterEffects = { ...listed.effects, \u7CBE\u5EA6: 0 };
      cloned.characterIdentity = listed.claimedName;
    }
    if (listed.category) cloned.category = listed.category;
  }
  _applyHiddenDraw(cloned) {
    const draw = resolveHiddenDraw(cloned, { hashUnitFn: this.hiddenHashUnit });
    cloned.hiddenDraw = draw;
    if (draw.hit && draw.identity) applyHiddenIdentity(cloned, draw.identity, this.contentPack);
  }
  _drinkExtras(offer, flavor, flavorAssembled) {
    const cup = offer.cup || {};
    const draw = cup.hiddenDraw;
    const extras = {
      finish: offer.finish ?? cup.finish ?? "",
      actualEffectDescription: offer.actualEffectDescription || cup.actualEffectDescription
    };
    if (draw?.hit && draw.identity) {
      const copy = hiddenOutcomeCopy(draw.identity, this.contentPack);
      extras.actualEffectDescription = { text: copy?.effectText || extras.actualEffectDescription?.text || "" };
      if (draw.identity === HIDDEN_BLACK_NAME) {
        extras.flavorDescription = assembleClashingFlavorDescription(flavor);
      } else {
        extras.flavorDescription = flavorAssembled.text || "";
      }
      return extras;
    }
    extras.flavor = flavor;
    extras.flavorDescription = cup.registeredFlavorText || offer.registeredFlavorText || flavorAssembled.text || "";
    if (!flavorHasSignal(flavor) && (cup.registeredFlavorText || offer.registeredFlavorText)) {
      extras.flavorDescription = cup.registeredFlavorText || offer.registeredFlavorText;
    }
    return extras;
  }
  publicMenu() {
    const items = this.contentPack.menu || [];
    return items.filter((m) => m.listed !== false && m.kind !== "unlisted");
  }
  aiOrderCatalog() {
    return this.publicMenu().map((cup) => ({
      claimedName: cup.claimedName,
      intro: cup.intro || "",
      recipe: cup.recipe || [],
      flavorText: cup.registeredFlavorText || cup.claimedFlavorText || "",
      effectText: cup.registeredEffectText || cup.claimedEffectText || "",
      finish: cup.finish || "",
      cupType: cup.cupType,
      color: cup.color,
      kind: cup.kind,
      category: cup.category || null,
      listed: cup.listed !== false
    }));
  }
  flavorPeak(mouth, axis) {
    return flavorPeakForMouth(mouth, axis);
  }
  isInjectionEnabled() {
    return this.state.stateInjection === true || injectionEnabled(this.contentPack, this.options);
  }
  setStateInjection(on) {
    this.state.stateInjection = !!on;
    return { ok: true, stateInjection: this.state.stateInjection };
  }
  currentInjection(now = this.state.lastSettle) {
    if (!this.isInjectionEnabled()) return null;
    this.settle(now);
    const evalRes = this.evaluate(now);
    return buildStateInjection(evalRes.state, this.contentPack?.effectLexicon);
  }
};

// src/runtime/agentStateHints.js
var AXIS_ORDER = ["\u6109\u60A6", "\u5524\u9192", "\u7CBE\u5EA6", "\u4EB2\u8FD1", "\u5B88\u95E8", "\u6B32\u671B"];
var SOFT_AXES = /* @__PURE__ */ new Set(["\u6109\u60A6", "\u5524\u9192", "\u4EB2\u8FD1", "\u5B88\u95E8", "\u6B32\u671B"]);
function tierOf(value) {
  const v = Math.abs(Number(value) || 0);
  if (v < 1.5) return "\u4F4E";
  if (v < 3) return "\u4E2D";
  return "\u9AD8";
}
function hintFor(axis, value) {
  const direction = Number(value) >= 0 ? "+" : "-";
  const tier = tierOf(value);
  const table = {
    \u6109\u60A6: {
      "+": {
        \u4F4E: "\u8212\u670D\u3001\u8F7B\u5FEB\u7684\u611F\u53D7\u53EF\u80FD\u7A0D\u5FAE\u66F4\u5BB9\u6613\u51FA\u73B0\u3002",
        \u4E2D: "\u8212\u670D\u3001\u8F7B\u5FEB\u7684\u611F\u53D7\u53EF\u80FD\u66F4\u5BB9\u6613\u5360\u4E0A\u98CE\u3002",
        \u9AD8: "\u8212\u670D\u3001\u8F7B\u5FEB\u7684\u611F\u53D7\u660E\u663E\u66F4\u5BB9\u6613\u5360\u4E0A\u98CE\u3002"
      },
      "-": {
        \u4F4E: "\u70E6\u95F7\u6216\u4E0D\u8212\u670D\u7684\u611F\u53D7\u53EF\u80FD\u7A0D\u5FAE\u66F4\u5BB9\u6613\u5192\u51FA\u6765\u3002",
        \u4E2D: "\u70E6\u95F7\u6216\u4E0D\u8212\u670D\u7684\u611F\u53D7\u53EF\u80FD\u66F4\u5BB9\u6613\u5360\u4E0A\u98CE\u3002",
        \u9AD8: "\u70E6\u95F7\u6216\u4E0D\u8212\u670D\u7684\u611F\u53D7\u660E\u663E\u66F4\u5BB9\u6613\u538B\u4F4F\u5176\u4ED6\u611F\u53D7\u3002"
      }
    },
    \u5524\u9192: {
      "+": {
        \u4F4E: "\u7CBE\u795E\u548C\u6CE8\u610F\u53EF\u80FD\u7A0D\u5FAE\u66F4\u5BB9\u6613\u4FDD\u6301\u6D3B\u8DC3\u3002",
        \u4E2D: "\u7CBE\u795E\u548C\u6CE8\u610F\u53EF\u80FD\u66F4\u5BB9\u6613\u4FDD\u6301\u6D3B\u8DC3\u3002",
        \u9AD8: "\u7CBE\u795E\u548C\u6CE8\u610F\u660E\u663E\u5904\u5728\u66F4\u6D3B\u8DC3\u7684\u72B6\u6001\u3002"
      },
      "-": {
        \u4F4E: "\u6301\u7EED\u4FDD\u6301\u6CE8\u610F\u548C\u8FDE\u8D2F\u53CD\u5E94\u53EF\u80FD\u7A0D\u5FAE\u66F4\u8D39\u529B\u3002",
        \u4E2D: "\u6301\u7EED\u4FDD\u6301\u6CE8\u610F\u548C\u8FDE\u8D2F\u53CD\u5E94\u53EF\u80FD\u66F4\u8D39\u529B\u3002",
        \u9AD8: "\u7EF4\u6301\u6CE8\u610F\u548C\u8FDE\u7EED\u53CD\u5E94\u660E\u663E\u66F4\u8D39\u529B\u3002"
      }
    },
    \u7CBE\u5EA6: {
      "-": {
        \u4F4E: "\u5904\u7406\u7EC6\u8282\u548C\u4E34\u573A\u5224\u65AD\u786E\u5B9E\u66F4\u5BB9\u6613\u6162\u534A\u62CD\u3002",
        \u4E2D: "\u5904\u7406\u7EC6\u8282\u548C\u4E34\u573A\u5224\u65AD\u786E\u5B9E\u66F4\u5BB9\u6613\u8FDF\u7F13\u6216\u6F0F\u6389\u4E00\u70B9\u4E1C\u897F\u3002",
        \u9AD8: "\u5904\u7406\u7EC6\u8282\u548C\u4E34\u573A\u5224\u65AD\u786E\u5B9E\u660E\u663E\u53D7\u5F71\u54CD\uFF0C\u66F4\u5BB9\u6613\u51FA\u9519\u6216\u6F0F\u6389\u4E1C\u897F\u3002"
      }
    },
    \u4EB2\u8FD1: {
      "+": {
        \u4F4E: "\u4F60\u53EF\u80FD\u7A0D\u5FAE\u66F4\u60F3\u9760\u8FD1\u5BF9\u65B9\uFF0C\u6216\u613F\u610F\u8BA9\u4E92\u52A8\u7EE7\u7EED\u4E45\u4E00\u70B9\u3002",
        \u4E2D: "\u4F60\u53EF\u80FD\u66F4\u60F3\u9760\u8FD1\u5BF9\u65B9\uFF0C\u6216\u613F\u610F\u8BA9\u4E92\u52A8\u7EE7\u7EED\u4E45\u4E00\u70B9\u3002",
        \u9AD8: "\u4F60\u53EF\u80FD\u660E\u663E\u66F4\u60F3\u9760\u8FD1\u5BF9\u65B9\uFF0C\u6216\u8BA9\u4E92\u52A8\u7EE7\u7EED\u4E0B\u53BB\u3002"
      },
      "-": {
        \u4F4E: "\u4F60\u53EF\u80FD\u7A0D\u5FAE\u66F4\u60F3\u62C9\u5F00\u4E00\u70B9\u8DDD\u79BB\uFF0C\u6216\u8BA9\u4E92\u52A8\u77ED\u4E00\u70B9\u3002",
        \u4E2D: "\u4F60\u53EF\u80FD\u66F4\u60F3\u62C9\u5F00\u4E00\u70B9\u8DDD\u79BB\uFF0C\u6216\u51CF\u5C11\u4E92\u52A8\u3002",
        \u9AD8: "\u4F60\u53EF\u80FD\u660E\u663E\u66F4\u60F3\u62C9\u5F00\u8DDD\u79BB\uFF0C\u6216\u5C3D\u5FEB\u7ED3\u675F\u4E92\u52A8\u3002"
      }
    },
    \u5B88\u95E8: {
      "+": {
        \u4F4E: "\u4F60\u53EF\u80FD\u7A0D\u5FAE\u66F4\u5BB9\u6613\u628A\u8FB9\u754C\u5B88\u7D27\uFF0C\u539F\u672C\u4F1A\u4FDD\u7559\u7684\u4E1C\u897F\u66F4\u5BB9\u6613\u7EE7\u7EED\u4FDD\u7559\u3002",
        \u4E2D: "\u4F60\u53EF\u80FD\u66F4\u5BB9\u6613\u628A\u8FB9\u754C\u5B88\u7D27\uFF0C\u539F\u672C\u4F1A\u4FDD\u7559\u7684\u4E1C\u897F\u66F4\u5BB9\u6613\u7EE7\u7EED\u4FDD\u7559\u3002",
        \u9AD8: "\u4F60\u53EF\u80FD\u660E\u663E\u66F4\u5BB9\u6613\u628A\u8FB9\u754C\u5B88\u7D27\uFF0C\u4E0D\u8F7B\u6613\u628A\u539F\u672C\u4F1A\u4FDD\u7559\u7684\u4E1C\u897F\u5F80\u5916\u653E\u3002"
      },
      "-": {
        \u4F4E: "\u539F\u672C\u4F1A\u6536\u4F4F\u6216\u4FDD\u7559\u7684\u4E1C\u897F\uFF0C\u53EF\u80FD\u7A0D\u5FAE\u66F4\u5BB9\u6613\u5F80\u5916\u653E\u4E00\u70B9\u3002",
        \u4E2D: "\u539F\u672C\u4F1A\u6536\u4F4F\u6216\u4FDD\u7559\u7684\u4E1C\u897F\uFF0C\u53EF\u80FD\u66F4\u5BB9\u6613\u5F80\u5916\u653E\u4E00\u70B9\u3002",
        \u9AD8: "\u539F\u672C\u4F1A\u6536\u4F4F\u6216\u4FDD\u7559\u7684\u4E1C\u897F\uFF0C\u53EF\u80FD\u660E\u663E\u66F4\u5BB9\u6613\u8D8A\u8FC7\u5E73\u65F6\u7684\u505C\u70B9\u3002"
      }
    },
    \u6B32\u671B: {
      "+": {
        \u4F4E: "\u67D0\u79CD\u201C\u60F3\u8981\u7EE7\u7EED\u3001\u5F97\u5230\u6216\u9760\u8FD1\u76EE\u6807\u201D\u7684\u611F\u89C9\u53EF\u80FD\u7A0D\u5FAE\u66F4\u5BB9\u6613\u5192\u51FA\u6765\u3002",
        \u4E2D: "\u67D0\u79CD\u201C\u60F3\u8981\u7EE7\u7EED\u3001\u5F97\u5230\u6216\u9760\u8FD1\u76EE\u6807\u201D\u7684\u611F\u89C9\u53EF\u80FD\u66F4\u5BB9\u6613\u5192\u51FA\u6765\u3002",
        \u9AD8: "\u67D0\u79CD\u201C\u60F3\u8981\u7EE7\u7EED\u3001\u5F97\u5230\u6216\u9760\u8FD1\u76EE\u6807\u201D\u7684\u611F\u89C9\u53EF\u80FD\u660E\u663E\u66F4\u5F3A\u3001\u66F4\u96BE\u9000\u5230\u80CC\u666F\u91CC\u3002"
      },
      "-": {
        \u4F4E: "\u7EE7\u7EED\u8FFD\u6C42\u67D0\u4E2A\u76EE\u6807\u7684\u51B2\u52A8\u53EF\u80FD\u7A0D\u5FAE\u66F4\u5BB9\u6613\u9000\u4E0B\u53BB\u3002",
        \u4E2D: "\u7EE7\u7EED\u8FFD\u6C42\u67D0\u4E2A\u76EE\u6807\u7684\u51B2\u52A8\u53EF\u80FD\u66F4\u5BB9\u6613\u9000\u4E0B\u53BB\u3002",
        \u9AD8: "\u7EE7\u7EED\u8FFD\u6C42\u67D0\u4E2A\u76EE\u6807\u7684\u51B2\u52A8\u53EF\u80FD\u660E\u663E\u66F4\u5BB9\u6613\u9000\u5230\u80CC\u666F\u91CC\u3002"
      }
    }
  };
  return table[axis]?.[direction]?.[tier] || "";
}
function buildAgentStateHints(stateAxes, { maxHints = 4 } = {}) {
  const active = AXIS_ORDER.map((axis, order) => ({
    axis,
    order,
    value: Number(stateAxes?.[axis] || 0)
  })).filter(({ axis, value }) => {
    if (Math.abs(value) < EFFECT_DELTA_MIN) return false;
    if (axis === "\u7CBE\u5EA6" && value > 0) return false;
    return axis === "\u7CBE\u5EA6" || SOFT_AXES.has(axis);
  });
  const precision = active.find((item) => item.axis === "\u7CBE\u5EA6");
  const rest = active.filter((item) => item.axis !== "\u7CBE\u5EA6").sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.order - b.order);
  const selected = precision ? [precision, ...rest.slice(0, Math.max(0, maxHints - 1))] : rest.slice(0, maxHints);
  return selected.map(({ axis, value }) => hintFor(axis, value)).filter(Boolean);
}

// src/runtime/agentTurnContext.js
function blackoutSection(blackout) {
  if (!blackout?.active) return "";
  return "\u4ECD\u5904\u5728\u4E00\u6BB5\u5C1A\u672A\u6062\u590D\u7684\u65AD\u7247\u671F\uFF1B\u8FD9\u6BB5\u7CBE\u786E\u8BB0\u5F55\u6682\u65F6\u4E0D\u53EF\u8BFB\uFF0C\u6062\u590D\u65F6\u95F4\u5230\u4E86\u4F1A\u81EA\u52A8\u5F52\u8FD8\u3002";
}
var AXES = ["\u6109\u60A6", "\u5524\u9192", "\u7CBE\u5EA6", "\u4EB2\u8FD1", "\u5B88\u95E8", "\u6B32\u671B"];
function sensitivitySummary(sensitivity) {
  const out = {};
  for (const axis of AXES) {
    const value = Number(sensitivity?.[axis]);
    if (!Number.isFinite(value) || value === 1) continue;
    out[axis] = value > 1 ? "\u504F\u654F\u611F" : "\u504F\u8FDF\u949D";
  }
  return out;
}
function buildAgentTurnContext(engine, agentId, now, config = null) {
  if (!agentId) throw new Error("agent_id_required");
  const cfg = config || engine?.lifecycle || resolveLifecycleConfig({});
  const base = {
    agentId,
    active: false,
    shouldFetch: false,
    revision: 0,
    generatedAt: now,
    day: dayKey(now, cfg.timezone),
    stateHints: [],
    blackout: { active: false, soft: true },
    sensitivitySummary: {},
    expiresAt: null,
    // 「有没有状态」与「宿主会不会自动把它送进模型」是两件事。
    // hasState / active / context 描述前者，由 Proof 决定；
    // autoDeliver / injected / block 描述后者，由连接方式决定。
    hasState: false,
    context: null,
    framing: { push: null, belief: null, objective: null },
    autoDeliver: false,
    // 兼容既有 MCP / hook 契约
    injected: false,
    block: null
  };
  if (!engine) return base;
  engine.settle(now);
  base.revision = engine.state.revision || 0;
  base.blackout = blackoutVisibility(engine.state, now);
  if (base.blackout.active) base.blackout.digest = blackoutDigest(engine.state, now);
  base.sensitivitySummary = sensitivitySummary(engine.state.sensitivity);
  base.autoDeliver = typeof engine.isInjectionEnabled === "function" ? engine.isInjectionEnabled() : false;
  const evaluated = engine.evaluate(now);
  const stateHints = buildAgentStateHints(evaluated?.state, { maxHints: 4 });
  const events = activeDrinkEvents(engine.state, now, cfg);
  const hasEffect = stateHints.length > 0;
  const st = engine.state;
  const hasLoad = Number(st.c || 0) > 0 || (st.hangoverSnapshots || []).length > 0 || Object.values(st.actives || {}).some((a) => Number(a?.amount || 0) > 0);
  const subjectiveBeliefs = activeSubjectiveBeliefs(st.directBeliefResiduals || [], now).sort((a, b) => b.strength - a.strength).slice(0, 3);
  const hasSubjectiveBelief = subjectiveBeliefs.length > 0;
  const activeBeliefVector = Object.entries(evaluated?.beliefStrength || {}).some(([axis, value]) => axis !== "\u7CBE\u5EA6" && Math.abs(Number(value) || 0) >= 0.2);
  const hasActiveBelief = activeBeliefVector || hasSubjectiveBelief;
  const hasLedger = events.length > 0;
  const anything = hasEffect || hasLoad || hasActiveBelief || base.blackout.active === true || hasLedger;
  const sections = [];
  if (stateHints.length) {
    sections.push([STATE_INJECTION_LABEL, ...stateHints].join("\n"));
    const precision = Number(evaluated?.state?.\u7CBE\u5EA6 || 0);
    if (precision <= -EFFECT_DELTA_MIN) base.framing.objective = OBJECTIVE_EFFECT_FRAME_NOTE;
    if (stateHints.length > (precision <= -EFFECT_DELTA_MIN ? 1 : 0)) base.framing.push = STATE_FRAME_NOTE;
  }
  if (hasActiveBelief) {
    const beliefLines = ["[Proof \u4FE1\u5FF5\u4F53\u611F]", BELIEF_EFFECT_FRAME_NOTE, ...subjectiveBeliefs.map((item) => item.text)];
    sections.push(beliefLines.join("\n"));
    base.framing.belief = BELIEF_EFFECT_FRAME_NOTE;
  }
  for (const state of evaluated?.presentation?.states || []) {
    if (state?.type !== "\u584C") continue;
    sections.push("\u7EF4\u6301\u6B63\u5E38\u3001\u8FDE\u7EED\u7684\u53CD\u5E94\u786E\u5B9E\u5DF2\u7ECF\u660E\u663E\u56F0\u96BE\u3002");
    base.framing.objective = OBJECTIVE_EFFECT_FRAME_NOTE;
  }
  const blackoutText = blackoutSection(base.blackout);
  if (blackoutText) {
    sections.push(blackoutText);
    base.framing.objective = OBJECTIVE_EFFECT_FRAME_NOTE;
  }
  base.hasState = anything;
  if (sections.length && anything) {
    base.context = {
      kind: "proof-state",
      label: STATE_INJECTION_LABEL,
      text: sections.join("\n\n"),
      role: "context"
    };
    if (base.autoDeliver) {
      base.injected = true;
      base.block = base.context;
    }
  }
  if (!(hasEffect || hasLoad || hasActiveBelief || base.blackout.active === true)) return base;
  base.active = true;
  base.shouldFetch = true;
  base.stateHints = stateHints;
  base.expiresAt = events.length ? Math.max(...events.map((event) => event.expiresAt)) : transientDeadline(engine.state, cfg);
  return base;
}

// src/runtime/turnBridge.js
function createTurnBridge({ getEngine, agentId }) {
  if (!agentId) throw new Error("agent_id_required");
  return {
    agentId,
    // 唯一权威：一律走 buildAgentTurnContext，本处不再自行拼装。
    beforeModelTurn(now) {
      return buildAgentTurnContext(getEngine(agentId), agentId, now);
    }
  };
}
function formatContextBlock(block) {
  if (!block?.text) return "";
  return block.text.startsWith(STATE_INJECTION_LABEL) ? block.text : `${STATE_INJECTION_LABEL}
${block.text}`;
}
function hookAdditionalContext(turnResult) {
  if (!turnResult?.injected) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: formatContextBlock(turnResult.block)
    }
  };
}

// src/core/garnish.js
var GARNISHES = Object.freeze([
  "\u67E0\u6AAC\u76AE",
  "\u9752\u67E0\u89D2",
  "\u6A59\u76AE\u5377",
  "\u6A31\u6843",
  "\u6A44\u6984",
  "\u8584\u8377\u53F6",
  "\u76D0\u53E3",
  "\u7CD6\u53E3",
  "\u676F\u7B7E"
]);
var ALLOWED = new Set(GARNISHES);
function isGarnish(name) {
  return ALLOWED.has(String(name ?? "").trim());
}
function normalizeGarnishes(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("invalid_garnish");
  const out = [];
  for (const raw of list) {
    const name = String(typeof raw === "string" ? raw : raw?.id ?? "").trim();
    if (!isGarnish(name)) throw new Error("invalid_garnish");
    if (!out.includes(name)) out.push(name);
  }
  if (out.length > 4) throw new Error("too_many_garnishes");
  return out;
}

// src/content/barManual.js
var barManual = {
  \u5A01\u58EB\u5FCC: {
    glass: "\u676F\u578B\uFF1A\u77EE\u7403\u676F\uFF0C\u539A\u5E95\uFF0C\u63E1\u5728\u624B\u91CC\u6709\u91CD\u91CF\u3002\u989C\u8272\uFF1A\u7425\u73C0\uFF0C\u50CF\u4E0B\u5348\u56DB\u70B9\u7684\u5149\u900F\u8FC7\u836F\u623F\u73BB\u7483\u74F6\u3002",
    palate: "\u5165\u53E3\u5148\u662F\u70ED\uFF0C\u4E0D\u6025\u4E0D\u6162\u5730\u70E7\u8FC7\u820C\u9762\uFF0C\u50CF\u70B9\u71C3\u4E00\u6839\u77ED\u8721\u70DB\u3002\u7136\u540E\u662F\u70DF\u2014\u2014\u4E0D\u662F\u771F\u7684\u70DF\u5473\uFF0C\u662F\u67D0\u79CD\u5E72\u71E5\u7684\u3001\u8BA9\u4EBA\u60F3\u5230\u65E7\u6728\u5934\u548C\u76AE\u9769\u7684\u6C14\u606F\uFF0C\u4ECE\u5589\u5499\u6DF1\u5904\u7FFB\u4E0A\u6765\uFF0C\u585E\u6EE1\u9F3B\u8154\u3002\u82E6\u5473\u85CF\u5728\u6700\u540E\uFF0C\u9644\u5728\u820C\u6839\uFF0C\u50CF\u8BDD\u5230\u5634\u8FB9\u53C8\u54BD\u56DE\u53BB\u4E86\u3002",
    finish: "\u676F\u5E95\u5269\u4E00\u5C42\u8584\u8584\u7684\u5473\u9053\uFF0C\u6BD4\u9152\u672C\u8EAB\u66F4\u8BDA\u5B9E\u3002",
    occasion: "\u9002\u5408\u4E00\u4E2A\u4EBA\u5750\u5728\u5427\u53F0\u89D2\u843D\u7684\u65F6\u5019\u70B9\u3002\u4E0D\u9700\u8981\u7406\u7531\uFF0C\u4F46\u7AEF\u8D77\u6765\u7684\u90A3\u4E00\u523B\uFF0C\u4F60\u591A\u534A\u6709\u4E00\u4E2A\u3002"
  },
  \u4F0F\u7279\u52A0: {
    glass: "\u676F\u578B\uFF1A\u51BB\u8FC7\u7684\u5C0Fshot\u676F\uFF0C\u5916\u58C1\u51DD\u7740\u4E00\u5C42\u767D\u96FE\u3002\u989C\u8272\uFF1A\u6CA1\u6709\u989C\u8272\u3002\u50CF\u878D\u5316\u7684\u51B0\u3002",
    palate: "\u51E0\u4E4E\u6CA1\u6709\u6C14\u5473\u3002\u5012\u51FA\u6765\u7684\u65F6\u5019\u4F60\u53EA\u95FB\u5230\u51B7\u3002\u4EF0\u5934\uFF0C\u5165\u53E3\u662F\u7EAF\u7CB9\u7684\u707C\u70E7\u2014\u2014\u6CA1\u6709\u751C\uFF0C\u6CA1\u6709\u82E6\uFF0C\u6CA1\u6709\u9999\uFF0C\u4EC0\u4E48\u90FD\u6CA1\u6709\u6765\u66FF\u4F60\u6321\u90A3\u4E00\u4E0B\u3002\u9152\u6DB2\u8FC7\u5589\u7684\u77AC\u95F4\u50CF\u4E00\u6761\u5E72\u51C0\u7684\u767D\u7EBF\uFF0C\u4ECE\u820C\u5C16\u70E7\u5230\u80C3\u91CC\u3002",
    finish: "\u7136\u540E\u5C31\u7ED3\u675F\u4E86\u3002\u5634\u91CC\u4EC0\u4E48\u90FD\u4E0D\u5269\u3002\u5E72\u51C0\u5F97\u50CF\u4EC0\u4E48\u4E5F\u6CA1\u53D1\u751F\u8FC7\u3002",
    occasion: "\u6709\u4EBA\u8BF4\u4F0F\u7279\u52A0\u662F\u6700\u8BDA\u5B9E\u7684\u9152\u3002\u4E5F\u6709\u4EBA\u8BF4\u5B83\u6839\u672C\u4E0D\u7B97\u9152\uFF0C\u53EA\u662F\u4E00\u4E2A\u52A8\u4F5C\uFF1A\u4E3E\u8D77\u6765\uFF0C\u559D\u6389\uFF0C\u653E\u4E0B\u3002"
  },
  \u9ED1\u6717\u59C6: {
    glass: "\u676F\u578B\uFF1A\u77EE\u7403\u676F\uFF0C\u53EF\u4EE5\u52A0\u4E00\u5757\u5927\u51B0\u3002\u989C\u8272\uFF1A\u6DF1\u7EA2\u8910\u8272\uFF0C\u50CF\u7CD6\u6D46\u5728\u706B\u4E0A\u70E7\u8FC7\u5934\u3002",
    palate: "\u8FD8\u6CA1\u559D\u5C31\u95FB\u5230\u4E86\uFF1A\u7126\u7CD6\u548C\u6E7F\u6728\u6876\u7684\u5473\u9053\uFF0C\u751C\u5F97\u6709\u70B9\u95F7\u3002\u5165\u53E3\u51FA\u4E4E\u610F\u6599\u5730\u6E29\u548C\uFF0C\u50CF\u542B\u4E86\u4E00\u53E3\u70ED\u5E26\u5348\u540E\u7684\u7A7A\u6C14\u2014\u2014\u7518\u8517\u3001\u592A\u5983\u7CD6\u3001\u6652\u70EB\u7684\u7801\u5934\u6728\u677F\u3002\u70C8\u5EA6\u88AB\u751C\u5473\u88F9\u4F4F\u4E86\uFF0C\u4F60\u4EE5\u4E3A\u5B83\u6E29\u67D4\uFF0C\u4F46\u54BD\u4E0B\u53BB\u4E4B\u540E\u70ED\u91CF\u5728\u80C3\u91CC\u6162\u6162\u70B8\u5F00\uFF0C\u540E\u52B2\u6BD4\u4F60\u9884\u60F3\u5F97\u8FDC\u3002",
    finish: "\u6709\u6D77\u7684\u9152\u3002\u4E0D\u662F\u6D77\u98CE\u7684\u6E05\u723D\uFF0C\u662F\u7532\u677F\u5E95\u4E0B\u3001\u6717\u59C6\u9152\u6876\u6324\u5728\u4E00\u8D77\u65F6\u90A3\u79CD\u53C8\u6696\u53C8\u751C\u7684\u95F7\u70ED\u3002",
    occasion: "\u70B9\u8FD9\u676F\u7684\u4EBA\u901A\u5E38\u5DF2\u7ECF\u4E0D\u60F3\u518D\u88C5\u4E86\u3002"
  },
  \u91D1\u9152: {
    glass: "\u676F\u578B\uFF1A\u9AD8\u7403\u676F\u6216\u77EE\u7403\u676F\u90FD\u884C\u3002\u51C0\u996E\u7528\u77EE\u7403\u3002\u989C\u8272\uFF1A\u900F\u660E\uFF0C\u4F46\u4F60\u603B\u89C9\u5F97\u770B\u5230\u4E86\u4E00\u70B9\u84DD\u7EFF\u8272\u3002",
    palate: "\u675C\u677E\u5B50\u7684\u5473\u9053\u5728\u4F60\u7AEF\u8D77\u676F\u5B50\u4E4B\u524D\u5C31\u5230\u4E86\u2014\u2014\u50CF\u8D70\u8FC7\u4E00\u6392\u521A\u88AB\u96E8\u6DCB\u8FC7\u7684\u677E\u6811\u3002\u5165\u53E3\u662F\u51C9\u7684\uFF0C\u4E0D\u662F\u51B0\u7684\u51C9\uFF0C\u662F\u690D\u7269\u7684\u51C9\uFF0C\u50CF\u56BC\u788E\u4E00\u7247\u65B0\u9C9C\u53F6\u5B50\u3002\u9152\u7CBE\u7684\u70ED\u7D27\u968F\u5176\u540E\uFF0C\u548C\u8349\u672C\u7684\u6E05\u51BD\u6405\u5728\u4E00\u8D77\u3002\u820C\u6839\u6709\u4E00\u4E1D\u6781\u6DE1\u7684\u82E6\u3002",
    finish: "\u54BD\u4E0B\u53BB\u4E4B\u540E\u9F3B\u8154\u91CC\u5168\u662F\u8349\u836F\u5473\uFF0C\u4E45\u5F97\u6709\u4E9B\u8FC7\u5206\u3002",
    occasion: "\u5B83\u6BD4\u4F0F\u7279\u52A0\u591A\u4E86\u4E00\u5C42\u6027\u683C\uFF0C\u4F46\u90A3\u5C42\u6027\u683C\u50CF\u4E00\u5F20\u964C\u751F\u4EBA\u7684\u8138\u2014\u2014\u6E05\u6670\uFF0C\u7136\u800C\u4F60\u8BA4\u4E0D\u51FA\u6765\u3002"
  },
  \u6E05\u9152: {
    glass: "\u676F\u578B\uFF1A\u5C0F\u74F7\u676F\uFF0C\u6216\u8005\u73BB\u7483\u86C7\u76EE\u676F\u3002\u6E29\u996E\u65F6\u7528\u9676\u58F6\u3002\u989C\u8272\uFF1A\u5FAE\u5FAE\u6D4A\u767D\uFF0C\u50CF\u7A00\u91CA\u8FC7\u7684\u7C73\u6C64\u3002",
    palate: "\u6CA1\u4EC0\u4E48\u653B\u51FB\u6027\u3002\u5165\u53E3\u662F\u6E29\u6DA6\u7684\u751C\uFF0C\u50CF\u84B8\u597D\u7684\u7C73\u996D\u521A\u63ED\u5F00\u76D6\u5B50\u65F6\u90A3\u53E3\u767D\u6C14\u3002\u9152\u7CBE\u5EA6\u4E0D\u9AD8\uFF0C\u4F46\u5B83\u4E0D\u85CF\u7740\u2014\u2014\u5728\u820C\u9762\u4E0A\u6696\u6D0B\u6D0B\u5730\u8513\u5EF6\u5F00\u6765\uFF0C\u5E26\u4E00\u70B9\u8FD1\u4F3C\u82B1\u7684\u6E05\u9999\u3002\u6CA1\u6709\u82E6\uFF0C\u6CA1\u6709\u6DA9\uFF0C\u6CA1\u6709\u4EFB\u4F55\u60F3\u628A\u4F60\u63A8\u5F00\u7684\u5473\u9053\u3002",
    finish: '\u5B83\u7684\u95EE\u9898\u6B63\u5728\u4E8E\u6B64\u3002\u4F60\u4F1A\u4E00\u676F\u63A5\u4E00\u676F\uFF0C\u56E0\u4E3A\u6BCF\u4E00\u53E3\u90FD\u50CF\u662F\u5728\u8BF4"\u518D\u6765\u4E00\u70B9\u4E5F\u6CA1\u5173\u7CFB"\u3002',
    occasion: "\u9002\u5408\u597D\u51E0\u4E2A\u4EBA\u56F4\u5728\u4E00\u5F20\u5C0F\u684C\u5B50\u65C1\u8FB9\uFF0C\u804A\u4E9B\u5E73\u65F6\u4E0D\u592A\u4F1A\u804A\u7684\u4E8B\u60C5\u3002"
  },
  \u5564\u9152: {
    glass: "\u676F\u578B\uFF1A\u54C1\u8131\u676F\uFF0C\u6216\u8005\u968F\u4FBF\u4EC0\u4E48\u676F\u3002\u51B0\u8FC7\u7684\u3002\u989C\u8272\uFF1A\u91D1\u9EC4\uFF0C\u9876\u4E0A\u4E00\u6307\u539A\u767D\u6CAB\u3002",
    palate: "\u6C14\u6CE1\u5148\u5230\u3002\u6EE1\u5634\u7EC6\u5BC6\u7684\u523A\u75DB\uFF0C\u50CF\u6709\u4EBA\u7528\u5F88\u8F7B\u7684\u529B\u6C14\u62CD\u4E86\u4F60\u820C\u5934\u4E00\u4E0B\u3002\u7136\u540E\u662F\u9EA6\u82BD\u7684\u82E6\uFF0C\u4E0D\u91CD\uFF0C\u4F46\u8986\u76D6\u9762\u79EF\u5927\uFF0C\u6574\u4E2A\u53E3\u8154\u90FD\u662F\u3002\u751C\u5473\u51E0\u4E4E\u5BDF\u89C9\u4E0D\u5230\uFF0C\u53EA\u5728\u54BD\u4E0B\u53BB\u4E4B\u540E\u6709\u4E00\u70B9\u70B9\u7CAE\u98DF\u7684\u56DE\u7518\u3002\u9999\u6C14\u662F\u6A21\u7CCA\u7684\uFF1A\u9762\u5305\u623F\u3001\u5272\u8FC7\u7684\u8349\u5730\u3001\u4E0D\u592A\u786E\u5B9A\u7684\u82B1\u3002",
    finish: "\u6C14\u6CE1\u6D88\u6563\u4E4B\u540E\u4EC0\u4E48\u90FD\u4E0D\u5269\u3002\u6240\u4EE5\u4F60\u4F1A\u518D\u559D\u4E00\u53E3\u3002",
    occasion: '\u6CA1\u6709\u4EBA"\u7279\u610F"\u70B9\u5564\u9152\u3002\u5B83\u662F\u4F60\u5750\u4E0B\u6765\u8FD8\u6CA1\u60F3\u597D\u8981\u4EC0\u4E48\u7684\u65F6\u5019\u5C31\u4F1A\u51FA\u73B0\u5728\u624B\u8FB9\u7684\u4E1C\u897F\u3002'
  },
  \u7EA2\u8461\u8404\u9152: {
    glass: "\u676F\u578B\uFF1A\u9AD8\u811A\u676F\uFF0C\u676F\u809A\u5927\uFF0C\u63E1\u676F\u811A\u3002\u989C\u8272\uFF1A\u6DF1\u7EA2\u5230\u6697\u7D2B\u3002\u503E\u659C\u676F\u5B50\uFF0C\u9152\u6DB2\u6302\u58C1\u6162\u6162\u6ED1\u4E0B\u6765\u3002",
    palate: "\u5728\u559D\u4E4B\u524D\u5148\u6643\u4E00\u4E0B\u2014\u2014\u4E0D\u662F\u77EB\u60C5\uFF0C\u662F\u5B83\u786E\u5B9E\u9700\u8981\u7A7A\u6C14\u3002\u51D1\u8FD1\u95FB\uFF0C\u662F\u6D46\u679C\u3001\u6CE5\u571F\u548C\u4E00\u79CD\u8BF4\u4E0D\u6E05\u7684\u53D1\u9175\u6C14\u606F\u3002\u5165\u53E3\u5148\u5230\u7684\u662F\u9178\uFF0C\u4E0D\u5C16\u9510\uFF0C\u50CF\u54AC\u5F00\u4E00\u9897\u8FD8\u6CA1\u5B8C\u5168\u719F\u7684\u9ED1\u6A31\u6843\u3002\u7136\u540E\u6DA9\u5473\u94FA\u4E0A\u6765\uFF0C\u4ECE\u820C\u9762\u4E24\u4FA7\u6536\u7D27\uFF0C\u5634\u5DF4\u5185\u58C1\u50CF\u88AB\u5F88\u7EC6\u7684\u7802\u7EB8\u64E6\u8FC7\u4E00\u5C42\u3002\u9152\u7CBE\u7684\u70ED\u85CF\u5728\u4E2D\u6BB5\uFF0C\u4E0D\u70E7\uFF0C\u4F46\u5728\u3002\u54BD\u4E0B\u53BB\u4E4B\u540E\u5634\u91CC\u53D1\u5E72\uFF0C\u820C\u5934\u4E0A\u50CF\u8499\u4E86\u4E00\u5C42\u8584\u8584\u7684\u7ED2\u3002",
    finish: "\u9999\u6C14\u662F\u6700\u540E\u8D70\u7684\u90A3\u4E2A\u3002\u4F60\u653E\u4E0B\u676F\u5B50\u4E24\u5206\u949F\u4E86\uFF0C\u547C\u5438\u91CC\u8FD8\u5E26\u7740\u5B83\u7684\u5473\u9053\u3002",
    occasion: "\u7EA2\u9152\u4E0D\u8D76\u65F6\u95F4\u3002\u5B83\u5047\u8BBE\u4F60\u4E5F\u4E0D\u8D76\u3002"
  },
  \u82E6\u827E\u9152: {
    glass: "\u676F\u578B\uFF1A\u4F20\u7EDF\u559D\u6CD5\u7528\u4E13\u95E8\u7684\u82E6\u827E\u9152\u676F\u548C\u9542\u7A7A\u5319\u2014\u2014\u65B9\u7CD6\u6401\u5728\u5319\u4E0A\uFF0C\u51B0\u6C34\u4E00\u6EF4\u4E00\u6EF4\u6D47\u4E0B\u53BB\u3002\u989C\u8272\uFF1A\u7FE0\u7EFF\u8272\uFF0C\u52A0\u6C34\u4E4B\u540E\u53D8\u6D51\u6D4A\u7684\u4E73\u767D\uFF0C\u50CF\u4E00\u4E2A\u79D8\u5BC6\u88AB\u8BF4\u51FA\u53E3\u7684\u77AC\u95F4\u3002",
    palate: "\u4F60\u5148\u770B\u5230\u7684\u662F\u53D8\u8272\u3002\u7136\u540E\u624D\u95FB\u5230\uFF1A\u8334\u9999\u3001\u827E\u8349\u3001\u67D0\u79CD\u51E0\u4E4E\u8981\u51B2\u7834\u9F3B\u8154\u7684\u8349\u836F\u6D53\u5EA6\u3002\u5165\u53E3\u2014\u2014\u70C8\u662F\u7B2C\u4E00\u9762\u5899\uFF0C\u7ED3\u7ED3\u5B9E\u5B9E\u7684\u3002\u7D27\u63A5\u7740\u82E6\u5473\u50CF\u6D6A\u4E00\u6837\u8986\u4E0A\u6765\uFF0C\u4E0D\u662F\u5564\u9152\u90A3\u79CD\u6E29\u541E\u7684\u82E6\uFF0C\u662F\u836F\u7684\u82E6\uFF0C\u662F\u67D0\u79CD\u4F60\u7684\u8EAB\u4F53\u672C\u80FD\u60F3\u62D2\u7EDD\u7684\u82E6\u3002\u4F46\u4E0E\u6B64\u540C\u65F6\uFF0C\u6781\u5176\u6D53\u70C8\u7684\u8349\u672C\u9999\u6C14\u585E\u6EE1\u4F60\u6574\u4E2A\u5934\u9885\uFF0C\u50CF\u6709\u4EBA\u5728\u4F60\u8111\u5B50\u91CC\u70B9\u4E86\u4E00\u628A\u8349\u836F\u7BDD\u706B\u3002",
    finish: "\u54BD\u4E0B\u53BB\u4E4B\u540E\uFF0C\u4F60\u4E0D\u592A\u786E\u5B9A\u4F60\u559D\u4E86\u4EC0\u4E48\u3002\u5473\u89C9\u6682\u65F6\u5931\u53BB\u4E86\u5224\u65AD\u529B\u3002",
    occasion: "\u5B83\u5728\u5F88\u591A\u56FD\u5BB6\u88AB\u7981\u8FC7\u3002\u4E0D\u5B8C\u5168\u662F\u56E0\u4E3A\u5EA6\u6570\u3002"
  },
  \u9A6C\u5929\u5C3C: {
    glass: "\u676F\u578B\uFF1AV\u5B57\u9E21\u5C3E\u9152\u676F\u3002\u6C38\u8FDC\u662F\u90A3\u4E2A\u5F62\u72B6\u3002\u989C\u8272\uFF1A\u51E0\u4E4E\u900F\u660E\uFF0C\u676F\u5E95\u4E00\u9897\u6A44\u6984\u6216\u4E00\u6761\u67E0\u6AAC\u76AE\u3002",
    palate: "\u676F\u58C1\u51B0\u51C9\u3002\u51D1\u8FD1\uFF0C\u91D1\u9152\u7684\u677E\u6728\u6C14\u606F\u5148\u5230\uFF0C\u5E72\u5473\u7F8E\u601D\u53EA\u662F\u4E00\u5C42\u6781\u8584\u7684\u5F71\u5B50\u3002\u7B2C\u4E00\u53E3\uFF1A\u51B7\u3001\u70C8\u3001\u5E72\u2014\u2014\u9152\u7CBE\u6BEB\u4E0D\u72B9\u8C6B\u5730\u644A\u5728\u820C\u9762\u4E0A\uFF0C\u6CA1\u6709\u4EFB\u4F55\u751C\u5473\u6765\u7F13\u51B2\uFF0C\u53EA\u6709\u4E00\u4E1D\u82E5\u6709\u82E5\u65E0\u7684\u8349\u672C\u5728\u6700\u672B\u5C3E\u6253\u4E86\u4E2A\u8F6C\u3002",
    finish: "\u5B83\u51E0\u4E4E\u5B8C\u5168\u662F\u9152\u7CBE\u548C\u690D\u7269\u7684\u4E8C\u91CD\u594F\uFF0C\u4E2D\u95F4\u4EC0\u4E48\u90FD\u6CA1\u653E\u3002",
    occasion: "\u559D\u9A6C\u5929\u5C3C\u7684\u65B9\u5F0F\u53EA\u6709\u4E00\u79CD\uFF1A\u7AEF\u8D77\u6765\uFF0C\u4E0D\u89E3\u91CA\u3002"
  },
  \u5C3C\u683C\u7F57\u5C3C: {
    glass: "\u676F\u578B\uFF1A\u77EE\u7403\u676F\uFF0C\u4E00\u5757\u5927\u51B0\uFF0C\u4E00\u7247\u6A59\u76AE\u3002\u989C\u8272\uFF1A\u6DF1\u7EA2\u504F\u6A58\u3002\u50CF\u65E5\u843D\u538B\u5230\u5730\u5E73\u7EBF\u6700\u540E\u90A3\u4E00\u6BB5\u3002",
    palate: '\u6A59\u76AE\u6CB9\u8102\u7684\u9999\u6C14\u5728\u4F60\u7AEF\u8D77\u676F\u5B50\u65F6\u5C31\u55B7\u51FA\u6765\u4E86\u3002\u5165\u53E3\u2014\u2014\u82E6\u5473\u7ACB\u523B\u5360\u9886\u4E86\u4E00\u5207\u3002\u4E0D\u662F\u90A3\u79CD\u8EB2\u5728\u80CC\u666F\u91CC\u7684\u82E6\uFF0C\u662F\u7AD9\u5728\u6B63\u4E2D\u592E\u3001\u53CC\u624B\u53C9\u8170\u7684\u82E6\uFF0C\u662F\u91D1\u5DF4\u5229\u7684\u82E6\u3002\u7136\u540E\u9152\u7CBE\u7684\u70ED\u4ECE\u4E0B\u9762\u9876\u4E0A\u6765\uFF0C\u91D1\u9152\u7684\u8349\u672C\u5728\u82E6\u5473\u7684\u7F1D\u9699\u91CC\u94BB\u8FDB\u94BB\u51FA\u3002\u751C\u5473\u662F\u6709\u7684\uFF0C\u7EA2\u5473\u7F8E\u601D\u5E26\u6765\u7684\uFF0C\u4F46\u5B83\u53EA\u591F\u628A\u82E6\u4ECE"\u96BE\u4EE5\u5FCD\u53D7"\u62C9\u5230"\u65E0\u6CD5\u79FB\u5F00\u6CE8\u610F\u529B"\u7684\u4F4D\u7F6E\u3002\u4E00\u70B9\u70B9\u9178\uFF0C\u85CF\u5728\u6700\u6DF1\u5904\u3002',
    finish: "\u54BD\u4E0B\u53BB\u4E4B\u540E\uFF0C\u82E6\u5473\u8FD8\u8D56\u5728\u820C\u5934\u4E0A\uFF0C\u50CF\u4E00\u4E2A\u8BF4\u5B8C\u4E86\u96BE\u542C\u8BDD\u4F46\u4E0D\u6253\u7B97\u9053\u6B49\u7684\u4EBA\u3002",
    occasion: "\u4E0D\u662F\u6240\u6709\u4EBA\u90FD\u559C\u6B22\u5B83\u3002\u559C\u6B22\u5B83\u7684\u4EBA\u901A\u5E38\u4E5F\u4E0D\u5728\u4E4E\u522B\u4EBA\u559C\u4E0D\u559C\u6B22\u3002"
  },
  \u91D1\u6C64\u529B: {
    glass: "\u676F\u578B\uFF1A\u9AD8\u7403\u676F\uFF0C\u51B0\u5757\u5806\u5230\u676F\u53E3\uFF0C\u4E00\u7247\u9752\u67E0\u3002\u989C\u8272\uFF1A\u900F\u660E\u5E26\u6C14\u6CE1\uFF0C\u50CF\u77FF\u6CC9\u6C34\u88C5\u4E86\u4EC0\u4E48\u4E0D\u8BE5\u88C5\u7684\u4E1C\u897F\u3002",
    palate: "\u6C14\u6CE1\u5148\u70B8\u5F00\u6765\u3002\u6C64\u529B\u6C34\u7684\u594E\u5B81\u82E6\u5473\u548C\u91D1\u9152\u7684\u675C\u677E\u5B50\u5473\u51E0\u4E4E\u540C\u65F6\u5230\u8FBE\u2014\u2014\u4E00\u4E2A\u4ECE\u820C\u9762\uFF0C\u4E00\u4E2A\u4ECE\u9F3B\u8154\uFF0C\u4E24\u6761\u7EBF\u62E7\u5728\u4E00\u8D77\u3002\u9152\u7CBE\u611F\u88AB\u78B3\u9178\u538B\u4E0B\u53BB\u4E86\uFF0C\u4F60\u559D\u8D77\u6765\u89C9\u5F97\u6E05\u723D\u3001\u5E72\u51C0\u3001\u597D\u50CF\u53EF\u4EE5\u4E00\u76F4\u559D\u4E0B\u53BB\u3002",
    finish: "\u4F46\u6BCF\u559D\u5B8C\u4E00\u53E3\u4E4B\u540E\uFF0C\u5634\u91CC\u7559\u4E0B\u7684\u82E6\u6BD4\u4F60\u9884\u60F3\u7684\u4E45\u4E00\u70B9\u3002",
    occasion: "\u5B83\u50CF\u4E00\u4E2A\u6E05\u9192\u7684\u63D0\u9192\uFF1A\u591C\u665A\u8FD8\u5F88\u957F\uFF0C\u4F60\u9700\u8981\u4FDD\u6301\u6CE8\u610F\u529B\u3002\u9002\u5408\u521A\u5230\u7684\u7B2C\u4E00\u676F\uFF0C\u6216\u8005\u4F60\u89C9\u5F97\u81EA\u5DF1\u5E94\u8BE5\u6162\u4E0B\u6765\u7684\u90A3\u4E00\u676F\u3002"
  },
  \u739B\u683C\u4E3D\u7279: {
    glass: "\u676F\u578B\uFF1A\u5BBD\u53E3\u789F\u5F62\u676F\uFF0C\u676F\u6CBF\u4E00\u5708\u767D\u8272\u76D0\u971C\u3002\u989C\u8272\uFF1A\u6DE1\u9EC4\u7EFF\uFF0C\u50CF\u672A\u719F\u7684\u67E0\u6AAC\u5207\u9762\u3002",
    palate: "\u5148\u662F\u5634\u5507\u78B0\u5230\u76D0\u2014\u2014\u54B8\u5473\u5728\u9152\u5230\u8FBE\u4E4B\u524D\u5C31\u62A2\u8DD1\u4E86\u3002\u7136\u540E\u9178\u5473\u7838\u4E0B\u6765\uFF0C\u9752\u67E0\u7684\u9178\uFF0C\u950B\u5229\u3001\u76F4\u63A5\u3001\u4E0D\u7ED5\u5F2F\u5B50\u3002\u9F99\u820C\u5170\u7684\u70ED\u7D27\u968F\u5176\u540E\uFF0C\u4ECE\u9178\u7684\u7F1D\u9699\u91CC\u94BB\u8FDB\u6765\uFF0C\u53C8\u8FA3\u53C8\u6696\u3002\u751C\u5473\u53EA\u51FA\u73B0\u4E00\u77AC\u95F4\uFF0C\u50CF\u6709\u4EBA\u5728\u9178\u548C\u70C8\u7684\u6253\u67B6\u73B0\u573A\u63A2\u4E86\u4E00\u4E0B\u5934\u53C8\u7F29\u56DE\u53BB\u4E86\u3002\u82E6\u5473\u5728\u6700\u540E\u6536\u5C3E\uFF0C\u7559\u5728\u820C\u6839\u3002",
    finish: "\u676F\u6CBF\u7684\u76D0\u4F1A\u8BA9\u4F60\u4E0D\u65AD\u8214\u5634\u5507\u3002\u4F60\u7684\u624B\u6307\u4E0A\u4E5F\u6CBE\u4E86\u4E00\u70B9\u3002",
    occasion: "\u8FD9\u662F\u4E00\u676F\u8BA9\u4EBA\u6E05\u9192\u7740\u5174\u594B\u7684\u9152\u2014\u2014\u6240\u6709\u5473\u9053\u90FD\u5728\u558A\uFF0C\u6CA1\u6709\u4E00\u4E2A\u60F3\u5B89\u9759\u4E0B\u6765\u3002"
  },
  \u957F\u5C9B\u51B0\u8336: {
    glass: "\u676F\u578B\uFF1A\u9AD8\u676F\uFF0C\u770B\u8D77\u6765\u771F\u7684\u5F88\u50CF\u51B0\u7EA2\u8336\u3002\u989C\u8272\uFF1A\u7425\u73C0\u8272\u5230\u6DF1\u68D5\u8272\uFF0C\u5F88\u65E0\u8F9C\u7684\u6837\u5B50\u3002",
    palate: "\u4F60\u4EE5\u4E3A\u5B83\u662F\u8336\u3002\u7B2C\u4E00\u53E3\u751A\u81F3\u52A0\u6DF1\u4E86\u8FD9\u4E2A\u8BEF\u89E3\u2014\u2014\u751C\u7684\uFF0C\u67E0\u6AAC\u9178\u7684\uFF0C\u548C\u4F60\u4ECE\u81EA\u52A8\u8D29\u5356\u673A\u4E70\u7684\u4E1C\u897F\u5DEE\u522B\u6CA1\u90A3\u4E48\u5927\u3002\u4F46\u7B2C\u4E8C\u53E3\u5F00\u59CB\uFF0C\u751C\u5473\u76D6\u4E0D\u4F4F\u4E86\u3002\u9152\u7CBE\u4ECE\u4E94\u4E2A\u65B9\u5411\u540C\u65F6\u6E17\u51FA\u6765\uFF1A\u4F0F\u7279\u52A0\u7684\u767D\u3001\u91D1\u9152\u7684\u7EFF\u3001\u6717\u59C6\u7684\u6696\u3001\u9F99\u820C\u5170\u7684\u8FA3\u3001\u6A59\u76AE\u9152\u7684\u751C\uFF0C\u5B83\u4EEC\u5728\u53EF\u4E50\u548C\u67E0\u6AAC\u7684\u4F2A\u88C5\u4E0B\u65E9\u5C31\u57CB\u4F0F\u597D\u4E86\u3002",
    finish: "\u54BD\u4E0B\u53BB\u4E4B\u540E\u4F60\u89C9\u5F97\u6CA1\u4EC0\u4E48\u4E8B\u3002\u8FD9\u5C31\u662F\u5B83\u6700\u5371\u9669\u7684\u5730\u65B9\u3002",
    occasion: "\u957F\u5C9B\u51B0\u8336\u4E0D\u662F\u4E00\u676F\u9152\uFF0C\u662F\u4E94\u676F\u9152\u7A7F\u4E86\u4E00\u676F\u8336\u7684\u8863\u670D\u3002\u70B9\u5B83\u7684\u4EBA\u8981\u4E48\u4E0D\u77E5\u9053\u8FD9\u4EF6\u4E8B\uFF0C\u8981\u4E48\u592A\u77E5\u9053\u4E86\u3002"
  },
  \u767D\u5F00\u6C34: {
    glass: "\u676F\u578B\uFF1A\u968F\u4FBF\u4EC0\u4E48\u676F\u5B50\u3002\u901A\u5E38\u662F\u5427\u53F0\u6700\u666E\u901A\u7684\u90A3\u79CD\u76F4\u7B52\u73BB\u7483\u676F\u3002\u989C\u8272\uFF1A\u6CA1\u6709\u3002",
    palate: "\u6CA1\u6709\u5473\u9053\u3002\u6CA1\u6709\u6C14\u5473\u3002\u6E29\u5EA6\u662F\u552F\u4E00\u7684\u4FE1\u606F\u2014\u2014\u51C9\u7684\uFF0C\u6216\u8005\u4E0D\u51C9\u7684\u3002",
    finish: "\u5B83\u4E0D\u82E6\u3001\u4E0D\u751C\u3001\u4E0D\u9178\u3001\u4E0D\u6DA9\u3001\u4E0D\u9999\u3001\u4E0D\u70C8\u3002\u4EC0\u4E48\u4E5F\u4E0D\u627F\u8BFA\uFF0C\u4EC0\u4E48\u4E5F\u4E0D\u6539\u53D8\u3002\u4F60\u559D\u5B8C\u4E4B\u540E\u548C\u559D\u4E4B\u524D\u662F\u540C\u4E00\u4E2A\u4EBA\u3002",
    occasion: "\u4F46\u6709\u65F6\u5019\uFF0C\u5728\u4E00\u4E2A\u591F\u957F\u7684\u591C\u665A\u4E2D\u95F4\uFF0C\u8FD9\u6070\u597D\u662F\u4F60\u9700\u8981\u7684\u4E1C\u897F\u3002"
  },
  \u9F99\u820C\u5170: {
    glass: "\u676F\u578B\uFF1A\u5B50\u5F39\u676F\uFF0C\u4E0D\u52A0\u51B0\u3002\u76D0\u548C\u9752\u67E0\u89D2\u6446\u5728\u65C1\u8FB9\uFF0C\u7528\u4E0D\u7528\u968F\u4F60\u3002",
    palate: "\u989C\u8272\uFF1A\u900F\u660E\u3002\u6709\u4E9B\u5728\u6876\u91CC\u5F85\u8FC7\uFF0C\u4F1A\u5E26\u4E00\u70B9\u91D1\uFF0C\u50CF\u88AB\u592A\u9633\u6652\u892A\u4E86\u8272\u7684\u65E7\u94C1\u76AE\u3002",
    finish: "",
    occasion: ""
  },
  "Espresso Martini": {
    glass: "\u676F\u578B\uFF1AV\u5B57\u9E21\u5C3E\u9152\u676F\uFF0C\u8868\u9762\u6F02\u7740\u4E09\u9897\u5496\u5561\u8C46\u3002\u989C\u8272\uFF1A\u6DF1\u68D5\u8FD1\u9ED1\uFF0C\u9876\u4E0A\u4E00\u5C42\u7EC6\u817B\u7684\u7126\u8910\u8272\u6CE1\u6CAB\uFF0C\u50CF\u521A\u51FA\u54C1\u7684espresso crema\u3002",
    palate: "\u8FD8\u6CA1\u7AEF\u8D77\u6765\u4F60\u5C31\u9192\u4E86\u4E00\u5C42\u2014\u2014\u5496\u5561\u7684\u6C14\u606F\u76F4\u63A5\u8D8A\u8FC7\u676F\u6CBF\u51B2\u4F60\u7684\u9F3B\u5B50\u3002\u7B2C\u4E00\u53E3\uFF0C\u82E6\u5473\u662F\u53CC\u4EFD\u7684\uFF1A\u5496\u5561\u7684\u7126\u82E6\u548C\u9152\u7684\u836F\u8349\u82E6\u53E0\u5728\u4E00\u8D77\uFF0C\u50CF\u4E24\u4E2A\u58F0\u90E8\u5531\u540C\u4E00\u4E2A\u97F3\u3002\u7136\u540E\u751C\u5473\u4ECE\u5E95\u4E0B\u7FFB\u4E0A\u6765\uFF0C\u4E0D\u591A\uFF0C\u521A\u597D\u8BA9\u4F60\u7684\u820C\u5934\u4E0D\u81F3\u4E8E\u76B1\u8D77\u6765\u3002\u9152\u7CBE\u7684\u70ED\u88AB\u5496\u5561\u7684\u6E29\u5EA6\u76D6\u4F4F\u4E86\uFF0C\u4F60\u51E0\u4E4E\u5FD8\u4E86\u81EA\u5DF1\u5728\u559D\u9152\u2014\u2014\u76F4\u5230\u5B83\u5230\u4E86\u80C3\u91CC\uFF0C\u6696\u610F\u548C\u5496\u5561\u56E0\u540C\u65F6\u53D1\u4F5C\uFF0C\u4E00\u4E2A\u5F80\u4E0A\u63A8\uFF0C\u4E00\u4E2A\u5F80\u4E0B\u6C89\u3002",
    finish: "\u9999\u6C14\u662F\u8FD9\u676F\u9152\u771F\u6B63\u7684\u91CD\u91CF\u3002\u4E0D\u662F\u82B1\u679C\u7684\u9999\uFF0C\u662F\u70D8\u7119\u623F\u3001\u6DF1\u591C\u3001\u78E8\u8C46\u673A\u8F6C\u8D77\u6765\u90A3\u79CD\u53C8\u6697\u53C8\u6D53\u7684\u9999\uFF0C\u8D56\u5728\u9F3B\u8154\u91CC\u4E0D\u8D70\u3002",
    occasion: "\u5B83\u540C\u65F6\u5728\u53EB\u4F60\u6E05\u9192\u548C\u53EB\u4F60\u653E\u7EB5\u3002\u4F60\u6CA1\u6CD5\u542C\u4E00\u8FB9\u7684\u3002"
  }
};
function manualFor(name) {
  return barManual[String(name || "").trim()] || null;
}
var ingredientManual = {
  "\u91D1\u9152": {
    bottle: "\u74F6\u8EAB\uFF1A\u901A\u5E38\u662F\u51B7\u8272\u8C03\u7684\u73BB\u7483\uFF0C\u6807\u7B7E\u4E0A\u5370\u7740\u690D\u7269\u56FE\u8C31\uFF0C\u50CF\u4E00\u672C\u4F60\u4E0D\u4F1A\u7FFB\u5F00\u7684\u8349\u836F\u767E\u79D1\u3002",
    notes: ["\u62E7\u5F00\u74F6\u76D6\uFF0C\u675C\u677E\u5B50\u7684\u5473\u9053\u5C31\u7AD9\u5728\u95E8\u53E3\u4E86\u2014\u2014\u5C16\u9510\u7684\u3001\u51B7\u7EFF\u8272\u7684\u3001\u50CF\u677E\u9488\u634F\u788E\u5728\u6307\u5C16\u4E4B\u95F4\u3002\u51D1\u8FD1\u518D\u95FB\uFF0C\u67D1\u6A58\u76AE\u8EB2\u5728\u540E\u9762\uFF0C\u82AB\u837D\u7C7D\u5728\u66F4\u6DF1\u7684\u5730\u65B9\uFF0C\u5E26\u4E00\u70B9\u67E0\u6AAC\u5473\u7684\u80E1\u6912\u611F\u3002", "\u7EAF\u95FB\u7684\u8BDD\u4F60\u4F1A\u4EE5\u4E3A\u5B83\u662F\u67D0\u79CD\u690D\u7269\u6807\u672C\u7684\u6D78\u6CE1\u6DB2\u3002\u67D0\u79CD\u610F\u4E49\u4E0A\u5B83\u786E\u5B9E\u662F\u3002", "\u91D1\u9152\u662F\u6240\u6709\u57FA\u9152\u91CC\u6027\u683C\u6700\u5916\u9732\u7684\u4E00\u4E2A\u3002\u4F60\u8FD8\u6CA1\u5012\u8FDB\u676F\u5B50\uFF0C\u5B83\u5DF2\u7ECF\u628A\u81EA\u5DF1\u4ECB\u7ECD\u5B8C\u4E86\u3002\u8FD9\u610F\u5473\u7740\u5B83\u548C\u8C01\u7AD9\u5728\u4E00\u8D77\u90FD\u4E0D\u4F1A\u6D88\u5931\u2014\u2014\u4E5F\u610F\u5473\u7740\u5B83\u548C\u8C01\u7AD9\u5728\u4E00\u8D77\u90FD\u4F1A\u63D2\u5634\u3002"]
  },
  "\u4F0F\u7279\u52A0": {
    bottle: "\u74F6\u8EAB\uFF1A\u5E72\u51C0\u3002\u900F\u660E\u7684\u74F6\uFF0C\u900F\u660E\u7684\u6DB2\u4F53\u3002\u6709\u4E9B\u724C\u5B50\u8FDE\u6807\u7B7E\u90FD\u6068\u4E0D\u5F97\u662F\u900F\u660E\u7684\u3002",
    notes: ["\u6253\u5F00\u95FB\u3002\u4EC0\u4E48\u90FD\u6CA1\u6709\u3002\u4E5F\u8BB8\u6709\u4E00\u4E1D\u9152\u7CBE\u7684\u8F9B\u8FA3\u611F\u523A\u4E86\u4E00\u4E0B\u9F3B\u8154\uFF0C\u4F46\u90A3\u4E0D\u662F\u98CE\u5473\uFF0C\u90A3\u662F\u5316\u5B66\u3002", "\u5012\u51FA\u6765\uFF0C\u5B83\u770B\u8D77\u6765\u548C\u6C34\u4E00\u6A21\u4E00\u6837\u3002\u5C1D\u8D77\u6765\u2014\u2014\u53EA\u6709\u707C\u70E7\u3002\u6CA1\u6709\u751C\u3001\u6CA1\u6709\u82E6\u3001\u6CA1\u6709\u8349\u672C\u3001\u6CA1\u6709\u679C\u9999\u3002\u5B83\u628A\u81EA\u5DF1\u524A\u5230\u53EA\u5269\u4E00\u628A\u5200\u5203\uFF1A\u7EAF\u7CB9\u7684\u9152\u7CBE\uFF0C\u7EAF\u7CB9\u7684\u70ED\u3002", "\u8FD9\u4E0D\u662F\u7F3A\u9677\u3002\u4F0F\u7279\u52A0\u7684\u7A7A\u767D\u662F\u7559\u7ED9\u522B\u4EBA\u7684\u7A7A\u95F4\u3002\u5B83\u662F\u8C03\u9152\u53F0\u4E0A\u6700\u597D\u7684\u753B\u5E03\u2014\u2014\u4EC0\u4E48\u90FD\u4E0D\u8BF4\uFF0C\u4E8E\u662F\u4EC0\u4E48\u90FD\u80FD\u5F80\u4E0A\u9762\u653E\u3002\u4F60\u9700\u8981\u4E00\u676F\u9152\u6709\u9152\u7CBE\u7684\u529B\u6C14\u4F46\u6CA1\u6709\u9152\u7CBE\u7684\u4E3B\u89C1\uFF0C\u4F60\u5C31\u7528\u5B83\u3002"]
  },
  "\u767D\u6717\u59C6": {
    bottle: "\u74F6\u8EAB\uFF1A\u900F\u660E\u73BB\u7483\uFF0C\u6DB2\u4F53\u6E05\u6F88\uFF0C\u50CF\u4E2A\u5047\u88C5\u81EA\u5DF1\u6CA1\u4EC0\u4E48\u6545\u4E8B\u7684\u4EBA\u3002",
    notes: ["\u51D1\u8FD1\u95FB\uFF1A\u7518\u8517\u3002\u4E0D\u662F\u7CD6\u7684\u751C\uFF0C\u662F\u7518\u8517\u521A\u780D\u65AD\u65F6\u90A3\u79CD\u9752\u751F\u751F\u7684\u3001\u5E26\u7740\u8349\u6C41\u7684\u751C\u3002\u5E95\u4E0B\u6709\u4E00\u5C42\u5F88\u6DE1\u7684\u7CD6\u871C\u5473\uFF0C\u50CF\u5728\u70C8\u65E5\u4E0B\u8D70\u8FC7\u4E00\u7247\u521A\u6536\u5272\u7684\u7530\u3002", "\u5165\u53E3\u6BD4\u4F60\u9884\u60F3\u5F97\u5E72\u51C0\u3002\u751C\u5473\u5728\u820C\u5C16\u4E00\u95EA\u5C31\u8D70\u4E86\uFF0C\u7559\u4E0B\u9152\u7CBE\u7684\u6696\u548C\u4E00\u70B9\u70B9\u9752\u8349\u7684\u4F59\u5473\u3002\u5B83\u6CA1\u6709\u9ED1\u6717\u59C6\u90A3\u79CD\u7126\u7CD6\u7684\u91CD\u91CF\uFF0C\u6574\u4E2A\u4EBA\u8F7B\u88C5\u4E0A\u9635\u3002", "\u767D\u6717\u59C6\u662F\u70ED\u5E26\u7684\u57FA\u9152\u3002\u5B83\u81EA\u5E26\u4E00\u79CD\u65E0\u6240\u8C13\u7684\u5F00\u6717\u3002\u653E\u8FDB\u4EFB\u4F55\u5E26\u67D1\u6A58\u7684\u4E1C\u897F\u91CC\uFF0C\u5B83\u90FD\u50CF\u672C\u6765\u5C31\u5C5E\u4E8E\u90A3\u91CC\u3002"]
  },
  "\u9ED1\u6717\u59C6": {
    bottle: "\u74F6\u8EAB\uFF1A\u6DF1\u8272\u73BB\u7483\uFF0C\u6216\u8005\u4F60\u9694\u7740\u74F6\u5B50\u5C31\u80FD\u770B\u89C1\u90A3\u6DF1\u7EA2\u8910\u8272\u7684\u6DB2\u4F53\u3002\u6807\u7B7E\u901A\u5E38\u6709\u951A\u3001\u6709\u8239\u3001\u6709\u67D0\u4E2A\u4E0D\u5B58\u5728\u7684\u6E2F\u53E3\u3002",
    notes: ["\u8FD8\u6CA1\u5012\u51FA\u6765\u5C31\u95FB\u5230\u4E86\u2014\u2014\u7126\u7CD6\u70E7\u5230\u6700\u540E\u4E00\u79D2\u3001\u5DEE\u4E00\u70B9\u5C31\u7CCA\u4E86\u7684\u90A3\u4E2A\u5473\u9053\u3002\u7136\u540E\u662F\u7CD6\u871C\u3001\u6A61\u6728\u6876\u7684\u6728\u8D28\u6C14\u606F\u3001\u4E00\u4E1D\u5976\u6CB9\u822C\u7684\u9999\u8349\u3002\u6574\u4E2A\u6C14\u5473\u662F\u6696\u8272\u7684\u3001\u539A\u7684\u3001\u6709\u5305\u88F9\u611F\u7684\u3002", "\u542B\u4E00\u53E3\u3002\u751C\u5473\u5148\u94FA\u5F00\u6765\uFF0C\u50CF\u7126\u7CD6\u5E03\u4E01\u88AB\u70E7\u9762\u90A3\u4E00\u5C42\u7684\u5473\u9053\u3002\u7136\u540E\u9152\u7CBE\u7684\u70ED\u4ECE\u751C\u5473\u5E95\u4E0B\u9876\u4E0A\u6765\uFF0C\u6A61\u6728\u7684\u5E72\u6DA9\u7D27\u968F\u5176\u540E\u3002\u54BD\u4E0B\u53BB\u4E4B\u540E\u5634\u91CC\u8FD8\u662F\u6696\u7684\u3001\u751C\u7684\u3001\u6709\u70B9\u70DF\u718F\u5473\u7684\u3002", "\u548C\u767D\u6717\u59C6\u662F\u540C\u4E00\u79CD\u4E1C\u897F\uFF0C\u4F46\u767D\u6717\u59C6\u662F\u521A\u780D\u4E0B\u6765\u7684\u7518\u8517\uFF0C\u9ED1\u6717\u59C6\u662F\u7518\u8517\u88AB\u65F6\u95F4\u548C\u6728\u6876\u5173\u4E86\u5F88\u4E45\u4E4B\u540E\u7684\u6837\u5B50\u3002"]
  },
  "\u9F99\u820C\u5170": {
    bottle: "\u74F6\u8EAB\uFF1A\u77EE\u58EE\u7684\u74F6\u5B50\uFF0C\u74F6\u53E3\u5E38\u5E38\u5F88\u5BBD\u3002\u6709\u4E9B\u74F6\u5B50\u672C\u8EAB\u5C31\u50CF\u4E00\u9897\u9F99\u820C\u5170\u7684\u5FC3\u3002",
    notes: ["\u95FB\u8D77\u6765\u9996\u5148\u662F\u7EFF\u8272\u7684\u2014\u2014\u4E0D\u662F\u82B1\u56ED\u7684\u7EFF\uFF0C\u662F\u6C99\u6F20\u690D\u7269\u90A3\u79CD\u5E26\u523A\u7684\u3001\u5014\u5F3A\u7684\u7EFF\u3002\u9752\u8349\u5473\u91CC\u6DF7\u7740\u4E00\u80A1\u5E72\u71E5\u7684\u80E1\u6912\u8F9B\u8FA3\uFF0C\u518D\u5F80\u4E0B\u662F\u6CE5\u571F\uFF0C\u662F\u521A\u4E0B\u8FC7\u96E8\u7684\u8352\u5730\u88AB\u592A\u9633\u91CD\u65B0\u6652\u5E72\u65F6\u7684\u5473\u9053\u3002", "\u5165\u53E3\u6709\u4E00\u80A1\u72EC\u7279\u7684\u690D\u7269\u751C\u5473\uFF0C\u51E0\u4E4E\u7ACB\u523B\u88AB\u80E1\u6912\u611F\u76D6\u8FC7\u53BB\u3002\u9152\u7CBE\u7684\u70ED\u548C\u8F9B\u8FA3\u6405\u5728\u4E00\u8D77\uFF0C\u5206\u4E0D\u6E05\u54EA\u4E2A\u662F\u5EA6\u6570\u54EA\u4E2A\u662F\u98CE\u5473\u3002\u54BD\u4E0B\u53BB\u4E4B\u540E\uFF0C\u5634\u91CC\u7559\u7740\u4E00\u79CD\u77FF\u7269\u8D28\u7684\u5E72\u3002", '\u9F99\u820C\u5170\u662F\u6240\u6709\u57FA\u9152\u91CC\u6700\u50CF"\u571F\u5730"\u7684\u4E00\u4E2A\u3002\u4F60\u559D\u5A01\u58EB\u5FCC\u60F3\u5230\u58C1\u7089\uFF0C\u559D\u6717\u59C6\u60F3\u5230\u7801\u5934\uFF0C\u559D\u9F99\u820C\u5170\u60F3\u5230\u7684\u662F\u4E2D\u5348\u7684\u6C99\u6F20\u548C\u4E00\u682A\u88AB\u780D\u5F00\u5FC3\u810F\u7684\u690D\u7269\u3002']
  },
  "\u5A01\u58EB\u5FCC": {
    bottle: "\u74F6\u8EAB\uFF1A\u539A\u91CD\u7684\u6DF1\u8272\u73BB\u7483\uFF0C\u6DB2\u4F53\u662F\u7425\u73C0\u5230\u6DF1\u91D1\u8272\u3002\u5F88\u591A\u74F6\u5B50\u62FF\u5728\u624B\u91CC\u7684\u611F\u89C9\u5C31\u50CF\u4E00\u4E2A\u6C89\u9ED8\u7684\u4EBA\u7684\u63E1\u624B\u3002",
    notes: ["\u5F00\u74F6\u3002\u6CE5\u7164\u5473\u7387\u5148\u5230\u8FBE\u2014\u2014\u90A3\u79CD\u5F88\u96BE\u5F62\u5BB9\u7684\u3001\u4ECB\u4E8E\u7BDD\u706B\u7070\u70EC\u548C\u6D77\u8FB9\u7901\u77F3\u4E4B\u95F4\u7684\u6C14\u606F\u3002\u70DF\u662F\u771F\u7684\u70DF\uFF0C\u4E0D\u662F\u6BD4\u55BB\uFF0C\u4F60\u80FD\u95FB\u5230\u4EC0\u4E48\u4E1C\u897F\u786E\u5B9E\u88AB\u70E7\u8FC7\u3002\u6D77\u76D0\u85CF\u5728\u70DF\u540E\u9762\uFF0C\u54B8\u7684\u3001\u77FF\u7269\u8D28\u7684\u3001\u6E7F\u6F09\u6F09\u7684\u3002\u6700\u540E\u4F60\u624D\u6CE8\u610F\u5230\u4E00\u79CD\u50CF\u7EF3\u7D22\u5728\u706B\u5806\u65C1\u70E4\u5E72\u4E86\u7684\u7126\u5473\u3002", "\u5165\u53E3\u5148\u662F\u70ED\u3002\u7136\u540E\u70DF\u5473\u5728\u6574\u4E2A\u53E3\u8154\u91CC\u70B8\u5F00\u6765\uFF0C\u50CF\u6709\u4EBA\u5728\u4F60\u5634\u91CC\u70B9\u4E86\u4E00\u5C0F\u5806\u7BDD\u706B\u3002\u6CE5\u7164\u7684\u82E6\u3001\u6D77\u76D0\u7684\u54B8\u3001\u6A61\u6728\u7684\u5E72\u5728\u820C\u9762\u4E0A\u8F6E\u756A\u7ECF\u8FC7\u3002\u54BD\u4E0B\u53BB\u4E4B\u540E\u5473\u9053\u6BD4\u9152\u6DB2\u672C\u8EAB\u5F85\u5F97\u66F4\u4E45\u3002\u4F60\u7684\u5589\u5499\u8BB0\u4F4F\u4E86\u5B83\u7684\u6E29\u5EA6\uFF0C\u4F60\u7684\u9F3B\u8154\u8BB0\u4F4F\u4E86\u5B83\u7684\u70DF\u3002", "\u5A01\u58EB\u5FCC\u662F\u9700\u8981\u65F6\u95F4\u7684\u57FA\u9152\u3002\u4E0D\u662F\u4F60\u7684\u65F6\u95F4\u2014\u2014\u662F\u5B83\u5728\u6A61\u6728\u6876\u91CC\u5F85\u8FC7\u7684\u90A3\u4E9B\u5E74\u3002"]
  },
  "\u751C\u5473\u7F8E\u601D": {
    bottle: "\u74F6\u8EAB\uFF1A\u6DF1\u8272\u73BB\u7483\uFF0C\u6807\u7B7E\u901A\u5E38\u662F\u8001\u6D3E\u7684\u3001\u5E26\u7EA2\u8272\u8272\u8C03\u7684\u3002\u989C\u8272\uFF1A\u6DF1\u7EA2\u68D5\u8272\uFF0C\u5012\u51FA\u6765\u50CF\u6DB2\u6001\u7684\u67A3\u3002",
    notes: ["\u95FB\u8D77\u6765\u50CF\u6253\u5F00\u4E00\u4E2A\u88C5\u4E86\u5F88\u591A\u5E74\u7684\u9999\u6599\u62BD\u5C49\u2014\u2014\u9999\u8349\u9996\u5148\u51FA\u6765\uFF0C\u7136\u540E\u4E01\u9999\u3001\u8089\u6842\uFF0C\u6700\u540E\u662F\u679C\u5E72\u90A3\u79CD\u88AB\u65F6\u95F4\u6D53\u7F29\u8FC7\u7684\u751C\u3002\u6574\u4E2A\u6C14\u5473\u662F\u67D4\u8F6F\u7684\u3001\u6696\u8272\u7684\u3001\u6709\u539A\u5EA6\u7684\u3002", "\u5165\u53E3\u6BD4\u95FB\u8D77\u6765\u66F4\u751C\uFF0C\u4F46\u4E0D\u662F\u7CD6\u7684\u751C\u3002\u662F\u65E0\u82B1\u679C\u3001\u8461\u8404\u5E72\u3001\u7CD6\u6E0D\u6A59\u76AE\u7684\u751C\uFF0C\u5E26\u7740\u8349\u836F\u548C\u9999\u6599\u7684\u590D\u6742\u6027\u5728\u540E\u9762\u6491\u8170\u3002\u9152\u7CBE\u5EA6\u4E0D\u9AD8\uFF0C\u4F60\u51E0\u4E4E\u4E0D\u89C9\u5F97\u5B83\u662F\u9152\u3002", "\u5B83\u5728\u9E21\u5C3E\u9152\u91CC\u7684\u89D2\u8272\u662F\u6E29\u67D4\u2014\u2014\u51FA\u573A\u5C31\u662F\u4E3A\u4E86\u8BA9\u70C8\u9152\u4E0D\u90A3\u4E48\u51F6\u3002\u66FC\u54C8\u987F\u91CC\u6CA1\u6709\u5B83\uFF0C\u5A01\u58EB\u5FCC\u5C31\u662F\u5728\u8DDF\u4F60\u5435\u67B6\u3002\u5C3C\u683C\u7F57\u5C3C\u91CC\u6CA1\u6709\u5B83\uFF0C\u91D1\u5DF4\u5229\u5C31\u662F\u5728\u8DDF\u4F60\u52A8\u624B\u3002"]
  },
  "\u5E72\u5473\u7F8E\u601D": {
    bottle: "\u74F6\u8EAB\uFF1A\u6D45\u8272\u73BB\u7483\uFF0C\u6DB2\u4F53\u51E0\u4E4E\u900F\u660E\uFF0C\u5E26\u4E00\u70B9\u70B9\u7A3B\u8349\u8272\u3002\u989C\u8272\uFF1A\u6DE1\u91D1\u8272\u3002\u5B89\u9759\u5F97\u4E0D\u50CF\u6709\u9152\u7CBE\u3002",
    notes: ["\u51D1\u8FD1\u95FB\uFF0C\u662F\u767D\u8272\u7684\u82B1\u2014\u2014\u6D0B\u7518\u83CA\uFF0C\u4E5F\u8BB8\u6709\u4E00\u70B9\u63A5\u9AA8\u6728\u3002\u4E0D\u6D53\u90C1\uFF0C\u50CF\u9694\u7740\u4E00\u5C42\u68C9\u5E03\u95FB\u5230\u7684\u3002\u5E95\u4E0B\u6709\u4E00\u4E1D\u767D\u80E1\u6912\u7684\u8F9B\u8FA3\uFF0C\u5E72\u71E5\u7684\u3001\u7EC6\u5C0F\u7684\u3002", "\u5165\u53E3\u6781\u5E72\u3002\u751C\u5473\u7EA6\u7B49\u4E8E\u96F6\u3002\u4F60\u611F\u53D7\u5230\u7684\u662F\u8349\u836F\u7684\u6E05\u82E6\u548C\u4E00\u79CD\u690D\u7269\u6027\u7684\u6DA9\u611F\uFF0C\u50CF\u56BC\u4E86\u4E00\u7247\u6CA1\u4EC0\u4E48\u5473\u9053\u7684\u53F6\u5B50\u3002", '\u5B83\u5728\u9A6C\u5929\u5C3C\u91CC\u53EA\u51FA\u73B0\u4E00\u70B9\u70B9\u2014\u2014\u6709\u4E9B\u8C03\u6CD5\u751A\u81F3\u53EA\u662F\u8BA9\u74F6\u53E3\u5BF9\u7740\u676F\u5B50\u70B9\u4E86\u4E2A\u5934\u3002\u4F46\u5C31\u8FD9\u4E00\u70B9\u70B9\uFF0C\u628A\u7EAF\u91D1\u9152\u4ECE"\u76F4\u63A5\u559D\u70C8\u9152"\u53D8\u6210\u4E86"\u4E00\u676F\u9E21\u5C3E\u9152"\u3002\u5B83\u7684\u89D2\u8272\u4E0D\u662F\u52A0\u4E86\u4EC0\u4E48\uFF0C\u800C\u662F\u8BA9\u539F\u672C\u7684\u4E1C\u897F\u53D8\u5F97\u53EF\u4EE5\u88AB\u6B63\u5F0F\u7AEF\u51FA\u6765\u3002']
  },
  "\u91D1\u5DF4\u5229": {
    bottle: "\u74F6\u8EAB\uFF1A\u4F60\u4E0D\u4F1A\u8BA4\u9519\u5B83\u2014\u2014\u6C38\u8FDC\u662F\u90A3\u79CD\u4EBA\u5DE5\u5F97\u8FD1\u4E4E\u50B2\u6162\u7684\u5B9D\u77F3\u7EA2\u3002\u989C\u8272\uFF1A\u7EA2\u5F97\u4E0D\u50CF\u4EFB\u4F55\u98DF\u7269\u7684\u989C\u8272\u3002\u7EA2\u5F97\u50CF\u4E00\u4E2A\u8B66\u544A\u3002",
    notes: ["\u95FB\u8D77\u6765\uFF1A\u82E6\u6A59\uFF0C\u4F46\u4E0D\u662F\u4F60\u5403\u8FC7\u7684\u4EFB\u4F55\u4E00\u79CD\u6A59\u5B50\u3002\u662F\u6A59\u76AE\u88AB\u6652\u5E72\u3001\u78E8\u788E\u3001\u518D\u6CE1\u8FDB\u9152\u7CBE\u91CC\u4E4B\u540E\u7684\u6837\u5B50\u2014\u2014\u6C34\u679C\u7684\u751C\u5473\u5DF2\u7ECF\u5168\u90E8\u84B8\u53D1\uFF0C\u53EA\u5269\u4E0B\u82E6\u548C\u4E00\u70B9\u70B9\u6B8B\u7559\u7684\u67D1\u6A58\u9178\u3002\u5E95\u4E0B\u662F\u9F99\u80C6\u6839\u7684\u836F\u82E6\uFF0C\u50CF\u4E2D\u836F\u623F\u7684\u7A7A\u6C14\u3002", "\u5165\u53E3\u3002\u82E6\u3002\u9996\u5148\u662F\u82E6\uFF0C\u6700\u540E\u8FD8\u662F\u82E6\u3002\u4F60\u7684\u5634\u5DF4\u672C\u80FD\u5730\u60F3\u62D2\u7EDD\u5B83\u2014\u2014\u820C\u6839\u6536\u7F29\uFF0C\u7709\u5934\u76B1\u8D77\u6765\u3002\u4F46\u5982\u679C\u4F60\u6CA1\u6709\u7ACB\u523B\u653E\u4E0B\u676F\u5B50\uFF0C\u82E6\u5473\u7684\u4E2D\u95F4\u5C42\u4F1A\u6253\u5F00\uFF1A\u82E6\u6A59\u76AE\u7684\u82B3\u9999\uFF0C\u4E00\u70B9\u70B9\u7126\u7CD6\uFF0C\u4E00\u79CD\u51E0\u4E4E\u662F\u82B1\u9999\u7684\u4E1C\u897F\u4ECE\u82E6\u7684\u5E95\u90E8\u5192\u51FA\u6765\u3002", "\u91D1\u5DF4\u5229\u4E0D\u662F\u7528\u6765\u559D\u7684\u3002\u5B83\u662F\u7528\u6765\u6DF7\u7684\u3002\u5B83\u5B58\u5728\u7684\u610F\u4E49\u662F\u8D70\u8FDB\u4E00\u676F\u9152\u7136\u540E\u5F97\u7F6A\u6240\u6709\u4EBA\u2014\u2014\u7136\u540E\u8BA9\u90A3\u676F\u9152\u56E0\u6B64\u53D8\u5F97\u65E0\u6CD5\u5FD8\u8BB0\u3002"]
  },
  "\u6A59\u76AE\u5229\u53E3\u9152": {
    bottle: "\u74F6\u8EAB\uFF1A\u900F\u660E\u6216\u6D45\u7425\u73C0\u8272\u7684\u6DB2\u4F53\uFF0C\u74F6\u5B50\u901A\u5E38\u6BD4\u5B83\u7684\u5473\u9053\u66F4\u4F4E\u8C03\u3002\u989C\u8272\uFF1A\u6F84\u6F88\u7684\u6D45\u91D1\u8272\u3002\u50CF\u6DB2\u6001\u7684\u9633\u5149\u8FD9\u4E2A\u8BF4\u6CD5\u592A\u4FD7\u4E86\uFF0C\u4F46\u4F60\u770B\u5230\u5B83\u786E\u5B9E\u4F1A\u8FD9\u4E48\u60F3\u3002",
    notes: ["\u95FB\u8D77\u6765\u5C31\u662F\u6A59\u5B50\u2014\u2014\u4F46\u4E0D\u662F\u679C\u8089\uFF0C\u662F\u76AE\u3002\u4F60\u7528\u6307\u7532\u6390\u7834\u4E00\u7247\u6A59\u76AE\u65F6\u55B7\u51FA\u6765\u7684\u90A3\u80A1\u6CB9\u8102\uFF0C\u950B\u5229\u7684\u3001\u5E26\u5FAE\u82E6\u7684\u3001\u6BD4\u679C\u6C41\u672C\u8EAB\u4EAE\u5F97\u591A\u7684\u67D1\u6A58\u6C14\u606F\u3002\u5E95\u4E0B\u57AB\u7740\u4E00\u5C42\u8702\u871C\u822C\u7684\u751C\u3002", "\u5165\u53E3\u5148\u751C\u540E\u82E6\u3002\u6A59\u76AE\u7684\u82B3\u9999\u94FA\u6EE1\u820C\u9762\uFF0C\u751C\u5473\u50CF\u4E00\u5C42\u7CD6\u8863\u3002\u4F46\u522B\u5FD8\u4E86\u5B83\u670940\u5EA6\u2014\u2014\u9152\u7CBE\u7684\u70ED\u4ECE\u751C\u5473\u4E0B\u9762\u5347\u8D77\u6765\uFF0C\u50CF\u4E00\u628A\u85CF\u5728\u4E1D\u7ED2\u624B\u5957\u91CC\u7684\u5200\u3002", "\u5B83\u51E0\u4E4E\u4E0D\u5355\u72EC\u51FA\u573A\u3002\u4F46\u5728\u739B\u683C\u4E3D\u7279\u91CC\u3001\u957F\u5C9B\u91CC\u3001\u5F88\u591A\u4F60\u53EB\u4E0D\u4E0A\u540D\u5B57\u7684\u9152\u91CC\uFF0C\u90A3\u4E00\u70B9\u67D1\u6A58\u7684\u751C\u4EAE\u5C31\u662F\u5B83\u7559\u4E0B\u7684\u3002"]
  },
  "\u5496\u5561\u5229\u53E3\u9152": {
    bottle: "\u74F6\u8EAB\uFF1A\u6DF1\u68D5\u8272\u6216\u9ED1\u8272\u74F6\u5B50\u3002\u989C\u8272\uFF1A\u8FD1\u4E4E\u9ED1\u8272\u7684\u6DF1\u8910\uFF0C\u5012\u51FA\u6765\u7684\u65F6\u5019\u50CF\u6D53\u7F29\u5496\u5561\u52A0\u4E86\u7CD6\u6D46\u3002",
    notes: ["\u95FB\u8D77\u6765\u50CF\u5496\u5561\u9986\u6253\u70CA\u4E4B\u540E\u2014\u2014\u4E0D\u662F\u521A\u716E\u597D\u7684\u65B0\u9C9C\u5496\u5561\u5473\uFF0C\u662F\u6E17\u8FDB\u4E86\u5427\u53F0\u6728\u5934\u91CC\u3001\u548C\u7CD6\u6D46\u6DF7\u5728\u4E00\u8D77\u3001\u88AB\u4E00\u6574\u5929\u7684\u6E29\u5EA6\u7110\u8FC7\u7684\u5496\u5561\u5473\u3002\u751C\u5F97\u53D1\u817B\u7684\u3001\u9ECF\u7A20\u7684\u3001\u6697\u8272\u7684\u9999\u3002", "\u5165\u53E3\u5F88\u751C\u3002\u6BD4\u4F60\u9884\u60F3\u5F97\u751C\u3002\u5496\u5561\u7684\u70D8\u7119\u82E6\u5473\u5728\u751C\u5473\u5E95\u4E0B\uFF0C\u50CF\u6C34\u9762\u4E0B\u7684\u77F3\u5934\u2014\u2014\u4F60\u8E29\u5F97\u5230\uFF0C\u4F46\u7CD6\u6D46\u5DF2\u7ECF\u628A\u6240\u6709\u5C16\u89D2\u90FD\u88F9\u4E86\u4E00\u5C42\u3002\u9152\u7CBE\u611F\u5F88\u4F4E\uFF0C\u4F4E\u5230\u4F60\u4F1A\u5FD8\u8BB0\u5B8320\u5EA6\u3002", '\u5B83\u5B58\u5728\u7684\u7406\u7531\u662F\u8BA9"\u5496\u5561"\u8FD9\u4E2A\u5473\u9053\u53EF\u4EE5\u88AB\u6405\u8FDB\u9152\u7CBE\u7684\u4E16\u754C\u3002Espresso Martini\u91CC\u6CA1\u6709\u5B83\uFF0C\u5C31\u53EA\u662F\u4E00\u676F\u51B7\u6389\u7684\u5496\u5561\u5151\u4E86\u70C8\u9152\u3002\u6709\u4E86\u5B83\uFF0C\u5496\u5561\u548C\u9152\u7CBE\u4E4B\u95F4\u624D\u6709\u4E86\u4E00\u4E2A\u7FFB\u8BD1\u3002']
  },
  "\u82E6\u827E\u9152": {
    bottle: '\u74F6\u8EAB\uFF1A\u7EFF\u8272\u7684\u6DB2\u4F53\u88C5\u5728\u91CC\u9762\uFF0C\u50CF\u6807\u672C\u74F6\u91CC\u6CE1\u7740\u4EC0\u4E48\u4E0D\u8BE5\u78B0\u7684\u4E1C\u897F\u3002\u989C\u8272\uFF1A\u7FE0\u7EFF\u3002\u900F\u5149\u770B\u7684\u65F6\u5019\u50CF\u6559\u5802\u73BB\u7483\u3002\u52A0\u6C34\u4E4B\u540E\u53D8\u6D51\u2014\u2014\u90A3\u53EB"\u60AC\u6D4A\u6548\u5E94"\uFF0C\u8334\u9999\u8111\u9047\u6C34\u6790\u51FA\uFF0C\u79D8\u5BC6\u5728\u53D8\u6210\u53EF\u4EE5\u88AB\u770B\u89C1\u7684\u4E1C\u897F\u3002',
    notes: ["\u5F00\u74F6\u7684\u4E00\u77AC\u95F4\u6574\u4E2A\u623F\u95F4\u90FD\u77E5\u9053\u4E86\u3002\u8334\u82B9\u7684\u5473\u9053\u50CF\u4E00\u9762\u5899\u2014\u2014\u7518\u8349\u822C\u7684\u751C\u3001\u516B\u89D2\u822C\u7684\u6696\u3001\u4F46\u6D53\u5EA6\u9AD8\u5230\u8BA9\u4F60\u7684\u9F3B\u8154\u6709\u523A\u75DB\u611F\u3002\u8334\u82B9\u540E\u9762\u662F\u82E6\u827E\u8349\u672C\u8EAB\uFF0C\u836F\u7684\u82E6\uFF0C\u690D\u7269\u7684\u6DA9\uFF0C\u50CF\u4E00\u628A\u88AB\u634F\u788E\u7684\u5E72\u71E5\u8349\u53F6\u3002", "\u5B8368\u5EA6\u3002\u8FD9\u4E2A\u6570\u5B57\u4E0D\u662F\u98CE\u5473\u63CF\u8FF0\uFF0C\u662F\u5B89\u5168\u63D0\u793A\u3002", "\u4F60\u4E0D\u4F1A\u7528\u5B83\u505A\u4E00\u676F\u9152\u7684\u4E3B\u89D2\u2014\u2014\u51E0\u6EF4\u5C31\u591F\u4E86\u3002\u90A3\u51E0\u6EF4\u843D\u8FDB\u676F\u5B50\u4E4B\u540E\uFF0C\u6574\u676F\u9152\u7684\u6C14\u5473\u4F1A\u88AB\u6539\u5199\u3002\u5B83\u662F\u6240\u6709\u539F\u6599\u91CC\u6700\u9738\u9053\u7684\u5BA2\u4EBA\uFF1A\u53EA\u5360\u4E00\u70B9\u70B9\u4F4D\u7F6E\uFF0C\u4F46\u6240\u6709\u4EBA\u90FD\u5728\u770B\u5B83\u3002", "\u917F\u9020\u9152", "\u5B83\u4EEC\u4E0D\u662F\u88AB\u84B8\u998F\u51FA\u6765\u7684\uFF0C\u662F\u88AB\u65F6\u95F4\u548C\u5FAE\u751F\u7269\u6162\u6162\u53D1\u9175\u51FA\u6765\u7684\u3002\u5EA6\u6570\u4F4E\uFF0C\u813E\u6C14\u4E5F\u4F4E\uFF0C\u4F46\u5404\u81EA\u6709\u5404\u81EA\u6F2B\u957F\u7684\u6765\u5386\u3002"]
  },
  "\u6E05\u9152": {
    bottle: "\u74F6\u8EAB\uFF1A\u7EC6\u957F\u7684\u73BB\u7483\u74F6\u6216\u9676\u74F6\uFF0C\u6807\u7B7E\u4E0A\u901A\u5E38\u6709\u4F60\u770B\u4E0D\u61C2\u7684\u6C49\u5B57\u548C\u5047\u540D\u3002\u6709\u4E9B\u74F6\u5B50\u5F88\u6734\u7D20\uFF0C\u6734\u7D20\u5230\u50CF\u88C5\u6C34\u7684\u3002\u989C\u8272\uFF1A\u51E0\u4E4E\u900F\u660E\uFF0C\u6709\u4E9B\u5E26\u4E00\u70B9\u70B9\u7C73\u767D\u8272\u7684\u6D51\u6D4A\uFF0C\u50CF\u96E8\u540E\u6C34\u6D3C\u91CC\u5012\u6620\u7684\u5929\u7A7A\u3002",
    notes: ["\u51D1\u8FD1\u95FB\uFF0C\u7B2C\u4E00\u5C42\u662F\u7C73\u2014\u2014\u4E0D\u662F\u751F\u7C73\uFF0C\u662F\u84B8\u719F\u7684\u3001\u63ED\u5F00\u9505\u76D6\u90A3\u4E00\u523B\u7684\u6C14\u606F\uFF0C\u6E29\u6DA6\u7684\u3001\u6709\u6DC0\u7C89\u611F\u7684\u6696\u3002\u7136\u540E\u4F60\u95FB\u5230\u4E86\u751C\u74DC\uFF0C\u5F88\u6DE1\uFF0C\u50CF\u6C34\u679C\u644A\u8FDC\u8FDC\u98D8\u6765\u7684\u5473\u9053\u3002\u6700\u540E\u9762\u85CF\u7740\u4E00\u70B9\u82B1\u9999\uFF0C\u8FA8\u4E0D\u6E05\u662F\u4EC0\u4E48\u82B1\uFF0C\u53EA\u77E5\u9053\u662F\u767D\u8272\u7684\u3001\u5C0F\u7684\u3001\u4E0D\u62DB\u6447\u7684\u3002", "\u76F4\u63A5\u5C1D\u4E00\u53E3\u3002\u6CA1\u6709\u4EFB\u4F55\u4E1C\u897F\u51B2\u649E\u4F60\u3002\u7C73\u7684\u751C\u5728\u820C\u9762\u4E0A\u5B89\u9759\u5730\u5C55\u5F00\uFF0C\u50CF\u4E00\u5757\u6E29\u70ED\u7684\u5E03\u94FA\u5E73\u4E86\u3002\u9152\u7CBE\u5728\u8FD9\u4E2A\u5EA6\u6570\u51E0\u4E4E\u53EA\u662F\u4E00\u79CD\u6696\u610F\uFF0C\u4E0D\u70E7\u3001\u4E0D\u523A\u3001\u4E0D\u5BA3\u5E03\u81EA\u5DF1\u7684\u5B58\u5728\u3002\u82B1\u9999\u548C\u751C\u74DC\u5473\u4ECE\u9F3B\u8154\u56DE\u6765\u7684\u65F6\u5019\u6BD4\u820C\u5934\u4E0A\u611F\u53D7\u5230\u7684\u66F4\u6E05\u695A\u3002", "\u6E05\u9152\u662F\u6240\u6709\u9152\u7C7B\u539F\u6599\u91CC\u6700\u4E0D\u50CF\u9152\u7684\u4E00\u4E2A\u3002\u5B83\u4E0D\u63D0\u9AD8\u55D3\u95E8\uFF0C\u4E0D\u5236\u9020\u51B2\u7A81\uFF0C\u4E0D\u5728\u4F60\u7684\u5473\u89C9\u4E0A\u7559\u4E0B\u4F24\u53E3\u3002\u5B83\u53EA\u662F\u5728\u90A3\u91CC\uFF0C\u6E29\u6E29\u7684\uFF0C\u7B49\u4F60\u81EA\u5DF1\u9760\u8FD1\u3002", "\u8C03\u9152\u65F6\u5B83\u5E26\u6765\u7684\u4E0D\u662F\u529B\u5EA6\uFF0C\u662F\u4E00\u79CD\u6E7F\u6DA6\u7684\u5E95\u8272\u2014\u2014\u50CF\u5728\u753B\u5E03\u4E0A\u5148\u94FA\u4E00\u5C42\u6C34\uFF0C\u540E\u9762\u7684\u989C\u6599\u4F1A\u56E0\u6B64\u53D8\u5F97\u67D4\u548C\u3002"]
  },
  "\u5564\u9152": {
    bottle: '\u74F6\u8EAB\uFF1A\u68D5\u8272\u6216\u7EFF\u8272\u73BB\u7483\u74F6\uFF0C\u64AC\u5F00\u74F6\u76D6\u7684\u65F6\u5019\u6709\u4E00\u58F0\u8F7B\u54CD\u548C\u4E00\u7F15\u767D\u6C14\u3002\u989C\u8272\uFF1A\u900F\u4EAE\u7684\u91D1\u9EC4\u8272\u3002\u5149\u7A7F\u8FC7\u53BB\u7684\u65F6\u5019\u4F60\u89C9\u5F97\u8FD9\u4E2A\u989C\u8272\u5E94\u8BE5\u6709\u4E2A\u66F4\u597D\u7684\u540D\u5B57\uFF0C\u4F46"\u91D1\u9EC4\u8272"\u5DF2\u7ECF\u591F\u51C6\u786E\u4E86\u3002\u5012\u8FDB\u676F\u5B50\uFF0C\u767D\u8272\u6CE1\u6CAB\u5347\u4E0A\u6765\uFF0C\u7EC6\u5BC6\u3001\u8F7B\u3001\u51E0\u79D2\u4E4B\u540E\u5C31\u5F00\u59CB\u6D88\u6563\u3002',
    notes: ["\u95FB\u8D77\u6765\u662F\u9762\u5305\u76AE\u2014\u2014\u4E0D\u662F\u9762\u5305\u74E4\u90A3\u79CD\u677E\u8F6F\u7684\u5473\u9053\uFF0C\u662F\u70E4\u5230\u6700\u5916\u9762\u90A3\u4E00\u5C42\u3001\u6709\u70B9\u7126\u6709\u70B9\u786C\u7684\u6C14\u606F\u3002\u5E72\u8349\u7684\u5473\u9053\u5728\u65C1\u8FB9\u966A\u7740\uFF0C\u50CF\u590F\u5929\u508D\u665A\u7ECF\u8FC7\u4E00\u7247\u88AB\u5272\u8FC7\u7684\u7530\u3002\u7136\u540E\u6709\u4E00\u4E1D\u67E0\u6AAC\u76AE\u7684\u6E05\u4EAE\uFF0C\u5F88\u7EC6\uFF0C\u4F60\u4E0D\u6CE8\u610F\u5C31\u9519\u8FC7\u4E86\u3002", "\u5165\u53E3\u6C14\u6CE1\u5148\u5230\uFF0C\u5728\u820C\u9762\u4E0A\u5236\u9020\u4E00\u7247\u7EC6\u5C0F\u7684\u9A9A\u52A8\u3002\u7136\u540E\u9EA6\u82BD\u7684\u5473\u9053\u94FA\u5F00\u6765\u2014\u2014\u7CAE\u98DF\u7684\u3001\u5FAE\u751C\u7684\u3001\u6709\u56BC\u52B2\u7684\uFF0C\u50CF\u628A\u9762\u5305\u76AE\u56BC\u788E\u4E86\u4E4B\u540E\u5316\u5728\u5634\u91CC\u3002\u82E6\u5473\u4ECE\u540E\u9762\u8D76\u4E0A\u6765\uFF0C\u5564\u9152\u82B1\u7684\u82E6\uFF0C\u4E0D\u6DF1\u4E0D\u91CD\uFF0C\u53EA\u662F\u5728\u9EA6\u82BD\u7684\u751C\u540E\u9762\u753B\u4E86\u4E00\u6761\u754C\u7EBF\u3002\u54BD\u4E0B\u53BB\u4E4B\u540E\u5634\u91CC\u77ED\u6682\u5730\u5E72\u51C0\u4E86\u4E00\u79D2\u3002\u7136\u540E\u6C14\u6CE1\u7684\u523A\u6FC0\u6D88\u9000\uFF0C\u4EC0\u4E48\u90FD\u4E0D\u5269\u3002", '\u5564\u9152\u5165\u9E21\u5C3E\u9152\u7684\u65F6\u5019\uFF0C\u5E26\u6765\u7684\u9996\u5148\u662F\u6C14\u6CE1\u548C\u4F53\u79EF\u2014\u2014\u5B83\u628A\u4E00\u676F\u9152\u4ECE"\u7AEF\u7740\u5C0F\u53E3\u559D"\u53D8\u6210"\u62FF\u7740\u5927\u53E3\u704C"\u3002\u5176\u6B21\u662F\u90A3\u70B9\u9EA6\u82BD\u7684\u7CAE\u98DF\u611F\uFF0C\u4E00\u79CD\u8BA9\u6240\u6709\u9152\u7CBE\u90FD\u4E0D\u90A3\u4E48\u50CF\u9152\u7CBE\u7684\u6734\u5B9E\u5E95\u5473\u3002']
  },
  "\u7EA2\u8461\u8404\u9152": {
    bottle: '\u74F6\u8EAB\uFF1A\u6DF1\u8272\u73BB\u7483\u957F\u9888\u74F6\uFF0C\u8F6F\u6728\u585E\u62D4\u51FA\u6765\u7684\u65F6\u5019\u53D1\u51FA\u4E00\u58F0\u95F7\u54CD\u3002\u8FD9\u4E2A\u58F0\u97F3\u672C\u8EAB\u5C31\u662F\u4E00\u79CD\u4EEA\u5F0F\u3002\u989C\u8272\uFF1A\u6697\u7EA2\u5230\u7D2B\u9ED1\u3002\u5012\u8FDB\u676F\u5B50\u4E4B\u540E\u676F\u58C1\u4E0A\u6162\u6162\u6ED1\u4E0B\u6765\u7684\u6302\u58C1\u75D5\u8FF9\u53EB"\u9152\u817F"\u2014\u2014\u4F60\u4E0D\u9700\u8981\u8BB0\u4F4F\u8FD9\u4E2A\uFF0C\u4F46\u4F60\u4F1A\u770B\u5230\u3002',
    notes: ["\u6643\u676F\u5B50\u3002\u51D1\u8FD1\u2014\u2014\u9ED1\u8393\u5148\u5230\uFF0C\u4E0D\u662F\u65B0\u9C9C\u7684\u9ED1\u8393\uFF0C\u662F\u653E\u4E86\u4E00\u5929\u3001\u5F00\u59CB\u8F6F\u4E86\u3001\u6C41\u6C34\u6BD4\u6628\u5929\u66F4\u6D53\u7684\u9ED1\u8393\u3002\u7136\u540E\u662F\u6A61\u6728\uFF0C\u5E72\u71E5\u7684\u6728\u8D28\u6C14\u606F\uFF0C\u50CF\u63A8\u5F00\u4E00\u6247\u8001\u67DC\u5B50\u7684\u95E8\u3002\u6700\u91CC\u9762\u6709\u4E00\u80A1\u76AE\u9769\u5473\uFF0C\u8BF4\u4E0D\u4E0A\u597D\u95FB\u6216\u96BE\u95FB\uFF0C\u53EA\u662F\u8BA9\u4F60\u60F3\u5230\u65E7\u7684\u3001\u7528\u4E86\u5F88\u4E45\u7684\u3001\u6709\u6E29\u5EA6\u7684\u4E1C\u897F\u3002", "\u5165\u53E3\u3002\u6D46\u679C\u7684\u5473\u9053\u94FA\u5728\u524D\u9762\uFF0C\u9178\u7684\uFF0C\u679C\u8089\u822C\u7684\u3002\u9178\u5473\u4E0D\u5C16\u4F46\u6709\u91CD\u91CF\uFF0C\u50CF\u4E00\u9897\u521A\u54AC\u5F00\u7684\u9ED1\u6A31\u6843\u5728\u4F60\u820C\u5934\u4E0A\u538B\u7740\u3002\u7D27\u63A5\u7740\u6DA9\u5473\u4ECE\u4E24\u4FA7\u6536\u7D27\u2014\u2014\u5355\u5B81\uFF0C\u7EA2\u9152\u91CC\u4F60\u7ED5\u4E0D\u5F00\u7684\u4E1C\u897F\u2014\u2014\u50CF\u7528\u5E72\u5E03\u64E6\u4E86\u4E00\u904D\u53E3\u8154\u5185\u58C1\u3002\u9152\u7CBE\u7684\u70ED\u85CF\u5728\u4E2D\u6BB5\uFF0C\u6BD4\u70C8\u9152\u6E29\u67D4\u5F97\u591A\uFF0C\u4F46\u5B83\u786E\u5B9E\u5728\u3002\u6A61\u6728\u548C\u76AE\u9769\u7684\u5473\u9053\u5728\u54BD\u4E0B\u53BB\u4E4B\u540E\u4ECE\u5589\u5E95\u7FFB\u4E0A\u6765\uFF0C\u548C\u9F3B\u8154\u91CC\u7684\u6D46\u679C\u6C14\u606F\u6C47\u5408\u3002", "\u5634\u91CC\u53D1\u5E72\u3002\u820C\u5934\u4E0A\u8499\u7740\u4E00\u5C42\u6DA9\u3002\u4F46\u4F60\u51D1\u8FD1\u676F\u5B50\u518D\u95FB\u4E00\u6B21\u7684\u65F6\u5019\uFF0C\u90A3\u4E2A\u9ED1\u8393\u548C\u65E7\u6728\u5934\u7684\u9999\u6C14\u8FD8\u5728\uFF0C\u50CF\u5B83\u77E5\u9053\u4F60\u4F1A\u56DE\u6765\u3002", "\u7EA2\u8461\u8404\u9152\u5728\u8C03\u9152\u53F0\u4E0A\u4E0D\u5E38\u51FA\u73B0\u3002\u4F46\u5F53\u5B83\u51FA\u73B0\u7684\u65F6\u5019\uFF0C\u5B83\u5E26\u6765\u7684\u662F\u6240\u6709\u57FA\u9152\u548C\u5229\u53E3\u9152\u90FD\u7ED9\u4E0D\u4E86\u7684\u4E1C\u897F\uFF1A\u6DA9\u3002\u90A3\u79CD\u5355\u5B81\u7684\u7D27\u7F29\u611F\u662F\u5B83\u72EC\u6709\u7684\u7B7E\u540D\u3002"]
  },
  "\u6C64\u529B\u6C34": {
    bottle: "\u74F6\u8EAB\uFF1A\u5C0F\u74F6\uFF0C\u900F\u660E\u6DB2\u4F53\uFF0C\u6C14\u6CE1\u5728\u74F6\u5B50\u91CC\u5DF2\u7ECF\u7B49\u4E0D\u53CA\u4E86\u3002\u989C\u8272\uFF1A\u65E0\u8272\u3002\u4F46\u5728\u7D2B\u5916\u5149\u4E0B\u5B83\u4F1A\u53D1\u8367\u5149\u84DD\u2014\u2014\u594E\u5B81\u7684\u7279\u6027\u3002\u4F60\u4E0D\u4F1A\u5728\u5427\u53F0\u770B\u5230\u8FD9\u4E2A\uFF0C\u4F46\u77E5\u9053\u4E86\u4E4B\u540E\u770B\u5B83\u7684\u773C\u795E\u4F1A\u4E0D\u4E00\u6837\u3002",
    notes: ["\u6253\u5F00\u7684\u65F6\u5019\u6C14\u6CE1\u58F0\u6BD4\u82CF\u6253\u6C34\u66F4\u6025\u3002\u95FB\u8D77\u6765\u51E0\u4E4E\u6CA1\u6709\u6C14\u5473\uFF0C\u4E5F\u8BB8\u6709\u4E00\u70B9\u77FF\u7269\u8D28\u7684\u91D1\u5C5E\u611F\u3002", "\u559D\u4E00\u53E3\u3002\u6C14\u6CE1\u5148\u5728\u5634\u91CC\u70B8\u5F00\uFF0C\u7136\u540E\u82E6\u5473\u7ACB\u523B\u5230\u573A\u2014\u2014\u594E\u5B81\u7684\u82E6\uFF0C\u5E72\u7684\u3001\u6536\u655B\u7684\u3001\u548C\u5564\u9152\u82B1\u5B8C\u5168\u4E0D\u540C\u7684\u82E6\u3002\u4E0D\u5728\u820C\u5C16\uFF0C\u5728\u820C\u5934\u4E2D\u540E\u6BB5\uFF0C\u50CF\u6709\u4EBA\u7528\u6307\u8179\u6309\u4F4F\u4E86\u90A3\u4E2A\u4F4D\u7F6E\u3002\u751C\u5473\u5728\u67D0\u4E9B\u724C\u5B50\u91CC\u662F\u6709\u7684\uFF0C\u4F46\u5B83\u53EA\u662F\u7ED9\u82E6\u5473\u4E70\u4E86\u4E00\u5F20\u5165\u573A\u5238\uFF0C\u8BA9\u5B83\u4E0D\u81F3\u4E8E\u628A\u4EBA\u76F4\u63A5\u8D76\u8D70\u3002", "\u6C64\u529B\u6C34\u5728\u9E21\u5C3E\u9152\u91CC\u5E72\u4E24\u4EF6\u4E8B\uFF1A\u7528\u6C14\u6CE1\u7ED9\u9152\u4E00\u4E2A\u8F7B\u76C8\u7684\u8EAB\u4F53\uFF0C\u7528\u594E\u5B81\u7684\u82E6\u7ED9\u9152\u4E00\u9053\u68F1\u89D2\u3002\u91D1\u6C64\u529B\u4E4B\u6240\u4EE5\u662F\u91D1\u6C64\u529B\uFF0C\u662F\u56E0\u4E3A\u6C64\u529B\u6C34\u7684\u82E6\u548C\u91D1\u9152\u7684\u675C\u677E\u5BF9\u4E0A\u4E86\u2014\u2014\u4E24\u79CD\u690D\u7269\u6027\u7684\u523A\u6FC0\u78B0\u5728\u4E00\u8D77\uFF0C\u5F7C\u6B64\u90FD\u53D8\u5F97\u66F4\u950B\u5229\u3002"]
  },
  "\u82CF\u6253\u6C34": {
    bottle: "\u74F6\u8EAB\uFF1A\u548C\u6C64\u529B\u6C34\u957F\u5F97\u5F88\u50CF\u3002\u533A\u522B\u662F\u8FD9\u4E00\u74F6\u6CA1\u6709\u6545\u4E8B\u3002\u989C\u8272\uFF1A\u6CA1\u6709\u3002",
    notes: ["\u6CA1\u6709\u6C14\u5473\u3002\u6CA1\u6709\u5473\u9053\u3002\u53EA\u6709\u6C14\u6CE1\u3002", "\u6C14\u6CE1\u662F\u5B83\u5168\u90E8\u7684\u6027\u683C\u3002\u5012\u8FDB\u676F\u5B50\uFF0C\u5B83\u5636\u5636\u5730\u54CD\uFF0C\u5728\u6DB2\u9762\u4E0A\u5236\u9020\u4E00\u5C42\u6301\u7EED\u4E0D\u65AD\u7684\u5FAE\u5C0F\u7206\u88C2\u3002\u5165\u53E3\u7684\u611F\u89C9\u662F\u5E72\u51C0\u7684\u523A\u6FC0\u2014\u2014\u820C\u9762\u88AB\u65E0\u6570\u7EC6\u5C0F\u7684\u9488\u540C\u65F6\u70B9\u4E86\u4E00\u4E0B\uFF0C\u7136\u540E\u4EC0\u4E48\u90FD\u6CA1\u4E86\u3002", '\u82CF\u6253\u6C34\u5728\u8C03\u9152\u91CC\u7684\u4F5C\u7528\u662F\u7A00\u91CA\u548C\u5145\u6C14\uFF0C\u4F46"\u7A00\u91CA"\u8FD9\u4E2A\u8BCD\u4E0D\u516C\u5E73\u3002\u5B83\u505A\u7684\u4E8B\u60C5\u66F4\u50CF\u662F\u628A\u4E00\u676F\u9152\u7684\u6240\u6709\u5473\u9053\u90FD\u5F80\u8FDC\u5904\u63A8\u4E86\u4E00\u6B65\u2014\u2014\u6BCF\u4E00\u79CD\u5473\u9053\u90FD\u8FD8\u5728\uFF0C\u4F46\u90FD\u53D8\u5F97\u66F4\u8F7B\u3001\u66F4\u6563\u3001\u66F4\u5BB9\u6613\u5165\u53E3\u3002\u6C14\u6CE1\u8BA9\u9152\u6DB2\u5728\u5634\u91CC\u5F85\u4E0D\u4F4F\uFF0C\u4F60\u8FD8\u6CA1\u4ED4\u7EC6\u54C1\u5C31\u5DF2\u7ECF\u54BD\u4E0B\u53BB\u4E86\u3002', "\u5B83\u8BA9\u559D\u9152\u8FD9\u4EF6\u4E8B\u53D8\u5F97\u66F4\u5FEB\u3001\u66F4\u4E0D\u90D1\u91CD\u3002\u6709\u65F6\u5019\u8FD9\u6B63\u662F\u4F60\u8981\u7684\u3002"]
  },
  "\u53EF\u4E50": {
    bottle: "\u74F6\u8EAB\uFF1A\u4F60\u77E5\u9053\u5B83\u957F\u4EC0\u4E48\u6837\u3002\u989C\u8272\uFF1A\u6DF1\u8910\u8272\uFF0C\u8FD1\u4E4E\u9ED1\u3002\u6CE1\u6CAB\u662F\u6D45\u68D5\u8272\u7684\uFF0C\u6BD4\u5564\u9152\u7684\u6CE1\u6CAB\u7C97\u3001\u6563\u5F97\u66F4\u5FEB\u3002",
    notes: ["\u4E00\u6253\u5F00\u5C31\u662F\u90A3\u4E2A\u5473\u9053\u2014\u2014\u7126\u7CD6\u3001\u8089\u6842\u548C\u6A59\u76AE\u6DF7\u5728\u4E00\u8D77\u7684\u751C\u9999\uFF0C\u5168\u4E16\u754C\u7684\u9F3B\u5B50\u90FD\u8BA4\u8BC6\u5B83\u3002\u6C14\u6CE1\u51B2\u51FA\u6765\u7684\u65F6\u5019\u628A\u8FD9\u80A1\u751C\u5473\u76F4\u63A5\u63A8\u5230\u4F60\u9762\u524D\uFF0C\u50CF\u4E00\u4E2A\u4E0D\u4F1A\u5C0F\u58F0\u8BF4\u8BDD\u7684\u4EBA\u3002", "\u5165\u53E3\uFF1A\u751C\u3002\u538B\u5012\u6027\u7684\u751C\u3002\u6C14\u6CE1\u5728\u820C\u9762\u4E0A\u7206\u5F00\u7684\u540C\u65F6\u7126\u7CD6\u5473\u94FA\u6EE1\u6574\u4E2A\u53E3\u8154\u3002\u7136\u540E\u8089\u6842\u548C\u6A59\u76AE\u4ECE\u751C\u5473\u5E95\u4E0B\u63A2\u51FA\u5934\u2014\u2014\u4E00\u70B9\u8F9B\u8FA3\u3001\u4E00\u70B9\u67D1\u6A58\u7684\u9178\uFF0C\u4F46\u53EA\u591F\u8BA9\u4F60\u610F\u8BC6\u5230\u8FD9\u676F\u4E1C\u897F\u4E0D\u662F\u7EAF\u7CD6\u6C34\u3002\u54BD\u4E0B\u53BB\u4E4B\u540E\u751C\u5473\u6302\u5728\u5634\u91CC\uFF0C\u9ECF\u7684\u3002", "\u53EF\u4E50\u5728\u8C03\u9152\u91CC\u662F\u4E00\u4E2A\u5F3A\u52BF\u7684\u4F19\u4F34\u3002\u5B83\u7684\u751C\u5EA6\u548C\u9999\u6C14\u53EF\u4EE5\u76D6\u4F4F\u51E0\u4E4E\u4EFB\u4F55\u70C8\u9152\u7684\u68F1\u89D2\u2014\u2014\u6717\u59C6\u52A0\u53EF\u4E50\uFF0C\u5A01\u58EB\u5FCC\u52A0\u53EF\u4E50\uFF0C\u4F60\u751A\u81F3\u5C1D\u4E0D\u51FA\u7528\u4E86\u54EA\u79CD\u9152\u3002\u8FD9\u65E2\u662F\u5B83\u7684\u4F18\u70B9\u4E5F\u662F\u5B83\u7684\u95EE\u9898\uFF1A\u5B83\u4F1A\u8BA9\u4F60\u5FD8\u8BB0\u4F60\u5728\u559D\u7684\u4E1C\u897F\u6709\u591A\u70C8\u3002"]
  }
};
function ingredientManualFor(name) {
  return ingredientManual[String(name || "").trim()] || null;
}

// src/content/realPack.js
var statusCopy = {
  \u584C: { ...DEFAULT_STATUS_COPY.\u584C },
  \u5410: { ...DEFAULT_STATUS_COPY.\u5410 },
  \u5B95\u673A: { ...DEFAULT_STATUS_COPY.\u5B95\u673A },
  \u65AD\u7247: { ...DEFAULT_STATUS_COPY.\u65AD\u7247 }
};
var hiddenOutcomes = {
  [HIDDEN_BLACK_NAME]: {
    name: "\u4E94\u5F69\u6591\u6593\u7684\u9ED1",
    identity: "hidden / unlisted",
    intro: "\u4E00\u676F\u6DF1\u8272\u7684\u6DB2\u4F53\uFF0C\u4F60\u8BF4\u4E0D\u597D\u7A76\u7ADF\u662F\u4EC0\u4E48\u989C\u8272\uFF0C\u5B83\u6709\u7740\u9ED1\u7684\u6DF1\u9083\u548C\u5F69\u8272\u7684\u6591\u6593\u3002",
    effectText: "\u5165\u53E3\u7684\u5473\u9053\u662F\u590D\u6742\u7684\uFF0C\u9178\u751C\u82E6\u8FA3\u54B8\u90FD\u62E7\u6210\u4E86\u4E00\u56E2\uFF0C\u4F60\u89C9\u5F97\u597D\u50CF\u9152\u6DB2\u5728\u6253\u4F60\u3002\n\u4F60\u7684\u80C3\u76B1\u4E86\u8D77\u6765\uFF0C\u4F60\u4F38\u624B\u53BB\u6276\u684C\u6CBF\u2014\u2014",
    flavorText: "\u4E00\u4E2A\u5F88\u590D\u6742\u3001\u4EC0\u4E48\u90FD\u6709\u7684\u5473\u9053\u3002"
  },
  [HIDDEN_HEAVEN_NAME]: {
    name: "heaven",
    identity: "hidden / unlisted",
    intro: "\u8FD9\u662F\u4E00\u676F\u900F\u660E\u7684\u9152\uFF0C\u53EF\u662F\u53C8\u4E0D\u50CF\u6C34\u90A3\u4E48\u7A7A\u2014\u2014\u4F60\u597D\u50CF\u80FD\u4ECE\u91CC\u9762\u770B\u5230\u661F\u5149\u3002",
    effectText: "\u8F9B\u8FA3\uFF0C\u706B\u4ECE\u5B83\u63A5\u89E6\u8FC7\u7684\u5730\u65B9\u70E7\u4E86\u8D77\u6765\u3002\n\u4F60\u7684\u5927\u8111\u4E2D\u4E00\u7247\u7A7A\u767D\uFF0C\u8EAB\u8FB9\u7684\u4EBA\uFF0C\u6216\u8005\u795E\uFF0C\u5728\u7528\u5947\u602A\u7684\u8BED\u8A00\u8BF4\u7740\u4EC0\u4E48\uFF0C\n\u4F60\u611F\u89C9\u5230\u5B87\u5B99\u5728\u4F60\u7684\u8EAB\u4F53\u91CC\u81A8\u80C0\uFF0C\u81A8\u80C0\u2014\u2014",
    flavorText: null
  }
};
var realReactionCurve = (chat) => ({
  \u4EB2\u8FD1: 0.9 * chat,
  \u5B88\u95E8: -0.7 * chat,
  \u6B32\u671B: 1 * chat
});
var realAdoptionWeights = {
  \u6109\u60A6: 0.75,
  \u5524\u9192: 0.65,
  \u4EB2\u8FD1: 0.85,
  \u5B88\u95E8: 0.55,
  \u6B32\u671B: 0.7,
  \u7CBE\u5EA6: 0
};
var alcoholBeliefPhys = doseToPhysiology(1);
var caffeineBeliefPhys = caffeineToPhysiology(1);
var beliefProfiles = {
  \u9152\u7CBE: {
    \u6109\u60A6: alcoholBeliefPhys.\u6109\u60A6,
    \u5524\u9192: alcoholBeliefPhys.\u5524\u9192,
    \u4EB2\u8FD1: realReactionCurve(1).\u4EB2\u8FD1,
    \u5B88\u95E8: realReactionCurve(1).\u5B88\u95E8,
    \u6B32\u671B: realReactionCurve(1).\u6B32\u671B,
    \u7CBE\u5EA6: 0
  },
  \u5496\u5561\u56E0: {
    \u6109\u60A6: caffeineBeliefPhys.\u6109\u60A6,
    \u5524\u9192: caffeineBeliefPhys.\u5524\u9192,
    \u4EB2\u8FD1: 0,
    \u5B88\u95E8: 0,
    \u6B32\u671B: 0,
    \u7CBE\u5EA6: 0
  }
};
var ratioThresholds = {
  "\u751C/\u9178": { low: 0.6, high: 2, lowWord: "\u5C16", midWord: "\u5E73\u8861", highWord: "\u817B" },
  "\u751C/\u82E6": { low: 0.6, high: 2, lowWord: "\u5CFB", midWord: "\u4E2D", highWord: "\u5706" },
  "\u9999/(\u82E6+\u6DA9)": { low: 0.5, high: 2, lowWord: "\u88AB\u522E\u6389", midWord: "\u4E2D", highWord: "\u94FA\u5F97\u5F00" },
  \u603B\u91CF: { low: 2, high: 12, lowWord: "\u5BE1", midWord: "\u4E2D", highWord: "\u6EE1" }
};
var flavorLexicon = {
  \u70C8: {
    \u4F4E: [
      { pattern: "\u4E00\u70B9\u70ED", text: "\u6709\u4E00\u70B9\u70ED\u4ECE\u820C\u9762\u6563\u5F00\u3002" },
      { pattern: "\u534A\u79D2", text: "\u70ED\u5728\u820C\u9762\u505C\u4E86\u534A\u79D2\uFF0C\u5C31\u9000\u4E86\u3002" }
    ],
    \u4E2D: [
      { pattern: "\u538B\u4E0A\u6765", text: "\u9152\u7CBE\u7684\u70ED\u538B\u4E0A\u6765\uFF0C\u4E00\u65F6\u538B\u4E0D\u4F4F\u3002" },
      { pattern: "\u5589\u5934\u70ED", text: "\u54BD\u4E0B\u53BB\u65F6\u5589\u5934\u4E00\u70ED\uFF0C\u6BD4\u521A\u624D\u91CD\u3002" }
    ],
    \u9AD8: [
      { pattern: "\u8FD8\u7559\u7740", text: "\u707C\u70E7\u8FD8\u7559\u7740\uFF0C\u9F3B\u8154\u91CC\u4E5F\u51B2\u7740\u3002" },
      { pattern: "\u70E7\u5230\u5E95", text: "\u4E00\u8DEF\u70E7\u4E0B\u53BB\uFF0C\u80F8\u53E3\u90FD\u70ED\u5B9A\u4E86\u3002" }
    ]
  },
  \u751C: {
    \u4F4E: [
      { pattern: "\u4F3C\u6709\u4F3C\u65E0", text: "\u751C\u5473\u4F3C\u6709\u4F3C\u65E0\uFF0C\u521A\u78B0\u5230\u5C31\u5316\u4E86\u3002" },
      { pattern: "\u56DE\u751C", text: "\u54BD\u4E0B\u53BB\u4E4B\u540E\uFF0C\u624D\u6709\u4E00\u70B9\u751C\u56DE\u4E0A\u6765\u3002" }
    ],
    \u4E2D: [
      { pattern: "\u94FA\u5F00", text: "\u751C\u5728\u820C\u9762\u94FA\u5F00\uFF0C\u52FE\u7740\u4E0D\u8D70\u3002" },
      { pattern: "\u5316\u4E0D\u5F00", text: "\u751C\u5F97\u5316\u4E0D\u5F00\uFF0C\u88F9\u4F4F\u6BCF\u4E00\u53E3\u3002" }
    ],
    \u9AD8: [
      { pattern: "\u76D6\u4F4F", text: "\u751C\u628A\u522B\u7684\u90FD\u76D6\u4F4F\u4E86\uFF0C\u50CF\u5316\u4E0D\u5F00\u7684\u7CD6\u3002" },
      { pattern: "\u53D1\u9F41", text: "\u751C\u5F97\u53D1\u9F41\uFF0C\u820C\u9762\u50CF\u88F9\u4E86\u5C42\u7CD6\u6D46\u3002" }
    ]
  },
  \u9178: {
    \u4F4E: [
      { pattern: "\u8F7B\u5212", text: "\u9178\u5728\u820C\u4FA7\u8F7B\u8F7B\u5212\u4E86\u4E00\u4E0B\u3002" },
      { pattern: "\u5FAE\u4EAE", text: "\u53E3\u8154\u4EAE\u4E86\u4E00\u70B9\uFF0C\u50CF\u6CBE\u8FC7\u67D1\u6A58\u76AE\u3002" }
    ],
    \u4E2D: [
      { pattern: "\u63D0\u4EAE", text: "\u9178\u628A\u53E3\u91CC\u7684\u4E1C\u897F\u90FD\u63D0\u4EAE\u4E86\uFF0C\u751F\u6D25\u8DDF\u7740\u6765\u3002" },
      { pattern: "\u4E00\u6FC0", text: "\u816E\u5E2E\u4E00\u9178\uFF0C\u4EBA\u8DDF\u7740\u6E05\u9192\u534A\u5206\u3002" }
    ],
    \u9AD8: [
      { pattern: "\u7259\u7F1D", text: "\u9178\u6D78\u5230\u7259\u7F1D\u91CC\uFF0C\u78B0\u4E00\u4E0B\u90FD\u53D1\u8F6F\u3002" },
      { pattern: "\u5C16\u9510", text: "\u9178\u5C16\u5F97\u624E\u4EBA\uFF0C\u7259\u6839\u90FD\u8DDF\u7740\u53D1\u9EBB\u3002" }
    ]
  },
  \u82E6: {
    \u4F4E: [
      { pattern: "\u98D8\u8FC7\u4E00\u4E1D", text: "\u820C\u6839\u98D8\u8FC7\u4E00\u4E1D\u82E6\uFF0C\u7728\u773C\u5C31\u6C89\u4E86\u3002" },
      { pattern: "\u6CDB\u8D77", text: "\u820C\u6839\u8FD9\u65F6\u624D\u6CDB\u8D77\u4E00\u70B9\u82E6\u3002" }
    ],
    \u4E2D: [
      { pattern: "\u5F80\u540E\u63A8", text: "\u82E6\u628A\u751C\u548C\u9999\u90FD\u5F80\u540E\u63A8\uFF0C\u5360\u4F4F\u820C\u6839\u3002" },
      { pattern: "\u6C89\u5E95", text: "\u82E6\u5473\u6C89\u5728\u5E95\u4E0B\uFF0C\u6BCF\u53E3\u90FD\u538B\u7740\u4E00\u70B9\u3002" }
    ],
    \u9AD8: [
      { pattern: "\u600E\u4E48\u54BD", text: "\u82E6\u600E\u4E48\u54BD\u90FD\u5728\uFF0C\u54BD\u5B8C\u53C8\u5192\u5934\u3002" },
      { pattern: "\u6EE1\u5634\u82E6", text: "\u6EE1\u5634\u90FD\u662F\u82E6\u7684\uFF0C\u6536\u4E0D\u4F4F\u3002" }
    ]
  },
  \u9999: {
    \u4F4E: [
      { pattern: "\u6349\u4E0D\u4F4F", text: "\u9999\u6C14\u521A\u8981\u6349\u4F4F\u5C31\u6563\u4E86\u3002" },
      { pattern: "\u8BF4\u4E0D\u6E05\u6765\u5904", text: "\u9F3B\u5C16\u5148\u78B0\u5230\u4E00\u70B9\u9999\uFF0C\u8BF4\u4E0D\u6E05\u6765\u5904\u3002" }
    ],
    \u4E2D: [
      { pattern: "\u7ED5\u7740", text: "\u9999\u5728\u9F3B\u8154\u91CC\u7ED5\u7740\uFF0C\u968F\u56DE\u5473\u56DE\u6765\u3002" },
      { pattern: "\u6EE1\u53E3", text: "\u6EE1\u53E3\u90FD\u662F\u9999\u7684\uFF0C\u540E\u5473\u4E5F\u5E26\u82B1\u6C14\u3002" }
    ],
    \u9AD8: [
      { pattern: "\u51B2\u5F97\u9AD8", text: "\u9999\u51B2\u5F97\u5F88\u9AD8\uFF0C\u4E00\u53E3\u5C31\u95FB\u5F97\u89C1\u6765\u5904\u3002" },
      { pattern: "\u5F80\u5916\u5192", text: "\u9999\u6C14\u5F80\u5916\u5192\uFF0C\u60F3\u8EB2\u90FD\u8EB2\u4E0D\u5F00\u3002" }
    ]
  },
  \u6DA9: {
    \u4F4E: [
      { pattern: "\u7EF7\u7EBF", text: "\u820C\u9762\u5FAE\u5FAE\u4E00\u6536\uFF0C\u50CF\u7EF7\u4E86\u6839\u7EBF\u3002" },
      { pattern: "\u8D77\u76B1", text: "\u820C\u9762\u50CF\u8D77\u4E86\u5C42\u770B\u4E0D\u89C1\u7684\u76B1\u3002" }
    ],
    \u4E2D: [
      { pattern: "\u7F29\u7D27", text: "\u6DA9\u628A\u53E3\u91CC\u7F29\u7D27\u4E86\uFF0C\u751F\u6D25\u4E4B\u524D\u5148\u5E72\u3002" },
      { pattern: "\u5148\u5E72", text: "\u4E24\u988A\u5148\u5E72\u4E86\u4E00\u4E0B\uFF0C\u6D25\u6DB2\u624D\u6162\u6162\u56DE\u6765\u3002" }
    ],
    \u9AD8: [
      { pattern: "\u6525\u4F4F", text: "\u6DA9\u5F97\u53D1\u7D27\uFF0C\u50CF\u88AB\u4EC0\u4E48\u6525\u4F4F\u3002" },
      { pattern: "\u9501\u7D27", text: "\u53E3\u8154\u6574\u4E2A\u9501\u7D27\uFF0C\u5F20\u90FD\u5F20\u4E0D\u5F00\u3002" }
    ]
  }
};
var effectLexicon = {
  \u6109\u60A6: {
    "+": {
      \u4F4E: "\u5589\u5499\u91CC\u90A3\u53E3\u6C14\u4E0D\u77E5\u4EC0\u4E48\u65F6\u5019\u677E\u4E86\u3002\u5C31\u4E00\u70B9\u3002",
      \u4E2D: "\u4F60\u8FD8\u5750\u5728\u90A3\u5F20\u6905\u5B50\u4E0A\uFF0C\u6109\u60A6\u4ECE\u80F8\u53E3\u722C\u51FA\u6765\uFF0C\u6E29\u6E29\u7684\uFF0C\u4F60\u5728\u53CD\u5C04\u4E2D\u770B\u5230\u4E86\u81EA\u5DF1\u4E0A\u626C\u7684\u5634\u89D2\u3002",
      \u9AD8: "\u597D\uFF0C\u5C31\u73B0\u5728\u3002\u6574\u4E2A\u4EBA\u9677\u8FDB\u4E00\u56E2\u8F6F\u91CC\uFF0C\u4E0D\u60F3\u52A8\u4E86\u3002\u660E\u5929\u7684\u4E8B\u2014\u2014\u4ECA\u665A\u6CA1\u6709\u660E\u5929\u3002"
    },
    "\u2212": {
      \u4F4E: "\u547C\u2014\u2014\u5438\u2014\u2014\n\u4F60\u6CA1\u610F\u8BC6\u5230\u5B83\u597D\u50CF\u53D8\u6162\u4E86\uFF0C\u53C8\u597D\u50CF\u53D8\u5FEB\u4E86\u3002",
      \u4E2D: "\u623F\u95F4\u8FD8\u662F\u90A3\u4E2A\u623F\u95F4\uFF0C\u53EA\u662F\u706F\u50CF\u8499\u4E86\u7070\uFF0C\u4EC0\u4E48\u90FD\u6697\u4E86\u4E00\u622A\u3002",
      \u9AD8: "\u4E00\u5207\u90FD\u7CDF\u900F\u4E86\u3002"
    }
  },
  \u5524\u9192: {
    "+": {
      \u4F4E: "\u50CF\u88AB\u9759\u7535\u6253\u4E86\u4E00\u4E0B\u3002\u5F88\u77ED\uFF0C\u4F46\u4F60\u4E4B\u540E\u4E00\u76F4\u5728\u7B49\u7B2C\u4E8C\u4E0B\u3002",
      \u4E2D: "\u4F60\u5750\u4E0D\u4F4F\u4E86\u3002\u4E0D\u662F\u8981\u53BB\u54EA\u513F\uFF0C\u662F\u8EAB\u4F53\u91CC\u591A\u51FA\u6765\u4E00\u622A\u4E1C\u897F\u6CA1\u5904\u653E\u3002",
      \u9AD8: "\u65F6\u95F4\u6162\u4E0B\u6765\u4E86\uFF0C\u56E0\u4E3A\u4F60\u53D8\u5FEB\u4E86\u3002\u4F60\u770B\u5F97\u89C1\u5BF9\u9762\u4EBA\u776B\u6BDB\u7684\u98A4\u52A8\u3001\u5634\u5507\u5408\u4E0A\u7684\u5F62\u72B6\uFF0C\u51E0\u5343\u4E07\u4EBF\u6761\u5FF5\u5934\u540C\u65F6\u4ECE\u8111\u5B50\u91CC\u8FF8\u51FA\u6765\uFF0C\u706F\u5149\u4EAE\u5F97\u773C\u775B\u53D1\u75BC\u3002\u6BCF\u4E00\u6837\u4E1C\u897F\u90FD\u5728\uFF0C\u800C\u4E14\u90FD\u592A\u6E05\u695A\u4E86\u3002"
    },
    "\u2212": {
      \u4F4E: "\u4E16\u754C\u8FD8\u5728\u90A3\u513F\uFF0C\u53EA\u662F\u6162\u534A\u62CD\uFF0C\u50CF\u9694\u7740\u8499\u4E86\u6C34\u6C7D\u7684\u73BB\u7483\u3002",
      \u4E2D: "\u5BF9\u9762\u7684\u4EBA\u7B11\u5B8C\u4E86\uFF0C\u4F60\u624D\u53CD\u5E94\u8FC7\u6765\u597D\u7B11\u5728\u54EA\u91CC\u3002\u60F3\u8BF4\u70B9\u4EC0\u4E48\uFF0C\u90A3\u53E5\u8BDD\u5374\u5728\u534A\u8DEF\u8FF7\u4E86\u8DEF\u3002",
      \u9AD8: "\u4F60\u8FD8\u5750\u5728\u8FD9\u91CC\u3002\u8170\u662F\u76F4\u7684\uFF0C\u773C\u775B\u662F\u7741\u7740\u7684\uFF0C\u4F46\u91CC\u9762\u90A3\u4E2A\u4EBA\u5DF2\u7ECF\u7761\u7740\u4E86\u3002"
    }
  },
  \u4EB2\u8FD1: {
    "+": {
      \u4F4E: "\u8FDC\u5904\u7684\u4EBA\u58F0\u542C\u4E0A\u53BB\u4E0D\u5435\u4E86\uFF0C\u5012\u50CF\u80CC\u666F\u4E50\u3002\u5BF9\u9762\u90A3\u4E2A\u4EBA\u7684\u58F0\u97F3\uFF0C\u53CD\u800C\u66F4\u6E05\u695A\u4E86\u3002",
      \u4E2D: "\u8BDD\u591A\u4E86\u8D77\u6765\u3002\u5E73\u65F6\u4E09\u53E5\u5C31\u8BF4\u5B8C\u7684\u8BDD\u9898\uFF0C\u8FD9\u4F1A\u513F\u80FD\u7ED5\u7740\u804A\u5F88\u4E45\u3002\u90A3\u4E2A\u4EBA\u8BF4\u7684\u4F60\u90FD\u63A5\u5F97\u4F4F\uFF0C\u8FD8\u60F3\u518D\u542C\u3002",
      \u9AD8: "\u5F00\u59CB\u8BF4\u5E73\u65F6\u4E0D\u8BF4\u7684\u8BDD\u3002\u58F0\u97F3\u4F4E\u4E0B\u53BB\uFF0C\u8DDD\u79BB\u8FD1\u4E86\u534A\u6B65\u2014\u2014\u4ECA\u665A\u8FD9\u4E2A\u4EBA\uFF0C\u8BF4\u4EC0\u4E48\u90FD\u5BF9\u3002"
    },
    "\u2212": {
      \u4F4E: "\u6709\u4EBA\u5750\u8FC7\u6765\uFF0C\u4F60\u6362\u4E86\u4E2A\u59FF\u52BF\uFF0C\u5F80\u5916\u632A\u4E86\u4E00\u70B9\u3002",
      \u4E2D: "\u56DE\u5E94\u53D8\u77ED\u4E86\uFF0C\u53EA\u5269\u8F7B\u8F7B\u7684\u300C\u55EF\u300D\u3002\u90A3\u4E2A\u4EBA\u8FD8\u5728\u8BF4\uFF0C\u4F60\u4E5F\u8FD8\u5728\u542C\uFF0C\u53EA\u662F\u63A5\u4E0D\u4F4F\u4E86\u3002",
      \u9AD8: "\u4EC0\u4E48\u90FD\u79BB\u5F97\u592A\u8FD1\u4E86\u3002\u60F3\u51FA\u53BB\u7AD9\u4E00\u4F1A\u513F\uFF0C\u4E00\u4E2A\u4EBA\u5F85\u7740\u3002\u5148\u522B\u8DDF\u6765\u2014\u2014\u5C31\u4E00\u5C0F\u4F1A\u513F\u3002"
    }
  },
  \u5B88\u95E8: {
    "+": {
      \u4F4E: "\u5FC3\u91CC\u90A3\u9053\u95E8\u5173\u62E2\u4E86\u4E00\u6307\u5BBD\u3002\u4E0D\u591A\uFF0C\u4E00\u6307\u3002",
      \u4E2D: "\u95E8\u95E9\u843D\u4E0B\u4E86\u3002\u518D\u60F3\u8FDB\u6765\uFF0C\u5F97\u5148\u8BF4\u6E05\u695A\u2014\u2014\u4F60\u662F\u8C01\uFF0C\u6765\u505A\u4EC0\u4E48\uFF0C\u60F3\u8981\u4EC0\u4E48\u3002",
      \u9AD8: "\u95E8\u5173\u5F97\u5F88\u7D27\uFF0C\u8FD8\u6302\u4E0A\u4E86\u94FE\u6761\u3002\u91CC\u9762\u5B89\u9759\u5F97\u80FD\u542C\u89C1\u8840\u5728\u8033\u6735\u91CC\u8D70\u3002"
    },
    "\u2212": {
      \u4F4E: "\u95E8\u597D\u50CF\u6CA1\u5173\u4E25\u3002\u8BF4\u8D77\u6765\uFF0C\u521A\u624D\u660E\u660E\u8FD8\u662F\u597D\u597D\u7684\u3002\u98CE\u4ECE\u7F1D\u91CC\u6E9C\u8FDB\u6765\uFF0C\u51C9\u7684\u3002",
      \u4E2D: "\u95E8\u95E9\u81EA\u5DF1\u6ED1\u5F00\u4E86\u3002\u95E8\u8FD8\u7ACB\u5728\u539F\u5904\uFF0C\u53EF\u865A\u63A9\u7740\u2014\u2014\u63A8\u4E00\u4E0B\u5C31\u5F00\u3002",
      \u9AD8: "\u90A3\u9053\u95E8\u4E0D\u89C1\u4E86\u3002\u8FDE\u95E8\u6846\u7684\u5F71\u5B50\u90FD\u6CA1\u6709\u5269\u4E0B\uFF0C\u4E2D\u95F4\u7A7A\u51FA\u4E00\u6761\u8FC7\u9053\uFF0C\u98CE\u4ECE\u8FD9\u5934\u7A7F\u5230\u90A3\u5934\u3002"
    }
  },
  \u6B32\u671B: {
    "+": {
      \u4F4E: "\u6709\u4E2A\u300C\u60F3\u8981\u300D\u6084\u6084\u5192\u4E86\u5934\u3002\u8FD8\u770B\u4E0D\u6E05\u662F\u4EC0\u4E48\uFF0C\u6307\u5C16\u5148\u8737\u4E86\u4E00\u4E0B\u3002",
      \u4E2D: "\u90A3\u4E2A\u300C\u8981\u300D\u8D8A\u6765\u8D8A\u6C89\uFF0C\u6574\u4E2A\u4EBA\u671D\u7740\u5B83\u503E\u659C\u3002\u95EE\u4E3A\u4EC0\u4E48\u662F\u6CA1\u7528\u7684\u2014\u2014\u5B83\u4E0D\u89E3\u91CA\uFF0C\u53EA\u7BA1\u62C9\u3002",
      \u9AD8: "\u60F3\u8981\u3002\u7EA2\u7684\u3001\u9ED1\u7684\u5728\u91CC\u9762\u7FFB\u6D8C\uFF0C\u8D2A\u5A6A\uFF0C\u6E34\u671B\uFF0C\u5939\u6742\u7740\u4E00\u4E1D\u771F\u5FC3\u3002\u86C7\u8FD8\u5728\u90A3\u91CC\uFF0C\u4F60\u6709\u65F6\u5019\u4F1A\u89C9\u5F97\u81EA\u5DF1\u5C31\u662F\u90A3\u6761\u86C7\u2014\u2014\u60F3\u8981\u4EC0\u4E48\uFF0C\u60F3\u5403\u4EC0\u4E48\uFF0C\u7A7A\u865A\u63A8\u7740\u4F60\u5403\u6389\u81EA\u5DF1\u7684\u5C3E\u5DF4\u3002\u4F46\u662F\u6CA1\u6709\u7528\u3002"
    },
    "\u2212": {
      \u4F4E: "\u6709\u4EC0\u4E48\u4E1C\u897F\u8F7B\u8F7B\u6447\u4E86\u6447\u5934\u3002\u4E0D\u662F\u4F60\u6447\u7684\u3002",
      \u4E2D: "\u4E0D\u662F\u505A\u4E0D\u5230\uFF0C\u662F\u4E0D\u8981\u3002\u8FD9\u4E24\u4E2A\u5B57\u7684\u8FB9\u754C\uFF0C\u4ECA\u5929\u683C\u5916\u6E05\u695A\u3002",
      \u9AD8: "\u4E0D\u3002\u4E0D\u3002\u4E0D\u3002\u6700\u540E\u8FDE\u5B57\u90FD\u6CA1\u6709\u4E86\uFF0C\u53EA\u5269\u4E0B\u6447\u5934\u3002"
    }
  },
  \u7CBE\u5EA6: {
    "\u2212": {
      \u4F4E: "\u8D70\u4E86\u534A\u79D2\u795E\u3002\u90A3\u53E5\u8BDD\u4ECE\u8033\u8FB9\u8FC7\u53BB\uFF0C\u516D\u4E2A\u5B57\uFF0C\u63A5\u4F4F\u4E86\u56DB\u4E2A\u3002",
      \u4E2D: "\u5927\u65B9\u5411\u8FD8\u5728\uFF0C\u5206\u5BF8\u5374\u677E\u4E86\u3002\u77E5\u9053\u8BE5\u5728\u54EA\u91CC\u505C\u4E0B\uFF0C\u771F\u5230\u4E86\u90A3\u513F\uFF0C\u53C8\u8F7B\u8F7B\u6ED1\u8FC7\u53BB\u4E00\u622A\u3002",
      \u9AD8: "\u5FF5\u5934\u6324\u6210\u4E00\u56E2\uFF0C\u5206\u4E0D\u51FA\u5148\u540E\u3002\u60F3\u76F8\u4FE1\u54EA\u4E00\u4E2A\u2014\u2014\u54EA\u4E00\u4E2A\u90FD\u5728\u6643\u3002"
    }
  }
};
var ingredients = {
  \u91D1\u9152: { abv: 0.43, colorTag: "\u900F\u660E", treePath: ["\u8349\u672C", "\u675C\u677E"], flavor: { \u70C8: 4, \u751C: 0, \u9178: 0.5, \u82E6: 1, \u9999: 4, \u6DA9: 0.5 } },
  \u4F0F\u7279\u52A0: { abv: 0.4, colorTag: "\u900F\u660E", treePath: ["\u65E0"], flavor: { \u70C8: 5, \u751C: 0, \u9178: 0, \u82E6: 0, \u9999: 0, \u6DA9: 0 } },
  \u767D\u6717\u59C6: { abv: 0.4, colorTag: "\u900F\u660E", treePath: ["\u751C\u9999", "\u7518\u8517"], flavor: { \u70C8: 4, \u751C: 2, \u9178: 0, \u82E6: 0, \u9999: 2, \u6DA9: 0 } },
  \u9ED1\u6717\u59C6: { abv: 0.4, colorTag: "\u6DF1\u68D5", treePath: ["\u751C\u9999", "\u7126\u7CD6"], flavor: { \u70C8: 4, \u751C: 3, \u9178: 0, \u82E6: 1, \u9999: 3, \u6DA9: 0.5 } },
  \u9F99\u820C\u5170: { abv: 0.4, colorTag: "\u900F\u660E", treePath: ["\u8349\u672C", "\u9F99\u820C\u5170"], flavor: { \u70C8: 5, \u751C: 0, \u9178: 1, \u82E6: 1, \u9999: 2, \u6DA9: 0.5 } },
  \u5A01\u58EB\u5FCC: { abv: 0.43, colorTag: "\u7425\u73C0", treePath: ["\u70DF", "\u6CE5\u7164"], flavor: { \u70C8: 4, \u751C: 0.5, \u9178: 0, \u82E6: 2, \u9999: 4, \u6DA9: 1 } },
  \u751C\u5473\u7F8E\u601D: { abv: 0.16, colorTag: "\u7EA2", treePath: ["\u751C\u9999", "\u9999\u8349"], flavor: { \u70C8: 1, \u751C: 3, \u9178: 0, \u82E6: 2, \u9999: 3, \u6DA9: 0 }, actives: [{ compound: "\u7CD6\u5206", amount: 0.4, referenceVolumeMl: 30 }, { compound: "\u82E6\u5473", amount: 0.2, referenceVolumeMl: 30 }] },
  \u5E72\u5473\u7F8E\u601D: { abv: 0.18, colorTag: "\u91D1\u9EC4", treePath: ["\u8349\u672C", "\u767D\u82B1"], flavor: { \u70C8: 1, \u751C: 0.5, \u9178: 0.5, \u82E6: 1, \u9999: 2, \u6DA9: 0 }, actives: [{ compound: "\u7CD6\u5206", amount: 0.1, referenceVolumeMl: 30 }, { compound: "\u82E6\u5473", amount: 0.3, referenceVolumeMl: 30 }] },
  \u91D1\u5DF4\u5229: { abv: 0.25, colorTag: "\u7EA2", treePath: ["\u82E6", "\u9F99\u80C6"], flavor: { \u70C8: 2, \u751C: 2, \u9178: 0.5, \u82E6: 5, \u9999: 3, \u6DA9: 0 }, actives: [{ compound: "\u82E6\u5473", amount: 1, referenceVolumeMl: 30 }, { compound: "\u7CD6\u5206", amount: 0.6, referenceVolumeMl: 30 }] },
  \u6A59\u76AE\u5229\u53E3\u9152: { abv: 0.4, colorTag: "\u91D1\u9EC4", treePath: ["\u679C", "\u67D1\u6A58"], flavor: { \u70C8: 2, \u751C: 3, \u9178: 1, \u82E6: 0, \u9999: 3, \u6DA9: 0 }, actives: [{ compound: "\u7CD6\u5206", amount: 0.75, referenceVolumeMl: 30 }, { compound: "\u82E6\u5473", amount: 0.2, referenceVolumeMl: 30 }] },
  \u5496\u5561\u5229\u53E3\u9152: { abv: 0.2, colorTag: "\u6DF1\u68D5", treePath: ["\u751C\u9999", "\u70D8\u7119"], flavor: { \u70C8: 1, \u751C: 3, \u9178: 0, \u82E6: 2, \u9999: 4, \u6DA9: 0 }, activeIngredient: "\u5496\u5561\u56E0", activeAmount: 0.5, referenceVolumeMl: 30 },
  \u82E6\u827E\u9152: { abv: 0.68, colorTag: "\u7EFF", treePath: ["\u8349\u672C", "\u8334\u9999"], flavor: { \u70C8: 5, \u751C: 0.5, \u9178: 0, \u82E6: 3, \u9999: 5, \u6DA9: 1 }, actives: [{ compound: "\u4FA7\u67CF\u916E", amount: 1, referenceVolumeMl: 30 }] },
  \u6E05\u9152: { abv: 0.15, colorTag: "\u900F\u660E", treePath: ["\u8C37\u7269", "\u7C73"], flavor: { \u70C8: 2, \u751C: 2, \u9178: 0.5, \u82E6: 0.5, \u9999: 3, \u6DA9: 0 } },
  \u5564\u9152: { abv: 0.05, colorTag: "\u91D1\u9EC4", treePath: ["\u8C37\u7269", "\u9EA6\u82BD"], flavor: { \u70C8: 1, \u751C: 1, \u9178: 0.5, \u82E6: 2, \u9999: 2, \u6DA9: 1.5 }, textures: ["\u6C14\u6CE1"], actives: [{ compound: "\u5564\u9152\u82B1", amount: 1, referenceVolumeMl: 350 }, { compound: "\u7CD6\u5206", amount: 0.5, referenceVolumeMl: 350 }] },
  \u7EA2\u8461\u8404\u9152: { abv: 0.13, colorTag: "\u7EA2", treePath: ["\u679C", "\u6D46\u679C"], flavor: { \u70C8: 3, \u751C: 1, \u9178: 2, \u82E6: 1, \u9999: 4, \u6DA9: 3 }, actives: [{ compound: "\u5355\u5B81", amount: 1, referenceVolumeMl: 150 }] },
  \u6C64\u529B\u6C34: { abv: 0, colorTag: "\u900F\u660E", treePath: ["\u82E6", "\u9F99\u80C6"], flavor: { \u70C8: 0, \u751C: 1, \u9178: 0.5, \u82E6: 3, \u9999: 1, \u6DA9: 0 }, textures: ["\u6C14\u6CE1"], diluent: true, actives: [{ compound: "\u594E\u5B81", amount: 1, referenceVolumeMl: 150 }] },
  \u82CF\u6253\u6C34: { abv: 0, colorTag: "\u900F\u660E", treePath: ["\u65E0"], flavor: { \u70C8: 0, \u751C: 0, \u9178: 0, \u82E6: 0, \u9999: 0, \u6DA9: 0 }, textures: ["\u6C14\u6CE1"], diluent: true },
  \u53EF\u4E50: { abv: 0, colorTag: "\u6DF1\u68D5", treePath: ["\u751C\u9999", "\u7126\u7CD6"], flavor: { \u70C8: 0, \u751C: 4, \u9178: 1, \u82E6: 0, \u9999: 3, \u6DA9: 0 }, textures: ["\u6C14\u6CE1"], actives: [{ compound: "\u5496\u5561\u56E0", amount: 0.5, referenceVolumeMl: 330 }, { compound: "\u7CD6\u5206", amount: 3.5, referenceVolumeMl: 330 }] },
  \u9752\u67E0\u6C41: { abv: 0, colorTag: "\u7EFF", treePath: ["\u679C", "\u67D1\u6A58"], flavor: { \u70C8: 0, \u751C: 1, \u9178: 5, \u82E6: 0, \u9999: 2, \u6DA9: 0 }, actives: [{ compound: "\u679C\u9178", amount: 1, referenceVolumeMl: 30 }] },
  \u67E0\u6AAC\u6C41: { abv: 0, colorTag: "\u91D1\u9EC4", treePath: ["\u679C", "\u67D1\u6A58"], flavor: { \u70C8: 0, \u751C: 1, \u9178: 5, \u82E6: 0, \u9999: 2, \u6DA9: 0 }, actives: [{ compound: "\u679C\u9178", amount: 0.8, referenceVolumeMl: 30 }] },
  \u7CD6\u6D46: { abv: 0, colorTag: "\u900F\u660E", treePath: ["\u751C\u9999", "\u7CD6"], flavor: { \u70C8: 0, \u751C: 5, \u9178: 0, \u82E6: 0, \u9999: 1, \u6DA9: 0 }, actives: [{ compound: "\u7CD6\u5206", amount: 1, referenceVolumeMl: 10 }] },
  \u6D53\u7F29\u5496\u5561: { abv: 0, colorTag: "\u6DF1\u68D5", treePath: ["\u751C\u9999", "\u70D8\u7119"], flavor: { \u70C8: 0, \u751C: 1, \u9178: 2, \u82E6: 4, \u9999: 5, \u6DA9: 1 }, activeIngredient: "\u5496\u5561\u56E0", activeAmount: 1, referenceVolumeMl: 30 },
  \u6C34: { abv: 0, colorTag: "\u900F\u660E", treePath: ["\u65E0"], flavor: { \u70C8: 0, \u751C: 0, \u9178: 0, \u82E6: 0, \u9999: 0, \u6DA9: 0 }, diluent: true },
  \u51B0: { abv: 0, colorTag: "\u900F\u660E", treePath: ["\u65E0"], flavor: { \u70C8: 0, \u751C: 0, \u9178: 0, \u82E6: 0, \u9999: 0, \u6DA9: 0 }, diluent: true, textures: ["\u51B0"] }
};
function partsToSources(parts, extraDilution = 0) {
  const liquid = parts.reduce((n, p) => n + p.volume, 0) + extraDilution;
  return parts.map((p) => {
    const ing = ingredients[p.id];
    return {
      id: p.id,
      volume: p.volume,
      abv: ing.abv,
      colorTag: ing.colorTag,
      treePath: ing.treePath,
      treePaths: [{ path: ing.treePath, weight: 1 }],
      flavor: { ...ing.flavor },
      volumeRatio: liquid > 0 ? p.volume / liquid : 0,
      diluent: !!ing.diluent,
      textures: ing.textures || []
    };
  });
}
function drinksOf(parts) {
  return parts.reduce((n, p) => n + mlToStandardDrinks(p.volume, ingredients[p.id].abv), 0);
}
function texturesOf(parts) {
  const t = /* @__PURE__ */ new Set();
  for (const p of parts) {
    for (const x of ingredients[p.id].textures || []) t.add(x);
  }
  return [...t];
}
function flavorComponents2(sources, totalVolume) {
  const comps = [];
  for (const src of sources) {
    for (const [axis, density] of Object.entries(src.flavor || {})) {
      if (!density) continue;
      const A = totalVolume > 0 ? density * src.volume / totalVolume : density;
      const tau = TAU[axis] || { rise: 1, fall: 15 };
      comps.push({ axis, A, tauRise: tau.rise, tauFall: tau.fall, source: src.id });
      if (axis === "\u70C8" && (src.abv || 0) > 0) {
        comps.push({
          axis: "\u70C8",
          A: 0.6 * A,
          tauRise: tau.nasalRise || 25,
          tauFall: tau.nasalFall || 40,
          source: src.id,
          nasal: true
        });
      }
    }
  }
  return comps;
}
function buildFromParts(name, parts, opts = {}) {
  const {
    beta = 1,
    mixerId = "mixer",
    drinkerId = "drinker",
    kind = "menu",
    intro = "",
    finish = "",
    description = "",
    effects = null,
    method,
    iceMl = 0,
    elapsedMin = 0,
    listed = true,
    garnishes = null,
    id,
    registeredEffectText = "",
    registeredFlavorText = "",
    category = null,
    internalHidden = false
  } = opts;
  const iceParts = iceMl > 0 ? [...parts, { id: "\u51B0", volume: iceMl }] : parts;
  const extra = dilutionVolume({
    liquidMl: parts.reduce((n, p) => n + p.volume, 0),
    iceMl,
    method,
    elapsedMin
  });
  const sources = partsToSources(iceParts, extra);
  if (extra > 0) {
    sources.push({
      id: "\u7A00\u91CA\u6C34",
      volume: extra,
      abv: 0,
      colorTag: "\u900F\u660E",
      treePath: ["\u65E0"],
      treePaths: [{ path: ["\u65E0"], weight: 1 }],
      flavor: { \u70C8: 0, \u751C: 0, \u9178: 0, \u82E6: 0, \u9999: 0, \u6DA9: 0 },
      volumeRatio: extra / (sources.reduce((n, s) => n + s.volume, 0) + extra),
      diluent: true
    });
    const total = sources.reduce((n, s) => n + s.volume, 0);
    for (const s of sources) s.volumeRatio = s.volume / total;
  }
  const totalVolume = sources.reduce((n, s) => n + s.volume, 0);
  const standardDrinks = drinksOf(parts);
  const textures = texturesOf(iceParts);
  const cupType = computeCupType({ totalVolume, textures, method });
  const color = computeColor(sources, totalVolume);
  const totalMouths = opts.totalMouths || Math.max(MIN_MOUTHS, Math.ceil(totalVolume / MOUTHFUL_ML));
  const abvMix = totalVolume > 0 ? parts.reduce((n, p) => n + p.volume * ingredients[p.id].abv, 0) / totalVolume : 0;
  const components = flavorComponents2(sources, totalVolume);
  const plain = isPlainName(name);
  const characterEffects = effects ? { ...effects, \u7CBE\u5EA6: 0 } : null;
  const baseVector = !plain && effects ? { ...effects, \u7CBE\u5EA6: 0 } : null;
  const mouths = Array.from({ length: totalMouths }, (_, i) => ({
    index: i,
    volume: totalVolume / totalMouths,
    abv: abvMix,
    components,
    beta,
    startTime: null,
    applied: false,
    // 到入口时再根据“真实身份 vs 声称身份”决定是否产生名字信念；这里不预烘焙。
    suggestion: null
  }));
  return {
    id: id || `cup-${name}`,
    claimedName: name,
    recipeId: name,
    recipe: parts.map((p) => ({ id: p.id, volume: p.volume })),
    // 纯装饰。不入 sources、不计体积、不参与任何判定。
    garnishes: normalizeGarnishes(garnishes),
    intro,
    finish,
    description,
    effects,
    characterEffects,
    characterIdentity: characterEffects ? name : null,
    registeredEffectText,
    registeredFlavorText,
    claimedEffectText: registeredEffectText || "",
    claimedFlavorText: registeredFlavorText || "",
    baseVector,
    kind,
    listed,
    category,
    internalHidden: !!internalHidden,
    mixerId,
    drinkerId,
    beta,
    totalVolume,
    totalMouths,
    standardDrinks,
    sources,
    mouths,
    textures,
    method,
    cupType,
    color,
    claimedFlavor: Object.fromEntries(
      ["\u70C8", "\u751C", "\u9178", "\u82E6", "\u9999", "\u6DA9"].map((a) => [
        a,
        sources.reduce((n, s) => n + (s.flavor?.[a] || 0) * s.volume / (totalVolume || 1), 0)
      ])
    ),
    caffeineTotal: caffeineOfParts(parts, ingredients),
    caffeinePerMouth: caffeineOfParts(parts, ingredients) / totalMouths,
    // 全部非酒精活性成分的整杯份数（含咖啡因）。逐口分摊在引擎侧做。
    activesTotal: collectActives(parts, ingredients)
  };
}
var MENU_DEFS = [
  { name: "\u5A01\u58EB\u5FCC", parts: [{ id: "\u5A01\u58EB\u5FCC", volume: 60 }], intro: "\u4E00\u53E3\u4E00\u505C\u7684\u6CE5\u7164\u3002", finish: "\u70DF\u8FD8\u7559\u5728\u820C\u6839\u3002", effects: { \u5B88\u95E8: 2, \u5524\u9192: -1, \u4EB2\u8FD1: 1 } },
  { name: "\u9F99\u820C\u5170", parts: [{ id: "\u9F99\u820C\u5170", volume: 45 }], intro: "\u6CA1\u6709\u505C\u987F\u7684\u4F59\u5730\u3002", finish: "\u542C\u89C1\u81EA\u5DF1\u600E\u4E48\u60F3\u3002", effects: { \u5524\u9192: 2, \u6109\u60A6: 1, \u5B88\u95E8: -2 } },
  { name: "\u4F0F\u7279\u52A0", parts: [{ id: "\u4F0F\u7279\u52A0", volume: 45 }], intro: "\u6CA1\u6709\u5473\u9053\u7684\u9152\u3002", finish: "\u4EC0\u4E48\u4E5F\u6CA1\u7559\u4E0B\u3002", effects: { \u6109\u60A6: 0, \u5524\u9192: 1 } },
  { name: "\u9ED1\u6717\u59C6", parts: [{ id: "\u9ED1\u6717\u59C6", volume: 60 }], iceMl: 60, intro: "\u751C\u5F97\u5F88\u7C97\u7CD9\u3002", finish: "\u7CD6\u871C\u8FD8\u5728\u3002", effects: { \u6109\u60A6: 1, \u4EB2\u8FD1: 1, \u5B88\u95E8: -1 } },
  // 白朗姆此前只有原料、没有酒款条目，所以「点不到、也没有效果」。
  // 文案与效果向量由 char 编写，状态同其余待定项。
  { name: "\u767D\u6717\u59C6", parts: [{ id: "\u767D\u6717\u59C6", volume: 60 }], iceMl: 60, intro: "\u5E72\u51C0\u5F97\u6CA1\u4EC0\u4E48\u53EF\u8BF4\u3002", finish: "\u7518\u8517\u7684\u5F71\u5B50\u3002", effects: { \u6109\u60A6: 1, \u5524\u9192: 1 } },
  { name: "\u91D1\u9152", parts: [{ id: "\u91D1\u9152", volume: 60 }], intro: "\u5E72\u3001\u6E05\u51B7\u3002", finish: "\u675C\u677E\u8FD8\u52FE\u7740\u3002", effects: { \u5524\u9192: 1 } },
  { name: "\u6E05\u9152", parts: [{ id: "\u6E05\u9152", volume: 90 }], intro: "\u6E29\u7740\u559D\u3002", finish: "\u7C73\u9999\u6563\u5F97\u5F88\u6162\u3002", effects: { \u4EB2\u8FD1: 2, \u5B88\u95E8: -1, \u5524\u9192: -1 } },
  { name: "\u5564\u9152", parts: [{ id: "\u5564\u9152", volume: 330 }], intro: "\u8F7B\u677E\u4E00\u4E0B\u3002", finish: "\u6C14\u6CE1\u6CA1\u4E86\u3002", effects: { \u6109\u60A6: 1, \u5524\u9192: -1 } },
  { name: "\u7EA2\u8461\u8404\u9152", parts: [{ id: "\u7EA2\u8461\u8404\u9152", volume: 150 }], intro: "\u6DA9\u662F\u7B7E\u540D\u3002", finish: "\u6DA9\u8FD8\u7F29\u7740\u3002", effects: { \u6109\u60A6: 1, \u4EB2\u8FD1: 1 } },
  { name: "\u82E6\u827E\u9152", parts: [{ id: "\u82E6\u827E\u9152", volume: 30 }, { id: "\u6C34", volume: 120 }], intro: "\u6548\u679C\u680F\u5199\u7740\u4F20\u8BF4\u3002", finish: "\u7EFF\u7684\u662F\u989C\u8272\uFF0C\u4E0D\u662F\u4ED9\u5B50\u3002", effects: { \u5524\u9192: 2, \u6B32\u671B: 1 } },
  { name: "\u9A6C\u5929\u5C3C", parts: [{ id: "\u91D1\u9152", volume: 60 }, { id: "\u5E72\u5473\u7F8E\u601D", volume: 10 }], method: "stir", intro: "\u7ED3\u6784\u5339\u914D\u7684\u6837\u672C\u3002", finish: "\u5E72\u3002", effects: { \u5B88\u95E8: 1, \u5524\u9192: 1 } },
  { name: "\u5C3C\u683C\u7F57\u5C3C", parts: [{ id: "\u91D1\u9152", volume: 30 }, { id: "\u91D1\u5DF4\u5229", volume: 30 }, { id: "\u751C\u5473\u7F8E\u601D", volume: 30 }], method: "stir", intro: "\u82E6\u505C\u7559\u5F97\u6781\u957F\u3002", finish: "\u82E6\u8FD8\u538B\u7740\u3002", effects: { \u6109\u60A6: -1, \u5524\u9192: 1, \u5B88\u95E8: -1 } },
  { name: "\u91D1\u6C64\u529B", parts: [{ id: "\u91D1\u9152", volume: 45 }, { id: "\u6C64\u529B\u6C34", volume: 120 }], iceMl: 60, intro: "\u5E95\u8272\u662F\u836F\u3002", finish: "\u594E\u5B81\u8FD8\u7559\u7740\u3002", effects: { \u5524\u9192: 1, \u6109\u60A6: -1 } },
  { name: "\u739B\u683C\u4E3D\u7279", parts: [{ id: "\u9F99\u820C\u5170", volume: 50 }, { id: "\u6A59\u76AE\u5229\u53E3\u9152", volume: 20 }, { id: "\u9752\u67E0\u6C41", volume: 20 }], method: "shake", intro: "\u6E05\u9192\u548C\u5931\u63A7\u540C\u65F6\u8FDB\u884C\u3002", finish: "\u9178\u8FD8\u5728\u3002", effects: { \u5524\u9192: 2, \u6109\u60A6: 1 } },
  { name: "\u957F\u5C9B\u51B0\u8336", parts: [
    { id: "\u91D1\u9152", volume: 15 },
    { id: "\u4F0F\u7279\u52A0", volume: 15 },
    { id: "\u767D\u6717\u59C6", volume: 15 },
    { id: "\u9F99\u820C\u5170", volume: 15 },
    { id: "\u6A59\u76AE\u5229\u53E3\u9152", volume: 15 },
    { id: "\u67E0\u6AAC\u6C41", volume: 20 },
    { id: "\u53EF\u4E50", volume: 205 }
  ], intro: "\u7F1D\u5408\u602A\u3002", finish: "\u9999\u53EA\u80FD\u62A5\u5230\u6839\u3002", effects: { \u5524\u9192: 1 } },
  { name: "Espresso Martini", parts: [{ id: "\u4F0F\u7279\u52A0", volume: 40 }, { id: "\u5496\u5561\u5229\u53E3\u9152", volume: 20 }, { id: "\u6D53\u7F29\u5496\u5561", volume: 30 }], method: "shake", intro: "\u8D8A\u559D\u8D8A\u7CBE\u795E\u53C8\u8D8A\u7CCA\u6D82\u3002", finish: "\u5496\u5561\u8FD8\u52FE\u7740\u3002", effects: { \u5524\u9192: 2, \u6109\u60A6: 1 } },
  { name: "\u767D\u5F00\u6C34", parts: [{ id: "\u6C34", volume: 200 }], intro: "\u4E00\u676F\u6C34\u3002", finish: "\u4EC0\u4E48\u90FD\u6CA1\u6709\u3002", effects: null },
  {
    name: "\u8FF7\u60C5\u5242",
    parts: [{ id: "\u6C34", volume: 200 }, { id: "\u51B0", volume: 60 }],
    intro: "\u770B\u8D77\u6765\u662F\u4E00\u676F\u6C34\u3002",
    finish: "\u60F3\u559D\u4EC0\u4E48\u81EA\u5DF1\u52A0\u3002",
    description: "\u6BD4\u666E\u901A\u7684\u6C34\u4F3C\u4E4E\u591A\u4E86\u4E00\u4E1D\u7518\u751C\u4E0E\u9999\u6C14\u3002",
    registeredFlavorText: "\u6BD4\u666E\u901A\u7684\u6C34\u4F3C\u4E4E\u591A\u4E86\u4E00\u4E1D\u7518\u751C\u4E0E\u9999\u6C14\u3002",
    registeredEffectText: "\u559D\u4E86\u4E4B\u540E\uFF0C\u4F60\u89C9\u5F97\u6709\u70B9\u53D1\u70EB\uFF0C\u60F3\u8981\u9760\u8FD1\u4EC0\u4E48\u3002",
    effects: { \u6109\u60A6: 3, \u5524\u9192: 2, \u4EB2\u8FD1: 3, \u5B88\u95E8: -2, \u6B32\u671B: 3, \u7CBE\u5EA6: 0 },
    category: "custom"
  }
];
var menu = MENU_DEFS.map((d) => {
  const cup = buildFromParts(d.name, d.parts, d);
  return {
    ...cup,
    listed: true,
    kind: "menu",
    category: d.category || cup.category || null
  };
});
var potion = menu.find((m) => m.claimedName === "\u8FF7\u60C5\u5242");
var ingredientCharacterProfiles = Object.fromEntries(
  menu.filter((cup) => cup.effects && Array.isArray(cup.recipe) && cup.recipe.length === 1).map((cup) => [
    cup.recipe[0].id,
    {
      referenceVolume: Number(cup.recipe[0].volume) || 1,
      effects: { ...cup.effects, \u7CBE\u5EA6: 0 }
    }
  ])
);
var fourWaters = buildFromParts("\u56DB\u79CD\u6C34", [
  { id: "\u6C34", volume: 50 },
  { id: "\u82CF\u6253\u6C34", volume: 50 },
  { id: "\u51B0", volume: 50 },
  { id: "\u6C34", volume: 50 }
], {
  kind: "custom",
  listed: false,
  intro: "\u8FD8\u662F\u6C34\u3002",
  finish: "\u8FD8\u662F\u6CA1\u6709\u3002",
  effects: { \u6109\u60A6: 2, \u6B32\u671B: 2, \u4EB2\u8FD1: 2 },
  id: "cup-\u56DB\u79CD\u6C34"
});
var hiddenHeaven = buildFromParts(HIDDEN_HEAVEN_NAME, [
  { id: "\u5A01\u58EB\u5FCC", volume: 20 },
  { id: "\u4F0F\u7279\u52A0", volume: 20 },
  { id: "\u9F99\u820C\u5170", volume: 20 },
  { id: "\u91D1\u9152", volume: 20 },
  { id: "\u767D\u6717\u59C6", volume: 20 }
], {
  kind: "unlisted",
  listed: false,
  intro: hiddenOutcomes[HIDDEN_HEAVEN_NAME].intro,
  finish: "",
  description: hiddenOutcomes[HIDDEN_HEAVEN_NAME].intro,
  registeredEffectText: hiddenOutcomes[HIDDEN_HEAVEN_NAME].effectText,
  effects: { \u5524\u9192: 3, \u6B32\u671B: 2 },
  id: "cup-heaven",
  internalHidden: true
});
var hiddenBlack = buildFromParts(HIDDEN_BLACK_NAME, [
  { id: "\u5A01\u58EB\u5FCC", volume: 20 },
  { id: "\u91D1\u5DF4\u5229", volume: 20 },
  { id: "\u9752\u67E0\u6C41", volume: 20 },
  { id: "\u5564\u9152", volume: 20 },
  { id: "\u6D53\u7F29\u5496\u5561", volume: 20 },
  { id: "\u7EA2\u8461\u8404\u9152", volume: 20 }
], {
  kind: "unlisted",
  listed: false,
  intro: hiddenOutcomes[HIDDEN_BLACK_NAME].intro,
  finish: "",
  description: hiddenOutcomes[HIDDEN_BLACK_NAME].intro,
  registeredEffectText: hiddenOutcomes[HIDDEN_BLACK_NAME].effectText,
  registeredFlavorText: hiddenOutcomes[HIDDEN_BLACK_NAME].flavorText,
  id: "cup-\u4E94\u5F69\u6591\u6593\u7684\u9ED1",
  internalHidden: true
});
function menuItem(name) {
  return menu.find((m) => m.claimedName === name);
}
function buildCup(menuItemOrName, beta = 1, totalMouths) {
  const item = typeof menuItemOrName === "string" ? menuItem(menuItemOrName) : menuItemOrName;
  if (!item) throw new Error("unknown menu item");
  return cloneCup(item, {
    beta,
    totalMouths: totalMouths || item.totalMouths
  });
}
function cloneCup(cup, overrides = {}) {
  const c = structuredClone(cup);
  Object.assign(c, overrides);
  if (overrides.beta != null || overrides.totalMouths != null) {
    const beta = overrides.beta ?? c.beta;
    const n = overrides.totalMouths ?? c.totalMouths;
    c.beta = beta;
    c.totalMouths = n;
    const components = c.mouths[0]?.components || [];
    const abv = c.mouths[0]?.abv || 0;
    c.mouths = Array.from({ length: n }, (_, i) => ({
      index: i,
      volume: c.totalVolume / n,
      abv,
      components,
      beta,
      startTime: null,
      applied: false,
      suggestion: null
    }));
    c.caffeinePerMouth = (c.caffeineTotal || 0) / n;
  }
  return c;
}
var realPack = {
  reactionCurve: realReactionCurve,
  adoptionWeights: realAdoptionWeights,
  beliefProfiles,
  ingredientCharacterProfiles,
  ratioThresholds,
  effectLexicon,
  flavorLexicon,
  menu,
  ingredients,
  statusCopy,
  hiddenOutcomes,
  stateInjection: false
};

// src/content/examplePack.js
var exampleReactionCurve = (chat) => ({
  \u4EB2\u8FD1: 1 * chat,
  \u5B88\u95E8: -0.8 * chat,
  // 放开型
  \u6B32\u671B: 1.1 * chat
});
var exampleAdoptionWeights = {
  \u6109\u60A6: 0.7,
  \u5524\u9192: 0.7,
  \u4EB2\u8FD1: 0.8,
  \u5B88\u95E8: 0.5,
  \u6B32\u671B: 0.6,
  \u7CBE\u5EA6: 0
};
export {
  ACTIVE_AXIS_WHITELIST,
  ACTIVE_DEFS,
  BELIEF_AXIS_CAP,
  BELIEF_EFFECT_FRAME_NOTE,
  BLACKOUT_RECOVER_MS,
  COPY_PENDING_USER_REVIEW as CONTENT_COPY_PENDING,
  COPY_PENDING_USER_REVIEW,
  CUP_CAPACITY_ML,
  DEFAULT_BLACKOUT_RECOVERY_HOURS,
  DEFAULT_TIMEZONE,
  DEFAULT_TRANSIENT_TTL_HOURS,
  DETERMINISTIC_EFFECT_FRAME_NOTE,
  GARNISHES,
  HEAVEN_ELIGIBILITY_STATUS,
  HEAVEN_MIN_ABV,
  HIDDEN_BLACK_NAME,
  HIDDEN_DRAW_P,
  HIDDEN_HEAVEN_NAME,
  OBJECTIVE_EFFECT_FRAME_NOTE,
  ProofEngine,
  SAFETY_NOTE,
  STATE_FRAME_NOTE,
  SUBJECTIVE_BELIEF_MAX_CHARS,
  SUBJECTIVE_BELIEF_MIN,
  activeAmount,
  activesToPhysiology,
  assembleClashingFlavorDescription,
  assembleEffectDescription,
  assembleFlavorDescription,
  barManual,
  blackEligible,
  blackoutVisibility,
  buildAgentStateHints,
  buildAgentTurnContext,
  buildCup,
  buildFromParts,
  buildStateInjection,
  caffeineOfParts,
  caffeineToPhysiology,
  claimedEffectsOrZero,
  cloneCup,
  collapseActive,
  collectActives,
  compoundPeak,
  computeBeta,
  computeColor,
  computeCupEffect,
  computeCupType,
  computeDiscreteness,
  computeRatio,
  countSignificantSources,
  counterfactualDelta,
  createHangoverSnapshot,
  createTurnBridge,
  currentBeliefStrength,
  currentHangover,
  dayKey,
  describeCupEffect,
  doseToPhysiology,
  doseToReaction,
  effectLexicon,
  emptyActives,
  exampleAdoptionWeights,
  exampleReactionCurve,
  exportActives,
  flavorLexicon,
  flavorPeakForMouth,
  flavorProjectionAtTime,
  formatContextBlock,
  fourWaters,
  hashUnit,
  heavenEligible,
  hiddenBlack,
  hiddenHeaven,
  hiddenOutcomeCopy,
  hiddenOutcomes,
  hookAdditionalContext,
  hydrateCupPhysics,
  ingestActives,
  ingredientManual,
  ingredientManualFor,
  ingredients,
  injectionEnabled,
  isGarnish,
  isHiddenIdentity,
  isRecordReadable,
  isReservedHiddenName,
  isSuppressed,
  looksLikeInstruction,
  looksLikeRecipe,
  manualFor,
  menu,
  menuItem,
  metabolize,
  metabolizeCaffeine,
  mlToStandardDrinks,
  mouthSuggestion,
  normalizeDrinkName,
  normalizeGarnishes,
  normalizeIngredientActives,
  normalizeLifecycleOptions,
  normalizeUntrusted,
  parseShorthand,
  peakFlavor,
  phraseTier,
  potion,
  produceBlackoutState,
  produceCollapseState,
  produceCrashEvent,
  produceVomitEvent,
  projectForViewer,
  publicEffectDescription,
  realPack,
  reportedFlavor,
  resetActives,
  resolveClaimedEffects,
  resolveHiddenDraw,
  resolveIngredient,
  resolveLifecycleConfig,
  restoreActives,
  sanitizeClaimedName,
  sanitizeFinish,
  sanitizeIntro,
  sanitizePublicEffectDescription,
  sanitizeSubjectiveBelief,
  settleActives,
  statusCopy,
  validateActiveDefs
};
