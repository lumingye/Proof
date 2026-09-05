// 口味：贡献、稀释、时间投影、压制、比值、离散度（机制约定）

import {
  TAU,
  SUPPRESSION,
  TASTE_DURATION_SEC,
  TASTE_SEGMENTS,
  FLAVOR_AXES,
  SIGNIFICANT_VOLUME,
  SIGNIFICANT_FLAVOR,
  PHRASE_TIERS,
  FLAVOR_DELTA_MIN,
  EFFECT_PHRASE_MAX,
  zeroFlavorAxes
} from './constants.js';

export function integrateIntensity(A, tauRise, tauFall, t) {
  if (t < 0 || t > TASTE_DURATION_SEC) return 0;
  if (!A) return 0;
  return A * (1 - Math.exp(-t / tauRise)) * Math.exp(-t / tauFall);
}

export function componentIntensity(comp, t) {
  const tau = TAU[comp.axis] || { rise: 1, fall: 15 };
  const rise = comp.tauRise ?? tau.rise;
  const fall = comp.tauFall ?? tau.fall;
  return integrateIntensity(comp.A, rise, fall, t);
}

function mouthTimeSec(mouth, now) {
  if (mouth.startTime == null) return null;
  if (mouth.startTime > now) return null;
  return (now - mouth.startTime) / 1000;
}

function mouthAxisSum(mouth, axis, t) {
  let sum = 0;
  for (const comp of mouth.components || []) {
    if (comp.axis !== axis) continue;
    sum += componentIntensity(comp, t);
  }
  return sum;
}

/**
 * I_轴(t) = max over 已入口的各口 ( Σ 该口同轴分量 )
 * 尚未入口的 mouth 不参与。
 */
