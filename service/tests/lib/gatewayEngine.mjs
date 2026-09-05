// 适配层引擎夹具：快速构造带断片/带推力/空状态的 ProofEngine。

import { ProofEngine } from '../../../engine/src/engine/ProofEngine.js';
import { realPack, buildFromParts } from '../../../engine/src/content/realPack.js';

export const T0 = Date.UTC(2026, 8, 2, 10, 0, 0);
export const H = 3600000;

export function freshEngine(options = {}) {
  return new ProofEngine(null, realPack, options);
}

export function drinkVodka(eng, ml, at, { lifecycle } = {}) {
  const cup = buildFromParts('测试杯', [{ id: '伏特加', volume: ml }], { id: `cup-${ml}-${at}`, kind: 'custom', listed: false });
  return eng.sipAll(cup, at);
}

/** 直接开到断片（≈28 杯，远超 8）。 */
export function openBlackout(eng, at = T0, lifecycle) {
  drinkVodka(eng, 900, at, { lifecycle });
  return eng.state.fragmentBatches[0];
}

/** 有推力但不到断片线（200ml 40% ≈ 6.3 杯）。 */
export function pushOnly(eng, at = T0) {
  return drinkVodka(eng, 200, at);
}

export { ProofEngine, realPack, buildFromParts };
export default { freshEngine, openBlackout, pushOnly, T0, H };
