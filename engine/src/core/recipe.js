// 用内容包原料把杯子的来源 / 口味分量 / 咖啡因补齐。
// 第二屏口味全 0 的一个根：杯子进引擎时没带上内容包里的分量。

import { TAU, FLAVOR_AXES, MIN_MOUTHS, MOUTHFUL_ML, zeroFlavorAxes } from './constants.js';
import { caffeineOfParts } from './active.js';

export function resolveIngredient(id, ingredients) {
  if (!ingredients) return null;
  if (ingredients[id]) return { key: id, spec: ingredients[id] };
  const raw = String(id ?? '').trim();
  if (!raw) return null;
  if (ingredients[raw]) return { key: raw, spec: ingredients[raw] };
  const compact = raw.replace(/\s+/g, '');
  for (const key of Object.keys(ingredients)) {
    if (key.replace(/\s+/g, '') === compact) return { key, spec: ingredients[key] };
  }
  return null;
}

function flavorComponents(sources, totalVolume) {
  const comps = [];
  for (const src of sources) {
    for (const [axis, density] of Object.entries(src.flavor || {})) {
      if (!density) continue;
      const A = totalVolume > 0 ? (density * src.volume) / totalVolume : density;
      const tau = TAU[axis] || { rise: 1, fall: 15 };
      comps.push({ axis, A, tauRise: tau.rise, tauFall: tau.fall, source: src.id });
      if (axis === '烈' && (src.abv || 0) > 0) {
        comps.push({
          axis: '烈',
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

function sourcesFromRecipe(recipe, ingredients) {
  const resolved = [];
  for (const part of recipe || []) {
    const hit = resolveIngredient(part.id, ingredients);
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

export function hydrateCupPhysics(cup, ingredients) {
  if (!cup || !ingredients) return cup;
  const recipe = cup.recipe || (cup.sources || []).map((s) => ({ id: s.id, volume: s.volume }));
  const sources = sourcesFromRecipe(recipe, ingredients);
  if (!sources) {
    if (cup.caffeineTotal == null) {
      cup.caffeineTotal = caffeineOfParts(recipe, ingredients);
    }
    return cup;
  }

  const totalVolume = sources.reduce((n, s) => n + s.volume, 0) || cup.totalVolume || 0;
  const needSources = sourcesNeedHydrate(cup.sources);
  const needMouths = mouthsNeedHydrate(cup.mouths);
  const components = flavorComponents(sources, totalVolume);
  const totalMouths = cup.totalMouths || Math.max(MIN_MOUTHS, Math.ceil((totalVolume || 0) / MOUTHFUL_ML));
  const abvMix = totalVolume > 0
    ? sources.reduce((n, s) => n + s.volume * (s.abv || 0), 0) / totalVolume
    : 0;

  if (needSources) {
    cup.sources = sources;
    cup.totalVolume = totalVolume;
    cup.claimedFlavor = Object.fromEntries(
      FLAVOR_AXES.map((axis) => [
        axis,
        sources.reduce((n, s) => n + ((s.flavor?.[axis] || 0) * s.volume) / (totalVolume || 1), 0)
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
    ingredients
  );
  cup.caffeinePerMouth = (cup.totalMouths || totalMouths)
    ? cup.caffeineTotal / (cup.totalMouths || totalMouths)
    : 0;
  if (!cup.claimedFlavor) cup.claimedFlavor = zeroFlavorAxes();
  return cup;
}