export function flavorProjectionAtTime(mouths, axis, nowOrT, options = {}) {
  const now = options.now ?? (typeof nowOrT === 'number' && nowOrT > 1e10 ? nowOrT : null);
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

export function rawFlavorAt(mouths, now) {
  const raw = zeroFlavorAxes();
  for (const axis of FLAVOR_AXES) {
    raw[axis] = flavorProjectionAtTime(mouths, axis, now, { now });
  }
  return raw;
}

export function isSuppressed(pressAxis, targetAxis, mouths, now) {
  const allowed = SUPPRESSION[pressAxis];
  if (!allowed || !allowed.includes(targetAxis)) return false;
  const pressVal = flavorProjectionAtTime(mouths, pressAxis, now, { now });
  const targetVal = flavorProjectionAtTime(mouths, targetAxis, now, { now });
  if (targetVal <= 0) return false;
  return pressVal >= 2 * targetVal;
}

export function applySuppression(raw, mouths, now) {
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

export function flavorPeakForMouth(mouth, axis) {
  let peak = 0;
  for (let t = 0; t <= TASTE_DURATION_SEC; t += 0.5) {
    const v = mouthAxisSum(mouth, axis, t);
    if (v > peak) peak = v;
  }
  return peak;
}

/** 一口/一杯在 90s 内各轴峰值。第二屏不能用 t=0 的瞬时值——入口瞬间 I(0)=0。 */
export function peakFlavor(mouths) {
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

export function flavorHasSignal(flavor) {
  return FLAVOR_AXES.some((axis) => (flavor?.[axis] || 0) > 0.05);
}

export function suppressByPeaks(raw) {
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

/**
 * 第二屏用的口味快照：已入口各口的峰值；
 * 没有分量时退回聚合浓度 / claimedFlavor。
 */
export function reportedFlavor(cup, evalRes = {}) {
  const mouths = (cup?.mouths || []).filter((m) => m.applied || m.startTime != null);
  const targets = mouths.length ? mouths : (cup?.mouths || []);
  const peak = peakFlavor(targets);
  if (flavorHasSignal(peak)) return suppressByPeaks(peak);
  if (flavorHasSignal(evalRes.aggregated)) return { ...evalRes.aggregated };
  if (flavorHasSignal(cup?.claimedFlavor)) return { ...cup.claimedFlavor };
  return peak;
}

function flavorTier(value) {
  const a = Math.abs(value);
  if (a < PHRASE_TIERS.低[1]) return '低';
  if (a < PHRASE_TIERS.中[1]) return '中';
  return '高';
}

// 稳定轮换哈希：同一 cupId + 轴名永远得到同一序号（补充单：不许随机）。
function stableIndex(seed, count) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % count;
}

// 词条候选归一化：兼容新格式（[{pattern, text}]）与旧格式（字符串）。
function flavorCandidates(lexicon, axis, tier) {
  const slot = lexicon?.[axis]?.[tier];
  const out = [];
  if (Array.isArray(slot)) {
    for (const entry of slot) {
      if (entry && typeof entry.text === 'string' && entry.text.length > 0) {
        out.push({ pattern: typeof entry.pattern === 'string' && entry.pattern ? entry.pattern : entry.text, text: entry.text });
      }
    }
  } else if (typeof slot === 'string' && slot.length > 0) {
    out.push({ pattern: slot, text: slot });
  }
  return out;
}

export function assembleFlavorDescription(flavor, lexicon, ratioWords = {}, cupId = '') {
  const moved = [];
  for (const axis of FLAVOR_AXES) {
    const v = flavor?.[axis] || 0;
    // 味道用自己的门槛，不跟效果共用（见 constants.js 的说明）。
    if (v < FLAVOR_DELTA_MIN) continue;
    moved.push({ axis, value: v, abs: v, tier: flavorTier(v) });
  }
  moved.sort((a, b) => b.abs - a.abs);
  const capped = moved.slice(0, EFFECT_PHRASE_MAX);
  // 句式骨架互斥（补充单）：同杯内 pattern 不得重复；
  // 冲突时按轴值高低保留（capped 已按 abs 降序），被顶掉的那条不出词——宁可少一句，不要两句同模子。
  const usedPatterns = new Set();
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
  const ratioBits = Object.values(ratioWords || {}).filter((t) => typeof t === 'string' && t.length > 0);
  return { text: phrases.join(''), phrases, patterns, ratios: ratioBits };
}

export function segmentPeaks(mouths, now) {
  const result = {};
  for (const axis of FLAVOR_AXES) {
    result[axis] = {};
    for (const seg of TASTE_SEGMENTS) {
      let max = 0;
      for (let t = seg.start; t <= seg.end; t += 0.5) {
        const fakeNow = now; // segments are relative to each mouth start
        let v = 0;
        for (const m of mouths || []) {
          const mt = mouthTimeSec(m, fakeNow);
          if (mt == null) continue;
          // 段积分取最大：对每口在其自身 90s 曲线的该段取样
          const local = mouthAxisSum(m, axis, t);
          if (local > v) v = local;
        }
        if (v > max) max = v;
      }
      result[axis][seg.name] = max;
    }
  }
  return result;
}

/**
 * 比值。0/0 → 不适用（NaN）；分母 0 且分子 > 0 → ∞（高端）。
 */
export function computeRatio(numerator, denominator) {
  if (denominator === 0) {
    return numerator > 0 ? Infinity : NaN;
  }
  return numerator / denominator;
}

export function ratioWord(name, value, thresholds) {
  if (value == null || Number.isNaN(value)) return null;
  const table = thresholds?.[name];
  if (!table) return null;
  if (value === Infinity) return table.highWord;
  if (value < table.low) return table.lowWord;
  if (value > table.high) return table.highWord;
  return table.midWord ?? null;
}

export function computeRatios(aggregated, thresholds) {
  const ratios = {
    '甜/酸': computeRatio(aggregated.甜 || 0, aggregated.酸 || 0),
    '甜/苦': computeRatio(aggregated.甜 || 0, aggregated.苦 || 0),
    '香/(苦+涩)': computeRatio(aggregated.香 || 0, (aggregated.苦 || 0) + (aggregated.涩 || 0)),
    总量: FLAVOR_AXES.reduce((s, a) => s + (aggregated[a] || 0), 0)
  };
  const words = {};
  for (const name of ['总量', '甜/酸', '甜/苦', '香/(苦+涩)']) {
    words[name] = ratioWord(name, ratios[name], thresholds);
  }
  return { ratios, words };
}

export function treeDistance(pathA, pathB) {
  const a = !pathA || pathA.length === 0 || pathA[0] === '无' ? ['无'] : pathA;
  const b = !pathB || pathB.length === 0 || pathB[0] === '无' ? ['无'] : pathB;
  if (a[0] === '无' && b[0] === '无') return 0;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return (a.length - i) + (b.length - i);
}

export function expectedTreeDistance(sourceI, sourceJ) {
  const pathsI = sourceI.treePaths || [{ path: sourceI.treePath || ['无'], weight: 1 }];
  const pathsJ = sourceJ.treePaths || [{ path: sourceJ.treePath || ['无'], weight: 1 }];
  let sum = 0;
  for (const a of pathsI) {
    for (const b of pathsJ) {
      sum += (a.weight || 1) * (b.weight || 1) * treeDistance(a.path, b.path);
    }
  }
  return sum;
}

export const MAX_TREE_DIST = 4;

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

export function isSignificant(source, axisTotals) {
  if ((source.volumeRatio || 0) >= SIGNIFICANT_VOLUME) return true;
  const share = source.flavorContribution ?? flavorShare(source, axisTotals);
  return share >= SIGNIFICANT_FLAVOR;
}

/**
 * D = Σ_{i<j}(w_i·w_j·树距) / Σ_{i<j}(w_i·w_j·最大树距)
 * 显著来源 < 2 → 0。四种水两两树距为 0 → D = 0。
 */
export function countSignificantSources(sources, axisTotals = zeroFlavorAxes()) {
  return (sources || []).filter((s) => isSignificant(s, axisTotals)).length;
}

export function computeDiscreteness(sources, axisTotals = zeroFlavorAxes()) {
  const list = (sources || []).filter((s) => isSignificant(s, axisTotals));
  if (list.length < 2) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const w = (list[i].volumeRatio || 0) * (list[j].volumeRatio || 0);
      const dist = typeof list[i].treeDist === 'function'
        ? list[i].treeDist(list[j])
        : expectedTreeDistance(list[i], list[j]);
      num += w * dist;
      den += w * MAX_TREE_DIST;
    }
  }
  return den === 0 ? 0 : num / den;
}

export function flavorMismatch(claimed, actual) {
  let sum = 0;
  for (const axis of FLAVOR_AXES) {
    const d = (claimed?.[axis] || 0) - (actual?.[axis] || 0);
    sum += d * d;
  }
  return Math.sqrt(sum) / Math.sqrt(6 * 25);
}

export function diluteConcentrations(contributions, totalVolume) {
  const out = zeroFlavorAxes();
  if (!totalVolume) return out;
  for (const axis of FLAVOR_AXES) {
    out[axis] = (contributions[axis] || 0) / totalVolume;
  }
  return out;
}

export function aggregateAxes(concentrations) {
  return { ...zeroFlavorAxes(), ...concentrations };
}

export function mouthCountForVolume(volumeMl) {
  return Math.max(2, Math.ceil(volumeMl / 45));
}

/**
 * 稀释体积。搅拌 +25%、摇制 +30%、加冰静置每 10 分钟 +5%，
 * 冰融总量 clamp 到杯中冰的可融体积。
 */
export function dilutionVolume({ liquidMl, iceMl = 0, method, elapsedMin = 0 }) {
  let extra = 0;
  if (method === 'stir') extra += liquidMl * 0.25;
  if (method === 'shake') extra += liquidMl * 0.30;
  const melt = Math.min(iceMl, liquidMl * 0.05 * Math.floor(elapsedMin / 10));
  return extra + melt;
}


// ---------------- 口味耐受度 ----------------
//
// 常喝的人觉得同一杯没那么冲了：**烈往下走，香与甜相对浮上来。**
// 这是耐受度在这个项目里**唯一**的作用——
// 它不碰效果轴、不进注入、不影响醉的程度，也不需要任何人去评定。
//
// 由累计标准杯自动长，长得很慢，而且有上限。

export const TOLERANCE_FULL_DRINKS = 200;   // 到这个累计量吃满
export const TOLERANCE_MAX = 0.4;           // 烈最多降到六成
export const TOLERANCE_LIFT = 0.5;          // 香与甜的相对上浮系数

export function flavorTolerance(lifetimeDrinks) {
  const d = Math.max(0, Number(lifetimeDrinks) || 0);
  return Math.min(TOLERANCE_MAX, (d / TOLERANCE_FULL_DRINKS) * TOLERANCE_MAX);
}

export function applyTolerance(flavor, tolerance) {
  const t = Math.min(TOLERANCE_MAX, Math.max(0, Number(tolerance) || 0));
  if (!t) return { ...flavor };
  const out = { ...flavor };
  if (typeof out.烈 === 'number') out.烈 = out.烈 * (1 - t);
  const lift = 1 + t * TOLERANCE_LIFT;
  if (typeof out.香 === 'number') out.香 = out.香 * lift;
  if (typeof out.甜 === 'number') out.甜 = out.甜 * lift;
  return out;
}

// 酒精耐受（功能性耐受）：同样的血液浓度，老手的**表现**受损更轻。
// 注意只打折「体感」，**不打折血液浓度本身**——
// 所以断片 / 吐 / 宕机这些按 c 判定的阈值一律不受影响。
// 这是真实的：耐受改变的是反应，不是酒精含量。

export const ALCOHOL_TOLERANCE_MAX = 0.25;   // 最多减轻两成半，老手也会醉

export function alcoholTolerance(lifetimeDrinks) {
  const d = Math.max(0, Number(lifetimeDrinks) || 0);
  return Math.min(ALCOHOL_TOLERANCE_MAX, (d / TOLERANCE_FULL_DRINKS) * ALCOHOL_TOLERANCE_MAX);
}
