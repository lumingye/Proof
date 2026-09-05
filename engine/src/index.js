export { ProofEngine } from './engine/ProofEngine.js';
export { mlToStandardDrinks, metabolize, doseToPhysiology, doseToReaction } from './core/dose.js';
export {
  metabolizeCaffeine,
  caffeineToPhysiology,
  caffeineOfParts,
  collectActives,
  ingestActives,
  settleActives,
  resetActives,
  activeAmount,
  activesToPhysiology,
  exportActives,
  restoreActives,
  emptyActives
} from './core/active.js';
export {
  ACTIVE_DEFS,
  ACTIVE_AXIS_WHITELIST,
  validateActiveDefs,
  compoundPeak,
  normalizeIngredientActives
} from './content/actives.js';
export {
  parseShorthand,
  phraseTier,
  resolveClaimedEffects,
  claimedEffectsOrZero,
  assembleEffectDescription,
  publicEffectDescription,
  computeCupEffect,
  describeCupEffect,
  counterfactualDelta
} from './core/effects.js';
export { mouthSuggestion, currentBeliefStrength, computeBeta } from './core/belief.js';
export {
  flavorProjectionAtTime,
  computeRatio,
  computeDiscreteness,
  countSignificantSources,
  flavorPeakForMouth,
  isSuppressed,
  reportedFlavor,
  assembleFlavorDescription,
  peakFlavor
} from './core/flavor.js';
export {
  sanitizeClaimedName,
  sanitizeIntro,
  sanitizeFinish,
  looksLikeRecipe,
  looksLikeInstruction,
  normalizeUntrusted
} from './core/sanitize.js';
export { buildStateInjection, injectionEnabled, STATE_FRAME_NOTE, DETERMINISTIC_EFFECT_FRAME_NOTE, OBJECTIVE_EFFECT_FRAME_NOTE, BELIEF_EFFECT_FRAME_NOTE } from './core/injection.js';
export { sanitizeSubjectiveBelief, BELIEF_AXIS_CAP, SUBJECTIVE_BELIEF_MIN, SUBJECTIVE_BELIEF_MAX_CHARS } from './core/belief.js';
export { createTurnBridge, formatContextBlock, hookAdditionalContext } from './runtime/turnBridge.js';
export { buildAgentTurnContext } from './runtime/agentTurnContext.js';
export { buildAgentStateHints } from './runtime/agentStateHints.js';
export { projectAgentObjectiveStates } from './runtime/agentObjectiveStates.js';
export {
  resolveLifecycleConfig,
  normalizeLifecycleOptions,
  dayKey,
  blackoutVisibility,
  isRecordReadable,
  DEFAULT_TIMEZONE,
  DEFAULT_TRANSIENT_TTL_HOURS,
  DEFAULT_BLACKOUT_RECOVERY_HOURS,
  BLACKOUT_RECOVER_MS
} from './core/lifecycle.js';
export { hydrateCupPhysics, resolveIngredient } from './core/recipe.js';
export { createHangoverSnapshot, currentHangover } from './core/hangover.js';
export {
  produceVomitEvent,
  produceCrashEvent,
  produceCollapseState,
  produceBlackoutState,
  collapseActive,
  COPY_PENDING_USER_REVIEW,
  SAFETY_NOTE
} from './core/failure.js';
export {
  hashUnit,
  resolveHiddenDraw,
  hiddenOutcomeCopy,
  blackEligible,
  heavenEligible,
  assembleClashingFlavorDescription,
  HIDDEN_DRAW_P,
  HIDDEN_BLACK_NAME,
  HIDDEN_HEAVEN_NAME,
  HEAVEN_MIN_ABV,
  HEAVEN_ELIGIBILITY_STATUS,
  isHiddenIdentity,
  isReservedHiddenName,
  normalizeDrinkName
} from './core/hiddenDraw.js';
export { GARNISHES, isGarnish, normalizeGarnishes } from './core/garnish.js';
export { barManual, manualFor, ingredientManual, ingredientManualFor } from './content/barManual.js';
export { computeColor, computeCupType, CUP_CAPACITY_ML } from './core/appearance.js';
export { projectForViewer, sanitizePublicEffectDescription } from './core/visibility.js';
export {
  realPack,
  buildCup,
  buildFromParts,
  cloneCup,
  potion,
  fourWaters,
  hiddenHeaven,
  hiddenBlack,
  statusCopy,
  hiddenOutcomes,
  COPY_PENDING_USER_REVIEW as CONTENT_COPY_PENDING,
  ingredients,
  effectLexicon,
  flavorLexicon,
  menu,
  menuItem
} from './content/realPack.js';
export { exampleReactionCurve, exampleAdoptionWeights } from './content/examplePack.js';
