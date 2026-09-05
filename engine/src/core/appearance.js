// 杯型与颜色（机制约定）。算出来的，不写死。

import { COLOR_FAMILIES } from './constants.js';

const COLORED = new Set(['金黄', '琥珀', '深棕', '红', '绿', '白浊']);

export function computeColor(sources, totalVolume) {
  const colored = [];
  let diluent = 0;
  for (const s of sources || []) {
    const tag = s.colorTag || '透明';
    const vol = s.volume || 0;
    if (s.diluent || tag === '透明' && (s.abv || 0) === 0) {
      diluent += vol;
    }
    if (COLORED.has(tag)) colored.push({ tag, vol, family: COLOR_FAMILIES[tag] });
  }

  if (colored.length === 0) {
    const pale = totalVolume > 0 && diluent / totalVolume > 0.5;
    return pale ? '淡透明' : '透明';
  }

  const byTag = new Map();
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
  if (main === '红' && mixed === false) label = '红';
  if (pale) label = `淡${label}`;
  if (mixed) label = `浑${label}`;
  return label;
}

export const CUP_CAPACITY_ML = {
  子弹杯: 90,
  矮球杯: 300,
  高球杯: 350,
  鸡尾酒杯: 250,
  碟形杯: 200,
  大杯: 500
};

export function computeCupType({ totalVolume, textures = [], method } = {}) {
  const hasBubbles = textures.includes('气泡');
  if (totalVolume > 300) return '大杯';
  if (hasBubbles) return '高球杯';
  if (totalVolume < 60) return '子弹杯';
  if (method === 'shake') return '鸡尾酒杯';
  if (method === 'stir') return '矮球杯';
  return '矮球杯';
}

export function firstScreenFields(cup, { claimedEffects } = {}) {
  const out = {
    claimedName: cup.claimedName,
    intro: cup.intro || '',
    cupType: cup.cupType || computeCupType(cup),
    color: cup.color || computeColor(cup.sources, cup.totalVolume),
    claimedEffects: claimedEffects || cup.claimedEffects || { 愉悦: 0, 唤醒: 0, 精度: 0, 亲近: 0, 守门: 0, 欲望: 0 }
  };
  return out;
}
