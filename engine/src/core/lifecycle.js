// 普通版（无网关）跨天状态生命周期。
//
// 三件事在这里定义，其它模块只调用不重复实现：
//   1. 配置解析（时区 / 临时状态 TTL / 断片开关与恢复时长）
//   2. 日分桶（按可配置时区，不用服务器本地时区）
//   3. 断片（软断片）与 reset 边界、revision
//
// 本模块是纯函数，不读时钟、不碰文件。now 一律由调用方传入，便于 fake clock。

import { BLACKOUT_RECOVER_MS as BLACKOUT_RECOVER_MS_INTERNAL } from './constants.js';

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const DEFAULT_TRANSIENT_TTL_HOURS = 72;

// 唯一来源：constants.js 的 BLACKOUT_RECOVER_MS（60 小时＝2.5 天）。
// **不得再新建竞争常量。**
export { BLACKOUT_RECOVER_MS } from './constants.js';
export const DEFAULT_BLACKOUT_RECOVERY_HOURS = BLACKOUT_RECOVER_MS_INTERNAL / 3600000;

const HOUR_MS = 3600000;

function positiveHours(raw, name) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 必须是大于 0 的小时数，收到：${JSON.stringify(raw)}`);
  }
  return value;
}

function parseBool(raw, name) {
  const text = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  throw new Error(`${name} 必须是 true/false，收到：${JSON.stringify(raw)}`);
}

function assertTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    throw new Error(`PROOF_STATE_TIMEZONE 不是合法时区：${JSON.stringify(tz)}`);
  }
  return tz;
}

// 配置错误必须明确报错，不得静默回退。
export function resolveLifecycleConfig(env = {}) {
  const timezone = env.PROOF_STATE_TIMEZONE === undefined
    ? DEFAULT_TIMEZONE
    : assertTimezone(String(env.PROOF_STATE_TIMEZONE));
  const transientTtlHours = env.PROOF_TRANSIENT_STATE_TTL_HOURS === undefined
    ? DEFAULT_TRANSIENT_TTL_HOURS
    : positiveHours(env.PROOF_TRANSIENT_STATE_TTL_HOURS, 'PROOF_TRANSIENT_STATE_TTL_HOURS');
  const blackoutEnabled = env.PROOF_BLACKOUT_ENABLED === undefined
    ? true
    : parseBool(env.PROOF_BLACKOUT_ENABLED, 'PROOF_BLACKOUT_ENABLED');
  const blackoutRecoveryHours = env.PROOF_BLACKOUT_RECOVERY_HOURS === undefined
    ? DEFAULT_BLACKOUT_RECOVERY_HOURS
    : positiveHours(env.PROOF_BLACKOUT_RECOVERY_HOURS, 'PROOF_BLACKOUT_RECOVERY_HOURS');
  const stateDbPath = env.PROOF_STATE_DB_PATH === undefined ? null : String(env.PROOF_STATE_DB_PATH);
  if (stateDbPath !== null && stateDbPath.trim() === '') {
    throw new Error('PROOF_STATE_DB_PATH 不得为空字符串');
  }
  return {
    timezone,
    transientTtlHours,
    transientTtlMs: transientTtlHours * HOUR_MS,
    blackoutEnabled,
    blackoutRecoveryHours,
    blackoutRecoveryMs: blackoutRecoveryHours * HOUR_MS,
    stateDbPath
  };
}

// 引擎内部用：把可能只给了一部分的 options.lifecycle 补全成完整配置。
export function normalizeLifecycleOptions(partial = {}) {
  const base = resolveLifecycleConfig({});
  const merged = { ...base, ...partial };
  if (partial.blackoutRecoveryHours !== undefined) {
    merged.blackoutRecoveryHours = positiveHours(partial.blackoutRecoveryHours, 'blackoutRecoveryHours');
    merged.blackoutRecoveryMs = merged.blackoutRecoveryHours * HOUR_MS;
  }
  if (partial.transientTtlHours !== undefined) {
    merged.transientTtlHours = positiveHours(partial.transientTtlHours, 'transientTtlHours');
    merged.transientTtlMs = merged.transientTtlHours * HOUR_MS;
  }
  if (partial.timezone !== undefined) merged.timezone = assertTimezone(String(partial.timezone));
  return merged;
}

const dayFormatters = new Map();

// 「按天读取」用的日界线。默认 Asia/Shanghai，绝不使用运行服务器的本地时区。
export function dayKey(now, timezone = DEFAULT_TIMEZONE) {
  let formatter = dayFormatters.get(timezone);
  if (!formatter) {
    assertTimezone(timezone);
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    dayFormatters.set(timezone, formatter);
  }
  return formatter.format(new Date(now));
}

// ---------------- 断片（软断片） ----------------

let blackoutSeq = 0;

export function newBlackoutId(now) {
  blackoutSeq += 1;
  return `bo-${now}-${blackoutSeq}`;
}

// 打开一批断片。已有未闭合的批则不新开，避免同一段被切碎。
export function openBlackout(state, now, config) {
  if (!config.blackoutEnabled) return null;
  const open = (state.fragmentBatches || []).find((batch) => batch.end == null);
  if (open) return open;
  const batch = {
    id: newBlackoutId(now),
    start: now,
    end: null,
    createdAt: now,
    hiddenFrom: now,
    restoreAt: now + config.blackoutRecoveryMs,
    hiddenUntil: now + config.blackoutRecoveryMs,
    mode: 'soft',
    enabled: true,
    readable: false
  };
  state.fragmentBatches.push(batch);
  return batch;
}

// 补齐旧数据缺失的字段；迁移用，幂等。
export function migrateBlackoutBatch(batch, config) {
  const start = Number(batch.start ?? batch.hiddenFrom ?? 0);
  const restoreAt = Number.isFinite(Number(batch.restoreAt))
    ? Number(batch.restoreAt)
    : start + config.blackoutRecoveryMs;
  const migrated = {
    id: batch.id || newBlackoutId(start),
    start,
    end: batch.end ?? null,
    createdAt: batch.createdAt ?? start,
    hiddenFrom: batch.hiddenFrom ?? start,
    restoreAt,
    hiddenUntil: batch.hiddenUntil ?? restoreAt,
    mode: batch.mode || 'soft',
    enabled: batch.enabled !== false,
    readable: batch.readable === true
  };
  if (batch.recovery && typeof batch.recovery === 'object') migrated.recovery = batch.recovery;
  return migrated;
}

// 到点即恢复。**只按 restoreAt 判断，重复调用不得把 restoreAt 往后延。**
export function refreshBlackouts(state, now) {
  for (const batch of state.fragmentBatches || []) {
    if (batch.readable !== true && now >= batch.restoreAt) batch.readable = true;
  }
  return state.fragmentBatches || [];
}

// reset 立即解除当前断片读取限制（内容不删）。
export function liftBlackouts(state, now) {
  for (const batch of state.fragmentBatches || []) {
    if (batch.end == null) batch.end = now;
    batch.readable = true;
  }
  return state.fragmentBatches || [];
}

export function blackoutVisibility(state, now) {
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

// Gateway recovery contract. These helpers are additive: canonical Proof owns
// the visibility decision, while the Gateway only applies it to transcript data.
export const RECOVERY_RESOLUTIONS = ['full', 'partial', 'facts'];

export function resolveRecoveryVisibility(batch) {
  const mode = String(batch?.mode || 'soft');
  const base = mode === 'hard'
    ? { resolution: 'facts', ratio: 1, stages: 1 }
    : { resolution: 'full', ratio: 1, stages: 1 };
  const declared = batch?.recovery;
  if (!declared || typeof declared !== 'object') return base;

  const resolution = RECOVERY_RESOLUTIONS.includes(declared.resolution)
    ? declared.resolution
    : base.resolution;
  const rawRatio = Number(declared.ratio);
  const ratio = Number.isFinite(rawRatio)
    ? Math.min(1, Math.max(0, rawRatio))
    : (resolution === 'full' ? 1 : base.ratio);
  const rawStages = Math.floor(Number(declared.stages));
  const stages = Number.isFinite(rawStages) && rawStages >= 1 ? rawStages : 1;
  return { resolution, ratio, stages };
}

export function recoveryAllowsVerbatim(visibility) {
  return visibility?.resolution !== 'facts';
}

// 某条记录此刻是否可读。断片只遮蔽读取，不删除内容。
export function isRecordReadable(record, state, now) {
  const time = Number(record?.time ?? record?.consumedAt ?? 0);
  for (const batch of state.fragmentBatches || []) {
    if (batch.readable === true) continue;
    if (now >= batch.restoreAt) continue;
    const end = batch.end == null ? Infinity : batch.end;
    if (time >= batch.hiddenFrom && time <= end) return false;
  }
  return true;
}

// ---------------- 临时状态 TTL ----------------

// 超过 TTL 的临时影响一律不再参与计算。
// **敏感度、记录、递出历史不在此列。**
// 临时状态的固定截止点。**以最后一次真实状态事件为准，不是 lastSettle**——
// lastSettle 每次读取都会前进，拿它做 TTL 会让状态永远清不掉。
export function lastTransientActivity(state) {
  const events = state?.drinkEvents || [];
  const fromEvents = events.length ? Math.max(...events.map((e) => Number(e.consumedAt) || 0)) : 0;
  const marked = Number(state?.lastTransientActivityAt || 0);
  return Math.max(fromEvents, marked);
}

export function transientDeadline(state, config) {
  const at = lastTransientActivity(state);
  return at > 0 ? at + config.transientTtlMs : null;
}

// 旧状态（升级前存下来的）既没有 drinkEvents 也没有活动标记，
// 但身上带着酒精 / 宿醉 / 活性成分。不补一个起算点，它们就永远不会过期。
export function seedTransientActivity(state) {
  if (Number(state.lastTransientActivityAt || 0) > 0) return state.lastTransientActivityAt;
  if ((state.drinkEvents || []).length) return 0;
  const hasLoad = Number(state.c || 0) > 0
    || (state.hangoverSnapshots || []).length > 0
    || Object.values(state.actives || {}).some((a) => Number(a?.amount || 0) > 0)
    || (state.beliefResiduals || []).length > 0
    || (state.directBeliefResiduals || []).length > 0
    || (state.characterResiduals || []).length > 0;
  if (!hasLoad) return 0;
  state.lastTransientActivityAt = Number(state.lastSettle || 0);
  return state.lastTransientActivityAt;
}

export function markTransientActivity(state, now) {
  state.lastTransientActivityAt = Math.max(Number(state.lastTransientActivityAt || 0), Number(now) || 0);
  return state.lastTransientActivityAt;
}

export function pruneTransient(state, now, config) {
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

// 事件式账本：每杯一条，各自带结束时间。
// 注意：药理上酒精仍按单一负荷代谢（真实药理如此），
// 本账本用于幂等、过期判定与投影的 expiresAt，不改变数值口径。
export function recordDrinkEvent(state, event, config) {
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

// 未过期的饮用事件。
// **默认只看当天**（按配置时区的日界线）——公开约定：
// 「三天内喝了哪些酒是有记录的，优先默认只看当天的酒，
//   然后在他今天喝的酒的基础上进行效果的增加」。
//
// 注意这跟「跨午夜不归零」不冲突：**代谢是连续的**（state.c 照常衰减），
// 23:50 喝的酒在次日 01:00 仍然在生效；
// 只是**账本上它属于昨天**，不再计入「今天喝了什么」。
export function activeDrinkEvents(state, now, config = null, scope = 'today') {
  const alive = (state.drinkEvents || []).filter((event) => event.expiresAt > now);
  if (scope !== 'today' || !config) return alive;
  const today = dayKey(now, config.timezone);
  return alive.filter((event) => dayKey(event.consumedAt, config.timezone) === today);
}

// ---------------- revision 与 reset 边界 ----------------

export function bumpRevision(state) {
  state.revision = Number(state.revision || 0) + 1;
  return state.revision;
}

// 同一时刻重复 reset 视为同一次：不再推进 revision，
// 否则客户端会因为一次无变化的 reset 白白重取一遍。
export function markResetBoundary(state, now) {
  if (state.resetBoundary && Number(state.resetBoundary.at) === Number(now)) {
    return state.resetBoundary;
  }
  state.resetBoundary = { at: now, revision: bumpRevision(state) };
  return state.resetBoundary;
}

// restore 时用：旧包不得越过 reset 边界把已清掉的状态带回来。
export function applyResetBoundary(state, boundary) {
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


// ---------------- 断片的「压缩」摘要 ----------------
//
// **压缩不是空白，是低分辨率。**
// 被遮蔽的时段不应该读起来像「什么都没有」，
// 而应该像 compact 之后的状态：记得事件类型，但没有原始文本。
//
// 所以给梗概、给统计，不给正文：
//   - 数得出来的东西（几杯、多久）保留
//   - 内容（说了什么、哪一杯是什么）丢掉

export function blackoutDigest(state, now) {
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
    if (r.type === '喝下') {
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

function spanWords(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 30) return '很短的一段';
  const hours = ms / 3600000;
  if (hours < 1.5) return '一个小时左右';
  return `${Math.round(hours)} 个多小时`;
}

// 梗概的措辞。**只陈述，不下指令。**
export function blackoutDigestText(digest) {
  if (!digest) return '';
  if (!digest.cups) return '那一段还在，但只剩轮廓。具体发生了什么，追不回来。';
  return `那一段还在，但只剩轮廓：${spanWords(digest.spanMs)}，${digest.cups} 口酒，有人说了话。具体说了什么，追不回来。`;
}
