import { hashUnit, HIDDEN_DRAW_P } from '../src/core/hiddenDraw.js';
import { ProofEngine } from '../src/engine/ProofEngine.js';
import { realPack, buildFromParts, cloneCup, potion } from '../src/content/realPack.js';
import { TAU } from '../src/core/constants.js';

export const T0 = 1_700_000_000_000;

// 测试用的杯 id 默认钉死在「稳定不命中隐藏抽卡」的序列上。
//
// 为什么要这样：createOffer 会按 hash(cupId) 掷一次 5% 的隐藏抽卡并冻结。
// 只要杯子够资格（纯烈酒或高离散度杂调），任何断言 claimedName / 投影 /
// 效果文案的测试就有 5% 概率被改名，变成随机红灯——2026-09-03 的 G7 就是
// 这么红的，全仓另有 9 个文件 58 处 createOffer 暴露在同一个形状下。
//
// **生产玩法一个字不变**：真实杯仍用 randomUUID。这里只固定测试用的 id。
// id 必须唯一（_offerForCup 按 cup.id 找杯），所以用递增序列，
// 并逐个验证它落在 5% 之外——命中的直接跳过。
// 需要「稳定命中」的测试自己传 idFactory 或 hiddenHashUnit，会覆盖这个默认值。
let missSeq = 0;
export function nextMissCupId() {
  for (;;) {
    const id = `fixed-${missSeq}`;
    missSeq += 1;
    if (hashUnit(id) >= HIDDEN_DRAW_P) return id;
  }
}

export function engine(opts = {}) {
  return new ProofEngine(null, realPack, { idFactory: nextMissCupId, ...opts });
}

export function whiskey(overrides = {}) {
  return cloneCup(
    buildFromParts('威士忌', [{ id: '威士忌', volume: 60 }], {
      kind: 'menu',
      intro: '一口一停的泥煤。',
      finish: '烟还留在舌根。',
      effects: { 守门: 2, 唤醒: -1, 亲近: 1 },
      totalMouths: 2,
      ...overrides
    }),
    overrides
  );
}

export function customPotion(beta = 1, totalMouths = 2) {
  return cloneCup(potion, { beta, totalMouths, kind: 'custom' });
}

export function flavorMouths({ axes, n = 2, startTimes = [null, null], A = 2 }) {
  const components = [];
  for (const [axis, amp] of Object.entries(axes || { 香: A })) {
    const tau = TAU[axis] || { rise: 1, fall: 15 };
    components.push({ axis, A: amp, tauRise: tau.rise, tauFall: tau.fall });
  }
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    volume: 30,
    abv: 0.4,
    components,
    beta: 1,
    startTime: startTimes[i] ?? null,
    applied: false,
    suggestion: null
  }));
}

export function almost(a, b, eps = 1e-6) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < eps;
}

export { ProofEngine, realPack, cloneCup, buildFromParts, T0 as now0 };
