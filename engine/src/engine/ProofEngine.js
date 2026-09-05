// Proof 引擎主类。核心机制由本模块实现。

import {
  EXPIRE_MIN,
  BLACKOUT_C,
  BLACKOUT_RECOVER_MS,
  VOMIT_C,
  SENSITIVITY_MIN,
  SENSITIVITY_MAX,
  SENSITIVITY_STEP,
  defaultSensitivity,
  defaultReactionCurve,
  defaultAdoptionWeights,
  FLAVOR_AXES
} from '../core/constants.js';
import { mlToStandardDrinks, metabolize } from '../core/dose.js';
import { mouthSuggestion, addVectors, resolveAgentBeliefs } from '../core/belief.js';
import { computeDiscreteness, countSignificantSources, flavorPeakForMouth, reportedFlavor, assembleFlavorDescription } from '../core/flavor.js';
import {
  emptyActives,
  metabolizeCaffeine,
  caffeineOfParts,
  collectActives,
  ingestActives,
  settleActives,
  resetActives,
  activeAmount,
  exportActives,
  restoreActives
} from '../core/active.js';
import {
  normalizeLifecycleOptions,
  openBlackout,
  migrateBlackoutBatch,
  refreshBlackouts,
  liftBlackouts,
  pruneTransient,
  recordDrinkEvent,
  activeDrinkEvents,
  bumpRevision,
  markResetBoundary,
  applyResetBoundary,
  markTransientActivity,
  seedTransientActivity
} from '../core/lifecycle.js';
import {
  resolveClaimedEffects,
  claimedEffectsOrZero,
  snapshotEffectBaseline,
  describeCupEffect,
  assembleEffectDescription,
  publicEffectDescription
} from '../core/effects.js';
import { hydrateCupPhysics } from '../core/recipe.js';
import { sanitizeClaimedName, sanitizeIntro, sanitizeFinish, isPlainName } from '../core/sanitize.js';
import { injectionEnabled, buildStateInjection } from '../core/injection.js';
import {
  createHangoverSnapshot,
  pruneHangoverSnapshots,
  currentHangover
} from '../core/hangover.js';
import {
  produceVomitEvent,
  produceCrashEvent,
  produceCollapseState,
  produceBlackoutState,
  shouldVomit,
  rollCrash,
  attachSafety,
  collapseActive
} from '../core/failure.js';
import { computeColor, computeCupType, firstScreenFields } from '../core/appearance.js';
import { evaluateCup, emptyProjection } from '../core/evaluate.js';
import { projectForViewer } from '../core/visibility.js';
import {
  hashUnit,
  resolveHiddenDraw,
  applyHiddenIdentity,
  hiddenOutcomeCopy,
  assembleClashingFlavorDescription,
  isHiddenIdentity,
  HIDDEN_BLACK_NAME
} from '../core/hiddenDraw.js';
import { flavorHasSignal } from '../core/flavor.js';

function randomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class ProofEngine {
  constructor(state = null, contentPack = null, options = {}) {
    this.contentPack = contentPack || {
      reactionCurve: defaultReactionCurve,
      adoptionWeights: defaultAdoptionWeights()
    };
    this.random = options.random || Math.random;
    this.hiddenHashUnit = options.hiddenHashUnit || hashUnit;
    // 杯 id 工厂。生产恒为 randomUUID；**只有测试可以注入固定 id**，
    // HTTP/API 不暴露任何指定 cupId 或抽卡结果的入口。
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : randomUUID;
    this.allowHiddenFixtures = options.allowHiddenFixtures === true;
    this.options = options;
    // 两套选项名统一成一份配置：既有 blackoutEnabled / blackoutRecoverMs
    // 与生命周期契约的 options.lifecycle 合流，**不并存两套表示**。
    this.lifecycle = normalizeLifecycleOptions({
      ...(options.blackoutEnabled === undefined ? {} : { blackoutEnabled: options.blackoutEnabled !== false }),
      ...(options.blackoutRecoverMs === undefined ? {} : { blackoutRecoveryHours: options.blackoutRecoverMs / 3600000 }),
      ...(options.lifecycle || {})
    });
    this.blackoutEnabled = this.lifecycle.blackoutEnabled;
    this.blackoutRecoverMs = this.lifecycle.blackoutRecoveryMs;
    this.state = state ? this._hydrate(state) : this._emptyState();
    // 升级前存下来的旧状态没有活动起算点，补一个，否则它的临时状态永不过期。
    seedTransientActivity(this.state);
    if (options.resetBoundary) applyResetBoundary(this.state, options.resetBoundary);
    this.offers = new Map();
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
      // 累计标准杯（终身）。同时驱动口味耐受与功能性酒精耐受；reset 不清除。
      lifetimeDrinks: 0
    };
  }

  _hydrate(raw) {
    const base = this._emptyState();
    return {
      ...base,
      ...raw,
      hangoverSnapshots: [...(raw.hangoverSnapshots || [])],
      actives: raw.actives ? restoreActives(raw.actives, Number(raw.lastSettle || 0)) : emptyActives(),
      effectBaseline: raw.effectBaseline ? structuredClone(raw.effectBaseline) : null,
      pendingSensitivity: [...(raw.pendingSensitivity || [])],
      beliefResiduals: [...(raw.beliefResiduals || [])],
      directBeliefResiduals: [...(raw.directBeliefResiduals || [])],
      characterResiduals: [...(raw.characterResiduals || [])],
      tonightDelivered: [...(raw.tonightDelivered || [])],
      records: [...(raw.records || [])],
      tasteCurves: [...(raw.tasteCurves || [])],
      lastEvents: [...(raw.lastEvents || [])],
      sensitivity: { ...defaultSensitivity(), ...(raw.sensitivity || {}) },
      stateInjection: raw.stateInjection === true,
      schemaVersion: 2,
      revision: Number(raw.revision || 0),
      lastTransientActivityAt: Number(raw.lastTransientActivityAt || 0),
      lifetimeDrinks: Number(raw.lifetimeDrinks || 0),
      resetBoundary: raw.resetBoundary ? { ...raw.resetBoundary } : null,
      drinkEvents: [...(raw.drinkEvents || [])],
      transientExpiredAt: raw.transientExpiredAt ?? null,
      // 旧数据没有 restoreAt / id / mode，在这里补齐；幂等。
      fragmentBatches: [...(raw.fragmentBatches || [])].map((batch) => migrateBlackoutBatch(batch, this.lifecycle))
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
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const { offers, ...state } = data;
    return new ProofEngine(state, contentPack, { ...options, offers });
  }

  restoreState(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const { offers, ...state } = data;
    this.state = this._hydrate(state);
    this.offers = new Map();
    if (offers) {
      for (const [id, offer] of Object.entries(offers)) this.offers.set(id, offer);
    }
    return this;
  }

  settle(now) {
    const s = this.state;
    if (now < s.lastSettle) {
      // 允许测试时钟，但不倒退代谢
      return s;
    }
    // 超过 TTL 的临时状态直接作废，不再跨越三天做代谢外推。
    if (pruneTransient(s, now, this.lifecycle)) {
      s.lastSettle = now;
      refreshBlackouts(s, now);
      return s;
    }
    const hours = (now - s.lastSettle) / 3600000;
    const cBefore = s.c;
    s.c = metabolize(s.c, hours);
    s.lastSettle = now;

    if (!s.actives) s.actives = emptyActives();
    // 逐化合物独立衰减，各存各的时间戳（机制约定）。归零即删键。
    settleActives(s, now);

    if (cBefore > 0 && s.c === 0) {
      const snap = createHangoverSnapshot(s.eventPeak, now);
      if (snap) s.hangoverSnapshots.push(snap);
      // 归还不挂在「酒醒」上：普通模式按 restoreAt（默认 60 小时）恢复。
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
    // 真正喝到的酒款已经由 characterEffects 直接给性格推力；
    // 名字和真实身份一致时不再额外叠一份同名 placebo，避免“啤酒算两次”。
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
    const limit = EXPIRE_MIN * 60 * 1000;
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
      type: '本杯效果',
      recipient: cup.drinkerId,
      cupId: cup.id,
      actualEffectDescription: desc,
      time: now
    };
    this.state.lastEvents = [...(this.state.lastEvents || []), event];
    const visibleTo = [...new Set([cup.drinkerId, cup.mixerId].filter(Boolean))];
    this.state.records.push({
      id: `effect-${cup.id}`,
      cupId: cup.id,
      type: '本杯效果',
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
      const delta = item.delta
        ?? (item.direction === '淡' || item.direction === 'down' ? -SENSITIVITY_STEP : SENSITIVITY_STEP);
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
      r = { cupId, cumulative: { 愉悦: 0, 唤醒: 0, 亲近: 0, 守门: 0, 欲望: 0, 精度: 0 }, decayStart: null };
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
        cumulative: { 愉悦: 0, 唤醒: 0, 亲近: 0, 守门: 0, 欲望: 0, 精度: 0 },
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
      r = { cupId, cumulative: { 愉悦: 0, 唤醒: 0, 亲近: 0, 守门: 0, 欲望: 0, 精度: 0 }, decayStart: null };
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
    const k = activeAmount(this.state.actives, '咖啡因');
    if (!cup && !this.state.currentCup && this.state.c === 0 && k === 0
      && this.state.beliefResiduals.length === 0 && this.state.directBeliefResiduals.length === 0
      && this.state.characterResiduals.length === 0) {
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
    if (mouth.applied) return { skipped: true, reason: 'already_applied' };

    if (this._hasOpenCup() && this.state.currentCup.id !== cup.id) {
      return { ok: false, error: '一杯未结束前不得开始喝第二杯', skipped: true };
    }

    const startingThisCup = !this.state.currentCup
      || this.state.currentCup.id !== cup.id
      || this.state.currentCup.closed;
    if (startingThisCup) {
      this.state.effectBaseline = snapshotEffectBaseline(this.state, now);
      this.state.pendingSensitivity = this.state.pendingSensitivity || [];
    }

    const cWasZero = this.state.c === 0;
    if (cWasZero) this.state.eventPeak = 0;

    // 固定酒的主观性格由登记效果定义；这不能抹掉真实配方的客观药理。
    // 酒精与活性物对所有杯型照常入账，精度、代谢、呕吐与断片据此结算。
    const fixedCharacterCup = cup.kind === 'menu';
    const alcohol = mlToStandardDrinks(mouth.volume, mouth.abv || 0);
    const cBefore = this.state.c;
    this.state.c += alcohol;

    // 活性成分：整杯一次算出各化合物总份数，按口数分摊。
    // cup.activesTotal 由 buildFromParts 预先算好；没有就现场从配方收集。
    const totalMouths = cup.totalMouths || 1;
    const activesTotal = cup.activesTotal
      || collectActives(cup.recipe || cup.parts || [], this.contentPack?.ingredients);
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
    cur.mouthStartTimes = [...(cur.mouthStartTimes || []), now];
    cur.drunk = true;

    // A. 这款酒本身的“性格”——实际喝到才有，不走 β / 信念采纳率。
    const characterBase = cup.characterEffects || null;
    if (characterBase && Object.values(characterBase).some((v) => v)) {
      const characterStep = mouthSuggestion(characterBase, 1, cup.totalMouths);
      const residual = this._characterResidualFor(cup.id);
      residual.cumulative = addVectors(residual.cumulative, characterStep);
    }

    // B1. 对象信念——名字/声称 + Agent 自己判断“这是什么/含什么”。
    // B2. 纯效果信念——Agent 直接相信“喝完会怎样”。两者都不是百分百，之后仍乘 adoptionWeights。
    // 纯效果信念单独存池：它能推主观状态，但不能污染味觉，也永远不能动精度。
    const namedSuggestion = mouth.suggestion
      || mouthSuggestion(this._beliefBase(cup), mouth.beta ?? cup.beta ?? 1, cup.totalMouths);
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
    if (shouldVomit(cBefore, this.state.c, this.state.vomitArmed)) {
      events.push(attachSafety(produceVomitEvent(this.contentPack)));
      this.state.vomitArmed = false;
    }
    this._recoverFragments(now);
    if (this.blackoutEnabled && this.state.c >= BLACKOUT_C) {
      const hadOpenBlackout = (this.state.fragmentBatches || []).some((batch) => batch.end == null);
      const opened = this._openFragment(now);
      // 同一段持续断片只能“进入”一次。继续喝、甚至喝白水，都仍处在同一批断片里，
      // 不能每口/每杯重新播报一次“又断了”。只有从无 open batch → 新建 batch 才发事件。
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


    // 终身累计：口味耐受与功能性酒精耐受的共同来源。**reset 不清它**（那是"长期"的意思）。
    this.state.lifetimeDrinks = Number(this.state.lifetimeDrinks || 0) + alcohol;
    this._sipSeq = (this._sipSeq || 0) + 1;
    const drinkRecordId = `${cup.id}-sip-${mouthIndex}-${now}-${this._sipSeq}`;
    this.state.records.push({
      id: drinkRecordId,
      cupId: cup.id,
      type: '喝下',
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
      // 隐藏酒的固定状态：**抽中即必定发生**，不看 c 阈值、不掷随机。
      // 2026-09-03 用户裁定：原意就是「黑必吐、heaven 必宕机」；
      // 之前只固定了文案、不出状态，还写了断言钉住（S16-8 / regression 各一处）。
      // 映射按她自己写的原文走：
      //   黑    「你的胃皱了起来，你伸手去扶桌沿——」        → 吐
      //   heaven「你的大脑中一片空白……宇宙在你的身体里膨胀」 → 宕机
      // 必须挂在**喝完整杯**这一刻：lastEvents 每一口都会被覆盖，
      // 挂在第一口会被后面的口冲掉（实测过）。
      if (isHiddenIdentity(cup.claimedName)) {
        this.state.lastEvents = [...this.state.lastEvents, attachSafety(
          cup.claimedName === HIDDEN_BLACK_NAME
            ? produceVomitEvent(this.contentPack)
            : produceCrashEvent(this.contentPack)
        )];
      }
      // 事件账本：每杯一条，各自到期。同一 eventId 只入账一次。
      recordDrinkEvent(this.state, {
        eventId: `${cup.id}@${now}`,
        cupId: cup.id,
        consumedAt: now,
        standardDrinks: (cup.mouths || []).reduce((sum, m) => sum + mlToStandardDrinks(m.volume, m.abv || 0), 0)
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
      intro: cup.intro || '',
      finish: cup.finish || '',
      description: cup.description || '',
      effects: cup.effects || null,
      characterEffects: cup.characterEffects || null,
      characterIdentity: cup.characterIdentity || null,
      agentBeliefs: this._cloneValue(cup.agentBeliefs || []),
      claimedEffects: cup.claimedEffects || claimedEffectsOrZero(cup, this.contentPack),
      claimedEffectText: cup.claimedEffectText || this._claimedEffectText(resolveClaimedEffects(cup, this.contentPack)),
      caffeineTotal: cup.caffeineTotal || 0,
      caffeinePerMouth: cup.caffeinePerMouth || 0,
      baseVector: cup.baseVector || cup.effects || null,
      kind: cup.kind || 'custom',
      mixerId: cup.mixerId,
      drinkerId: cup.drinkerId,
      recipeRevealedTo: cup.recipeRevealedTo || [],
      hiddenDraw: cup.hiddenDraw || null,
      registeredEffectText: cup.registeredEffectText || '',
      registeredFlavorText: cup.registeredFlavorText || '',
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
      // 默认仍然拒绝——管理员模式（醒酒 / 这晚不算）的既有语义一个字不动。
      // 只有明确要求放弃时才放弃，且走 discardCurrentCup()，不删任何历史。
      if (!discardOpenCup) return { ok: false, error: '当前杯尚未结算' };
      this.discardCurrentCup(now);
    }
    const s = this.state;
    const eventPeakBefore = s.eventPeak;

    if (mode === '醒酒') {
      const snap = createHangoverSnapshot(eventPeakBefore, now);
      if (snap) s.hangoverSnapshots.push(snap);
      s.c = 0;
      s.eventPeak = 0;
      s.tonightPeak = 0;
      s.beliefResiduals = [];
      s.directBeliefResiduals = [];
      s.characterResiduals = [];
      s.vomitArmed = true;
      // 保留当前杯及味觉曲线；不恢复已经喝掉的部分
    } else if (mode === '连宿醉一起清') {
      s.c = 0;
      s.eventPeak = 0;
      s.tonightPeak = 0;
      s.hangoverSnapshots = [];
      s.beliefResiduals = [];
      s.directBeliefResiduals = [];
      s.characterResiduals = [];
      s.vomitArmed = true;
    } else if (mode === '这晚不算') {
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
    // 接口约定：reset 解除当前断片读取限制（内容不删），并写下边界。
    liftBlackouts(s, now);
    s.drinkEvents = [];
    s.lastTransientActivityAt = 0;
    markResetBoundary(s, now);
    return s;
  }

  // 尚未过期的饮用事件（各自带 expiresAt）。
  lifecycleEvents(now = this.state.lastSettle, scope = 'today') {
    return activeDrinkEvents(this.state, now, this.lifecycle, scope);
  }

  updateSensitivity(drinkRecordId, axis, direction, now = this.state.lastSettle) {
    this.settle(now);
    if (!drinkRecordId) return { ok: false, error: 'no_drink_record' };
    const rec = this.state.records.find((r) => r.id === drinkRecordId);
    if (!rec) return { ok: false, error: 'no_drink_record' };
    if (!(axis in this.state.sensitivity)) return { ok: false, error: 'unknown_axis' };
    const delta = direction === '淡' || direction === 'down' ? -SENSITIVITY_STEP : SENSITIVITY_STEP;
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
    if (this.state.currentCup && (
      this.state.currentCup.id === offerOrCupId
      || this.state.currentCup.id === offer?.cup?.id
    )) {
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
    if (!target) return { ok: false, error: 'not_found' };
    const mixerId = offer?.mixerId ?? target.mixerId;
    if (!actorId || actorId !== mixerId) {
      return { ok: false, error: 'not_mixer' };
    }
    const revealed = [...new Set([...(target.recipeRevealedTo || []), toId])];
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
    this.state.records.push({ ...record, type: '递出' });
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
      garnishes: [...(prepared.garnishes || [])],
      recipe: prepared.recipe,
      effects: prepared.effects,
      claimedEffects: prepared.claimedEffects,
      claimedEffectText: prepared.claimedEffectText || '',
      description: prepared.description,
      finish: prepared.finish || '',
      kind: prepared.kind,
      recipeRevealedTo: prepared.recipeRevealedTo || [],
      status: 'open',
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
    const out = new Set();
    for (const m of this.contentPack.menu || []) {
      if (m.intro) out.add(m.intro);
    }
    for (const copy of Object.values(this.contentPack.hiddenOutcomes || {})) {
      if (copy.intro) out.add(copy.intro);
    }
    return out;
  }

  _sanitizeProjection(projection) {
    if (!projection || typeof projection !== 'object') return projection;
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
    if (!vec) return '';
    const assembled = assembleEffectDescription(vec, this.contentPack?.effectLexicon);
    return publicEffectDescription(assembled).text || '';
  }

  _prepareCup(cup, mixerId, drinkerId) {
    const cloned = this._cloneValue(cup);
    const recipeId = cloned.recipeId || cloned.id || cloned.claimedName;
    cloned.id = this.idFactory();
    cloned.recipeId = recipeId;
    cloned.mixerId = mixerId;
    cloned.drinkerId = drinkerId;
    cloned.kind = cloned.kind || 'custom';
    if (!this.allowHiddenFixtures) cloned.internalHidden = false;
    cloned.recipeRevealedTo = [];
    cloned.claimedName = sanitizeClaimedName(cloned.claimedName, {
      ingredientIds: this._ingredientIds(),
      allowMenuNames: this._menuNames()
    }) || '未命名';
    cloned.intro = sanitizeIntro(cloned.intro, { ingredientIds: this._ingredientIds() });
    cloned.finish = sanitizeFinish(cloned.finish, { ingredientIds: this._ingredientIds(), strict: false }).value;
    cloned.sources = this._cloneValue(cloned.sources || []);
    cloned.recipe = this._cloneValue(
      cloned.recipe || cloned.sources.map((s) => ({ id: s.id, volume: s.volume }))
    );
    hydrateCupPhysics(cloned, this.contentPack?.ingredients);
    const totalVolume = cloned.totalVolume
      ?? cloned.sources.reduce((n, s) => n + (s.volume || 0), 0);
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
      cloned.claimedName = '未命名';
    }
    cloned.caffeineTotal = caffeineOfParts(
      cloned.recipe || (cloned.sources || []).map((s) => ({ id: s.id, volume: s.volume })),
      this.contentPack.ingredients
    );
    cloned.caffeinePerMouth = cloned.totalMouths
      ? cloned.caffeineTotal / cloned.totalMouths
      : 0;
    return cloned;
  }

  viewOffer(oneTimeId, viewerId, now = this.state.lastSettle) {
    this.settle(now);
    const offer = this.offers.get(oneTimeId);
    if (!offer) return { ok: false, error: 'not_found' };
    const projection = this._sanitizeProjection(
      projectForViewer(offer, viewerId, { drunk: offer.status === 'consumed', phase: 'first' })
    );
    return { ok: true, projection, status: offer.status };
  }

  drinkOffer(oneTimeId, viewerId, requestId, now = this.state.lastSettle) {
    this.settle(now);
    const offer = this.offers.get(oneTimeId);
    if (!offer) return { ok: false, error: 'not_found' };
    if (viewerId !== offer.drinkerId) {
      return { ok: false, error: 'not_drinker' };
    }
    if (offer.status === 'rejected' || offer.status === 'expired') {
      return { ok: false, error: offer.status };
    }
    if (offer.status === 'consumed') {
      return {
        ok: true,
        idempotent: true,
        projection: offer.consumedResult,
        events: this._cloneValue(offer.consumedEvents || []),
        states: this._cloneValue(offer.consumedStates || [])
      };
    }
    if (this._hasOpenCup() && this.state.currentCup.id !== offer.cup.id) {
      return { ok: false, error: '一杯未结束前不得开始喝第二杯' };
    }

    const cBefore = this.state.c;
    const sipResults = this.sipAll(offer.cup, now);
    // 一杯可能有多口；吐/首次断片可能发生在跨阈值的中间一口，宕机只在
    // 第一口判定。不能只返回最后一口的 lastEvents，否则后续空事件会把
    // 已经发生的一次性客观事件覆盖掉。
    const eventKeys = new Set();
    const drinkEvents = [];
    for (const event of [
      ...sipResults.flatMap((sip) => sip?.events || []),
      ...(this.state.lastEvents || [])
    ]) {
      const key = `${event?.type || 'event'}:${event?.kind || ''}:${event?.script || ''}`;
      if (eventKeys.has(key)) continue;
      eventKeys.add(key);
      drinkEvents.push(event);
    }
    this.state.lastEvents = drinkEvents;
    const evalRes = this.evaluateCup(offer.cup, now);
    const objectiveStates = this._cloneValue(evalRes?.presentation?.states || []);
    const flavor = reportedFlavor(offer.cup, evalRes);
    const flavorAssembled = assembleFlavorDescription(
      flavor,
      this.contentPack?.flavorLexicon,
      evalRes.ratioWords,
      offer.cup?.id || offer.oneTimeId
    );
    const extras = this._drinkExtras(offer, flavor, flavorAssembled);
    const projection = this._sanitizeProjection(
      projectForViewer(offer, viewerId, { drunk: true, phase: 'second', extras })
    );
    offer.status = 'consumed';
    offer.consumedRequestId = requestId;
    offer.consumedResult = projection;
    offer.consumedEvents = this._cloneValue(drinkEvents);
    offer.consumedStates = objectiveStates;
    offer.drunkAt = now;
    const rec = this.state.records.find((r) => r.id === oneTimeId);
    if (rec) rec.drunk = true;
    const del = this.state.tonightDelivered.find((r) => r.id === oneTimeId);
    if (del) del.drunk = true;
    this.state.records.push({
      id: `drink-${oneTimeId}`,
      offerId: oneTimeId,
      type: '喝下',
      time: now,
      drunk: true
    });
    const payload = {
      ok: true,
      idempotent: false,
      projection,
      sipResults,
      eval: evalRes,
      states: objectiveStates,
      beforeC: cBefore,
      events: drinkEvents
    };
    const injection = this.currentInjection(now);
    if (injection) payload.stateInjection = injection;
    return payload;
  }

  rejectOffer(oneTimeId, viewerId, now = this.state.lastSettle) {
    this.settle(now);
    const offer = this.offers.get(oneTimeId);
    if (!offer) return { ok: false, error: 'not_found' };
    if (viewerId !== offer.drinkerId) {
      return { ok: false, error: 'not_drinker' };
    }
    if (offer.status === 'consumed') return { ok: false, error: 'already_consumed' };
    if (offer.status === 'expired') return { ok: false, error: 'expired' };
    if (offer.status === 'rejected') return { ok: true, idempotent: true };
    const snapshot = this.exportState();
    offer.status = 'rejected';
    const rec = this.state.records.find((r) => r.id === oneTimeId);
    if (rec) rec.refused = true;
    const del = this.state.tonightDelivered.find((r) => r.id === oneTimeId);
    if (del) del.refused = true;
    this.state.records.push({
      id: `reject-${oneTimeId}`,
      offerId: oneTimeId,
      type: '拒绝',
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
    if (!offer) return { ok: false, error: 'not_found' };
    if (offer.status === 'consumed') return { ok: false, error: 'already_consumed' };
    if (offer.status === 'rejected') return { ok: false, error: 'rejected' };
    if (offer.status === 'expired') return { ok: true, idempotent: true };
    offer.status = 'expired';
    return { ok: true, idempotent: false };
  }

  _deriveIngredientCharacter(cloned) {
    // 已登记酒款/显式特殊效果拥有自己的完整 characterEffects，不能再叠原料性格。
    if (cloned.characterEffects && Object.values(cloned.characterEffects).some((v) => Number(v) !== 0)) return;
    const profiles = this.contentPack?.ingredientCharacterProfiles || {};
    const out = { 愉悦: 0, 唤醒: 0, 亲近: 0, 守门: 0, 欲望: 0, 精度: 0 };
    let hit = false;
    for (const part of cloned.recipe || []) {
      const profile = profiles[part?.id];
      if (!profile) continue;
      const ref = Number(profile.referenceVolume || 0);
      const volume = Number(part?.volume || 0);
      if (!(ref > 0) || !(volume > 0)) continue;
      const factor = volume / ref;
      for (const [axis, value] of Object.entries(profile.effects || {})) {
        if (axis === '精度') continue;
        out[axis] = (out[axis] || 0) + (Number(value) || 0) * factor;
      }
      hit = true;
    }
    if (!hit) return;
    out.精度 = 0;
    cloned.characterEffects = out;
    // 不设置为 claimedName：这是“实际配方里有哪些登记基础酒”的性格，不等于声称的酒名。
    // 因此任意特调若被声称成某登记酒款，仍可另走名字 belief；只有真正的登记酒款会同名去重。
    cloned.characterIdentity = null;
  }

  _restoreListedCopy(cloned) {
    if (cloned.kind !== 'menu') return;
    const listed = (this.contentPack.menu || []).find((m) => m.claimedName === cloned.claimedName);
    if (!listed) return;
    cloned.intro = listed.intro;
    cloned.finish = listed.finish ?? cloned.finish;
    cloned.description = listed.description ?? cloned.description;
    cloned.registeredEffectText = listed.registeredEffectText || cloned.registeredEffectText || '';
    cloned.registeredFlavorText = listed.registeredFlavorText || cloned.registeredFlavorText || '';
    if (listed.effects) {
      cloned.effects = listed.effects;
      cloned.characterEffects = { ...listed.effects, 精度: 0 };
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
      finish: offer.finish ?? cup.finish ?? '',
      actualEffectDescription: offer.actualEffectDescription || cup.actualEffectDescription
    };
    if (draw?.hit && draw.identity) {
      const copy = hiddenOutcomeCopy(draw.identity, this.contentPack);
      extras.actualEffectDescription = { text: copy?.effectText || extras.actualEffectDescription?.text || '' };
      if (draw.identity === HIDDEN_BLACK_NAME) {
        extras.flavorDescription = assembleClashingFlavorDescription(flavor);
      } else {
        extras.flavorDescription = flavorAssembled.text || '';
      }
      return extras;
    }
    extras.flavor = flavor;
    extras.flavorDescription = cup.registeredFlavorText || offer.registeredFlavorText || flavorAssembled.text || '';
    if (!flavorHasSignal(flavor) && (cup.registeredFlavorText || offer.registeredFlavorText)) {
      extras.flavorDescription = cup.registeredFlavorText || offer.registeredFlavorText;
    }
    return extras;
  }

  publicMenu() {
    const items = this.contentPack.menu || [];
    return items.filter((m) => m.listed !== false && m.kind !== 'unlisted');
  }

  aiOrderCatalog() {
    return this.publicMenu().map((cup) => ({
      claimedName: cup.claimedName,
      intro: cup.intro || '',
      recipe: cup.recipe || [],
      flavorText: cup.registeredFlavorText || cup.claimedFlavorText || '',
      effectText: cup.registeredEffectText || cup.claimedEffectText || '',
      finish: cup.finish || '',
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
}

export { firstScreenFields, mlToStandardDrinks };
