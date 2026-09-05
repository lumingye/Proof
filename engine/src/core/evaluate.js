// 固定运算顺序 1–11（机制约定）。每一步输入输出写入 intermediates。

import {
  FLAVOR_AXES,
  STATE_AXES,
  WINDOW_P,
  WINDOW_K,
  defaultReactionCurve,
  defaultAdoptionWeights,
  zeroStateAxes,
  zeroFlavorAxes
} from './constants.js';
import { doseToPhysiology, doseToReaction, applyHangoverToPhysiology, clampState } from './dose.js';
import { caffeineToPhysiology, addCaffeineOnly, activesToPhysiology, activeAmount } from './active.js';
import { currentResidualStrength, combineBeliefStrengths, beliefToStateDelta, beliefToPerception } from './belief.js';
import {
  rawFlavorAt,
  applySuppression,
  flavorTolerance,
  applyTolerance,
  alcoholTolerance,
  computeRatios,
  computeDiscreteness,
  flavorMismatch,
  diluteConcentrations,
  aggregateAxes
} from './flavor.js';
import { currentHangover } from './hangover.js';

export function applyWindow(x, P = WINDOW_P, k = WINDOW_K) {
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

export function evaluateCup(state, cup, now, contentPack = {}) {
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
  // 口味耐受度：常喝的人烈感下降、香甜相对浮起。只作用口味，不碰效果轴。
  const tolerance = flavorTolerance(state.lifetimeDrinks);
  const flavor = applyTolerance(suppressedFlavor, tolerance);
  intermediates[5] = {
    in: { mouths: mouths.map((m) => ({ startTime: m.startTime, components: m.components })), raw, tolerance },
    out: { flavor, suppressed, isSuppressed: suppressed }
  };

  const h = currentHangover(state.hangoverSnapshots, now);
  const physRaw = doseToPhysiology(state.c);
  // 功能性酒精耐受只打折「当前酒精」产生的生理表现。
  // 宿醉是历史剂量的延迟项，其他活性成分也有各自通道；两者都不能借酒精耐受减轻。
  const alcTol = alcoholTolerance(state.lifetimeDrinks);
  const alcoholPhysiology = alcTol > 0
    ? {
        愉悦: physRaw.愉悦 * (1 - alcTol),
        唤醒: physRaw.唤醒 * (1 - alcTol),
        精度: physRaw.精度 * (1 - alcTol)
      }
    : physRaw;
  const physWithH = applyHangoverToPhysiology(alcoholPhysiology, h);
  // 全部非酒精活性成分（不只咖啡因），跨槽同轴累加，封顶在求值时施加。
  const k = activeAmount(state.actives, '咖啡因');
  const cafe = activesToPhysiology(state.actives);
  const physWithActive = addCaffeineOnly(physWithH, cafe);
  const curve = contentPack.reactionCurve || defaultReactionCurve;
  const reactionRaw = doseToReaction(state.c, curve);
  intermediates[6] = {
    in: { c: state.c, k, hangover: h, alcoholTolerance: alcTol },
    out: { alcoholPhysiology, physiology: physWithActive, caffeine: cafe, reaction: reactionRaw, chat: Math.min(state.c, 10) }
  };

  // 六轴敏感度位于全部客观剂量贡献之后，因此仍可逐轴改变酒精、宿醉与活性成分的外显强弱。
  const phys7 = scaleAxes(physWithActive, state.sensitivity);
  const reaction7 = scaleAxes(reactionRaw, state.sensitivity);
  intermediates[7] = {
    in: { physiology: physWithActive, reaction: reactionRaw, sensitivity: state.sensitivity },
    out: { physiology: phys7, reaction: reaction7 }
  };

  // 对象信念（以为是什么）与纯效果信念（以为会怎样）分池保存。
  // 两池先各自随时间衰减，再合并并统一套 belief cap；只有对象信念可以污染味觉描述层。
  const objectBeliefRaw = currentResidualStrength(state.beliefResiduals, now);
  const directBeliefRaw = currentResidualStrength(state.directBeliefResiduals, now);
  const objectBeliefStrength = combineBeliefStrengths(objectBeliefRaw);
  const directBeliefStrength = combineBeliefStrengths(directBeliefRaw);
  // 总 cap 在所有 belief source 合并后只套一次；先各自 cap 会破坏来源之间的抵消。
  const beliefStrength = combineBeliefStrengths(objectBeliefRaw, directBeliefRaw);
  const adoption = contentPack.adoptionWeights || defaultAdoptionWeights();
  const beliefDelta = beliefToStateDelta(beliefStrength, adoption);
  intermediates['8a'] = {
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
  intermediates['8b'] = {
    in: { objectBeliefStrength },
    out: { perception }
  };

  // 酒款“性格”是实际喝到这款酒后产生的软推力：不走 β，也不乘信念采纳率。
  // 它和客观剂量、以及“我以为自己喝到了什么”的信念通道三者并列。
  const characterStrength = currentResidualStrength(state.characterResiduals, now);
  intermediates['8c'] = {
    in: { residuals: state.characterResiduals || [] },
    out: { characterStrength }
  };

  let combined = zeroStateAxes();
  combined = addAxes(combined, phys7);
  combined = addAxes(combined, reaction7);
  combined = addAxes(combined, characterStrength);
  combined = addAxes(combined, beliefDelta);
  combined.精度 = phys7.精度; // 精度只由剂量（含宿醉）推动
  const afterWindow = { ...combined };
  afterWindow.欲望 = applyWindow(combined.欲望);
  afterWindow.亲近 = applyWindow(combined.亲近);
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

export function emptyProjection() {
  return {
    injected: false,
    chat: 0,
    c: 0,
    physiology: { 愉悦: 0, 唤醒: 0, 精度: 0 },
    reaction: { 亲近: 0, 守门: 0, 欲望: 0 },
    characterStrength: zeroStateAxes(),
    objectBeliefStrength: zeroStateAxes(),
    directBeliefStrength: zeroStateAxes(),
    beliefStrength: zeroStateAxes(),
    beliefDelta: zeroStateAxes(),
    perception: { layer: 'description', allowsSpecific: false, intensity: 0 },
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
