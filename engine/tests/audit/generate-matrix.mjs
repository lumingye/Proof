import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProofEngine } from '../../src/engine/ProofEngine.js';
import { realPack, cloneCup, menu, potion, fourWaters, hiddenHeaven, hiddenBlack, ingredients, effectLexicon } from '../../src/content/realPack.js';
import { computeCupEffect, snapshotEffectBaseline } from '../../src/core/effects.js';
import { STATE_AXES, defaultSensitivity } from '../../src/core/constants.js';
import { emptyActives } from '../../src/core/active.js';

const T0 = 1_700_000_000_000;
const MIXER = 'mixer';
const DRINKER = 'drinker';

function engine() {
  return new ProofEngine(null, realPack);
}

function drink(cup, beta) {
  const e = engine();
  const c = cloneCup(cup, { beta, totalMouths: Math.min(cup.totalMouths || 2, 4) });
  const id = e.createOffer(c, MIXER, MIXER, DRINKER, T0);
  const r = e.drinkOffer(id, DRINKER, `m-${cup.claimedName}-${beta}`, T0);
  const desc = r.projection?.actualEffectDescription?.text || '';
  const baseline = snapshotEffectBaseline({
    c: 0,
    actives: emptyActives(T0),
    hangoverSnapshots: [],
    beliefResiduals: [],
    eventPeak: 0,
    sensitivity: defaultSensitivity()
  }, T0);
  const drunkCup = e.offers.get(id)?.cup || c;
  const effect = r.ok ? computeCupEffect(e.state, baseline, drunkCup, T0, realPack) : null;
  return {
    ok: r.ok,
    c: r.eval?.c ?? e.state.c,
    state: r.eval?.state || null,
    dominant: r.eval?.dominant || effect?.dominant || null,
    text: desc,
    delta: effect?.delta || null,
    actual: effect?.actualState || null,
    counterfactual: effect?.counterfactualState || null
  };
}

const drinks = [
  ...menu.map((m) => ({ ...m, catalog: 'menu' })),
  { ...potion, catalog: 'special' },
  { ...fourWaters, catalog: 'fixture' },
  { ...hiddenHeaven, catalog: 'unlisted' },
  { ...hiddenBlack, catalog: 'unlisted' }
];

const rows = drinks.map((d) => {
  const sober0 = drink(d, 0);
  const sober1 = drink(d, 1);
  const recipe = (d.recipe || []).map((p) => ({ id: p.id, volume: p.volume, abv: ingredients[p.id]?.abv ?? null }));
  return {
    id: d.id,
    name: d.claimedName,
    catalog: d.catalog,
    kind: d.kind,
    listed: d.listed !== false && d.kind !== 'unlisted',
    recipe,
    standardDrinks: d.standardDrinks,
    caffeineTotal: d.caffeineTotal || 0,
    claimedEffects: d.effects || null,
    intro: d.intro || '',
    finish: d.finish || '',
    zeroPossible: (d.standardDrinks || 0) === 0 && !d.caffeineTotal,
    soberBeta0: sober0,
    soberBeta1: sober1
  };
});

let lexiconCount = 0;
const lexiconSlots = [];
for (const axis of STATE_AXES) {
  const node = effectLexicon[axis];
  if (axis === '精度') {
    for (const tier of ['低', '中', '高']) {
      lexiconSlots.push({ axis, direction: '−', tier, text: node?.['−']?.[tier] || null });
      lexiconCount += node?.['−']?.[tier] ? 1 : 0;
    }
  } else {
    for (const dir of ['+', '−']) {
      for (const tier of ['低', '中', '高']) {
        lexiconSlots.push({ axis, direction: dir, tier, text: node?.[dir]?.[tier] || null });
        lexiconCount += node?.[dir]?.[tier] ? 1 : 0;
      }
    }
  }
}

const actives = Object.entries(ingredients)
  .filter(([, ing]) => ing.activeIngredient)
  .map(([id, ing]) => ({
    id,
    activeIngredient: ing.activeIngredient,
    activeAmount: ing.activeAmount,
    referenceVolumeMl: ing.referenceVolumeMl,
    abv: ing.abv
  }));

const matrix = {
  generatedAt: '2026-09-02',
  baseline: 'e6b70094adc107eda016b535132d7b044452f19c',
  tolerance: { dose: 1e-6, state: 1e-6, source: 'IEEE-754 on SPEC constants' },
  inventory: {
    publicDrinks: rows.filter((r) => r.listed).length,
    hiddenOrSpecial: rows.filter((r) => !r.listed).length,
    ingredients: Object.keys(ingredients).length,
    actives: actives.length,
    lexiconSlots: lexiconCount
  },
  actives,
  lexiconSlots,
  drinks: rows
};

const out = resolve(dirname(fileURLToPath(import.meta.url)), './effect-matrix.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(matrix, null, 2)}\n`);
console.log(`wrote ${out} drinks=${rows.length} lexicon=${lexiconCount}`);
