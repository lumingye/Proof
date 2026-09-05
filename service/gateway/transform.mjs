// 共享上下文变换管线（V1 里程碑 1）。
//
// 职责：
//   1. 调唯一权威投影 buildAgentTurnContext 取注入块（不复制任何状态计算）；
//   2. 依据引擎权威 fragmentBatches（hiddenFrom/end/restoreAt/readable）对「历史消息」
//      做消息级硬断片过滤；系统/开发指令永不隐藏；tool call 与其 tool result 成组整体处理；
//   3. 给「当前新收消息」本轮放行（先经历，之后才记不清）；
//   4. 返回过滤计划 + 注入块 + revision，由各 provider 适配器用各自形状落地。
//
// 本模块不保存任何正文：正文只进 contentHash 用于账本指纹。
// 时间只来自两处：账本 firstSeenAt（历史消息）与 now（当前尾部消息）。
//
// 恢复源选择见下方「恢复源选择」小节：
//   原始 hidden transcript 仍在 → 逐字恢复（受 Proof 可见度裁剪）
//   原始 transcript 已被 compression 移除 → 退化为 Proof records / digest 事实
//   恢复内容永不落账本，只按 (fragmentId, stage) 记发射标记。

import { createHash } from 'node:crypto';
import { buildAgentTurnContext } from '../../engine/src/runtime/agentTurnContext.js';
import { resolveRecoveryVisibility, recoveryAllowsVerbatim } from '../../engine/src/core/lifecycle.js';
import { normalizeRole, contentHashOf, assertConversationId } from './ledger.mjs';

export const GATEWAY_BLACKOUT_LABEL = '[Proof 断片]';
export const BLACKOUT_PLACEHOLDER = '这一段发生过，但只能想起模糊的轮廓。';
export const GATEWAY_RECOVERY_LABEL = '[Proof 恢复片段]';
export const SYSTEM_SOFT = new Set(['system', 'developer']);

function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

export function placeholderText() {
  return `${GATEWAY_BLACKOUT_LABEL} ${BLACKOUT_PLACEHOLDER}`;
}

export function contentHashOfMessage(role, content) {
  return contentHashOf(content);
}

/**
 * 把 provider 原始消息压成「元信息」列表（index 对齐原始数组），供过滤决策使用。
 * content 不在此处复制正文之外的东西：正文对象原样引用。
 */
export function toMetaList(messages = [], { roleOf, contentOf, toolCallIdOf, toolCallsOf } = {}) {
  return messages.map((raw, index) => ({
    index,
    raw,
    role: normalizeRole(roleOf ? roleOf(raw) : raw.role),
    contentHash: contentHashOf(contentOf ? contentOf(raw) : raw.content),
    toolCallId: toolCallIdOf ? toolCallIdOf(raw) : raw.tool_call_id ?? raw.toolCallId ?? null,
    toolCalls: toolCallsOf ? toolCallsOf(raw) : raw.tool_calls ?? raw.toolCalls ?? null,
    hasToolCalls: Boolean(toolCallsOf ? toolCallsOf(raw)?.length : (raw.tool_calls ?? raw.toolCalls)?.length)
  }));
}

/**
 * 纯决策：给定元信息 + 每个历史 index 的 firstSeenAt + 窗口谓词，输出过滤计划。
 * 返回 { keep:number[], hideGroups:{indexes:number[]}[], tailIndex:number|null }
 */
export function decideFilterPlan(meta, {
  firstSeenAtOf,       // (metaItem) => number|null
  hiddenAt,            // (timeMs) => boolean    —— 该时间点此刻是否落在不可读断片窗口
  tailIndex            // 当前轮消息的 index（本轮放行）
}) {
  const keep = [];
  const hideGroups = [];
  const byIndex = new Map(meta.map((m) => [m.index, m]));

  function groupEnd(start) {
    // assistant(tool_calls) 起，把其后**连续**的 tool-result 段并入同一组，
    // 直到出现非 tool 消息。保证不留孤立 tool result；与具体 id 字段解耦。
    let end = start;
    for (let i = start + 1; i < meta.length; i += 1) {
      const item = byIndex.get(i);
      if (!item || item.role !== 'tool') break;
      end = i;
    }
    return end;
  }

  const handled = new Set();
  for (const item of meta) {
    if (handled.has(item.index)) continue;

    // 当前轮消息：本轮放行（7.1）
    if (item.index === tailIndex) {
      keep.push(item.index);
      handled.add(item.index);
      continue;
    }

    // 系统/开发指令：永不因醉酒删除
    if (SYSTEM_SOFT.has(item.role)) {
      keep.push(item.index);
      handled.add(item.index);
      continue;
    }

    const seenAt = firstSeenAtOf(item);
    // 未见过的历史（网关之前没登记，如外部导入）：无法证明在窗口内 → 放行（fail-open）
    if (seenAt == null) {
      keep.push(item.index);
      handled.add(item.index);
      continue;
    }
    const inWindow = hiddenAt(seenAt);

    if (item.hasToolCalls && item.role === 'assistant') {
      const end = groupEnd(item.index);
      for (let i = item.index; i <= end; i += 1) handled.add(i);
      // 当前 tool result 是本轮模型尚未见过的新输入。若 tail 落在这个工具组里，
      // 整组都必须放行；只保护 tail 会留下孤立 tool result，只按历史时间隐藏
      // 整组又会把刚发生的吐/宕机等客观事件在模型看见前删除。
      const containsTail = tailIndex >= item.index && tailIndex <= end;
      if (inWindow && !containsTail) hideGroups.push({ indexes: Array.from({ length: end - item.index + 1 }, (_, k) => item.index + k) });
      else {
        for (let i = item.index; i <= end; i += 1) keep.push(i);
      }
      continue;
    }
    if (item.role === 'tool') {
      // 孤立 tool result：其 assistant 组要么已整体保留、要么已整体隐藏；
      // 走到这里说明前面没有对应 assistant 组，保守放行以避免破坏工具链。
      keep.push(item.index);
      handled.add(item.index);
      continue;
    }

    if (inWindow) hideGroups.push({ indexes: [item.index] });
    else keep.push(item.index);
    handled.add(item.index);
  }

  keep.sort((a, b) => a - b);
  return { keep, hideGroups, tailIndex };
}

/**
 * 判定某个时间点此刻是否落在「不可读且未到恢复点」的窗口里。
 * batches 直接来自 engine.state.fragmentBatches（已由 engine.settle 刷新 readable）。
 */
export function hiddenAtForBatches(batches, now) {
  return function hiddenAt(timeMs) {
    const t = Number(timeMs);
    if (!Number.isFinite(t)) return false;
    for (const batch of batches || []) {
      if (batch.readable === true) continue;
      if (now >= Number(batch.restoreAt)) continue;
      const hiddenFrom = Number(batch.hiddenFrom ?? batch.start ?? 0);
      const end = batch.end == null ? Infinity : Number(batch.end);
      if (t >= hiddenFrom && t <= end) return true;
    }
    return false;
  };
}

/**
 * 稳定 fragment 归属：某消息时间是否属于某个断片片段（含已到恢复点/已 readable 的历史片段）。
 * 一旦消息曾进入片段，之后**绝不原位回填**——恢复只以追加形式给出（用户设计 §5）。
 * 返回所属 batch 或 null。时间边界固定：读状态不滑动任何 fragment。
 */
export function fragmentMemberOf(batches, timeMs) {
  const t = Number(timeMs);
  if (!Number.isFinite(t)) return null;
  for (const batch of batches || []) {
    const hiddenFrom = Number(batch.hiddenFrom ?? batch.start ?? 0);
    const end = batch.end == null ? Infinity : Number(batch.end);
    if (t >= hiddenFrom && t <= end && t < Number(batch.restoreAt)) return batch;
  }
  return null;
}

/** 判定某 batch 当前是否可恢复（自然到点 readable、或关闭断片/reset 强制解除）。 */
export function batchRecoverable(batch, now) {
  if (!batch) return false;
  if (batch.readable === true) return true;
  return Number.isFinite(Number(batch.restoreAt)) && now >= Number(batch.restoreAt);
}

function batchKey(batch) {
  return batch?.id || `frag:${batch?.hiddenFrom ?? batch?.start ?? 0}:${batch?.end ?? 'open'}`;
}

// ---------------- 恢复源选择（本单核心） ----------------
//
// 用户设计：恢复必须区分两种情况，不得一律降级。
//
//   情况 A｜原始 hidden transcript 仍然存在
//     fragment 曾被网关遮蔽，但原始 conversation history 尚未被 compression /
//     context compaction 删除 → 从仍然存在的 raw transcript 中取回被遮蔽片段，
//     作为 [Proof 恢复片段] 追加到当前 context 尾部。「忘记了一段，后来真正想起来。」
//
//   情况 B｜原 transcript 已经不存在
//     例如断片期间发生 compression（blackout filtering 已先跑，hidden fragment
//     没进 summary），旧 raw transcript 被压掉 → 不得伪造逐字原文，
//     退化为 Proof records / blackoutDigest / drinkEvents 的低分辨率事实。
//     「忘记了一段，后来只想起来一点。」
//
// 优先级固定：1) 原始 hidden transcript  2) Proof records / digest  3) 不做任何正文持久化。
// 原文存在 ≠ 一定全部恢复：raw transcript 只是**候选数据源**，
// 可恢复范围仍由 Proof 的恢复可见度（resolution / ratio / stages）决定，Gateway 不自行扩权。

/** 把 provider content（字符串 / 多模态块数组 / 对象）渲染成可恢复文本。 */
export function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part == null) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    try { return JSON.stringify(content); } catch { return String(content); }
  }
  return String(content);
}

/**
 * 从**本次 raw candidate history** 中挑出属于该 fragment 的原始消息。
 *
 * 判定只用稳定 fragment identity / 时间边界：
 *   fragment 身份（fragmentBatches 的 id + [hiddenFrom..end] 窗口）
 *   + 账本登记的 firstSeenAt 落入该窗口
 *   + 归属谓词 fragmentMemberOf 命中同一 batch 对象
 * 不使用文本模糊匹配、不靠模型猜测、不由 Proof records 反推原文。
 */
export function fragmentCandidates({ meta = [], timeByIdx, batches, batch, tailIndex }) {
  const out = [];
  for (const item of meta) {
    if (item.index === tailIndex) continue;
    if (SYSTEM_SOFT.has(item.role)) continue;
    const t = timeByIdx?.get(item.index);
    if (t == null) continue;
    if (fragmentMemberOf(batches, t) !== batch) continue;
    out.push(item);
  }
  return out;
}

/** 按 Proof 可见度裁剪候选：facts 一律不给原文；partial 按比例取前缀；full 全给。 */
export function sliceForVisibility(items, visibility) {
  if (!recoveryAllowsVerbatim(visibility)) return [];
  if (visibility.resolution === 'full') return items;
  const ratio = Number(visibility.ratio);
  const n = Math.max(0, Math.min(items.length, Math.round(items.length * ratio)));
  return items.slice(0, n);
}

/** 渐进恢复：把允许范围按 stages 等分，取第 stage 段（1-based）。stages=1 时整段给。 */
export function stageSlice(items, visibility, stage) {
  const total = Math.max(1, Math.floor(Number(visibility?.stages) || 1));
  if (total === 1) return items;
  const size = Math.ceil(items.length / total);
  const start = (Math.max(1, Math.floor(Number(stage) || 1)) - 1) * size;
  return items.slice(start, start + size);
}

/** 该 stage 此刻实际可用的原文候选（先按可见度裁剪，再按 stage 分段）。 */
export function recoveryCandidatesFor(candidates, visibility, stage) {
  return stageSlice(sliceForVisibility(candidates, visibility), visibility, stage);
}

/**
 * 恢复源选择。只回答「raw 还是 proof」，不回答「恢复多少」（那由 Proof 可见度决定）。
 */
export function selectRecoverySource({ candidates = [], visibility }) {
  if (!recoveryAllowsVerbatim(visibility)) return 'proof';
  return candidates.length > 0 ? 'raw' : 'proof';
}

/**
 * 情况 A 渲染：从仍然存在的 raw transcript 恢复。
 *
 * 仍然是尾部追加块，不原位插回、不伪装成新的 user/assistant 消息、不改动历史 transcript。
 */
export function recoveryTextFromRaw(batch, items, { contentOf, visibility } = {}) {
  const lines = [
    GATEWAY_RECOVERY_LABEL,
    '那段暂时失去联系的记忆回来了。以下是当时真实发生过的内容（按 Proof 允许的范围恢复）：'
  ];
  for (const item of items) {
    const content = contentOf ? contentOf(item.raw) : item.raw?.content;
    const text = contentToText(content).trim();
    if (!text) continue;
    lines.push(`- ${item.role}：${text}`);
  }
  if (lines.length === 2) {
    lines.push('- 那段时间发生过一些事，但当时没有留下可以想起来的话。');
  }
  if (visibility?.resolution === 'partial') {
    lines.push('- 只想起了一部分。');
  }
  return lines.join('\n');
}

/** 该 fragment 在 Proof 侧是否留有可引用的低分辨率事实。 */
export function hasProofEvidence(state, batch) {
  const lo = Number(batch?.hiddenFrom ?? batch?.start ?? 0);
  const hi = batch?.end == null ? Number.MAX_SAFE_INTEGER : Number(batch?.end);
  const inRange = (t) => Number(t || 0) >= lo && Number(t || 0) <= hi;
  const s = state || {};
  const cups = (s.drinkEvents || []).filter((ev) => inRange(ev.consumedAt)).length;
  const sips = (s.records || []).filter((r) => r.type === '喝下' && inRange(r.time)).length;
  return cups > 0 || sips > 0;
}

/**
 * 情况 B 渲染：退化为 Proof 已保留的低分辨率事实（records / drinkEvents / digest）。
 * 不猜原文、不拼 surrounding turns、不调 LLM 重建、不用 hash 反推。
 */
export function recoveryTextFromProof(state, batch) {
  const lo = Number(batch?.hiddenFrom ?? batch?.start ?? 0);
  const hi = batch?.end == null ? Number.MAX_SAFE_INTEGER : Number(batch?.end);
  const inRange = (t) => Number(t || 0) >= lo && Number(t || 0) <= hi;
  const s = state || {};
  const cups = (s.drinkEvents || []).filter((ev) => inRange(ev.consumedAt)).length;
  const sips = (s.records || []).filter((r) => r.type === '喝下' && inRange(r.time)).length;
  const lines = [GATEWAY_RECOVERY_LABEL, '那段暂时失去联系的记忆开始回来一些（原始内容已不在，只能想起 Proof 记下的事实）：'];
  if (cups > 0) lines.push(`- 期间喝下了 ${cups} 杯（共 ${sips} 次入口）。`);
  else if (sips > 0) lines.push(`- 期间发生了 ${sips} 次饮用入口。`);
  else lines.push('- 那段时间发生过一些事，细节已不再逐字可查。');
  return lines.join('\n');
}

/** 稳定的批次顺序：restoreAt → hiddenFrom → 数组原始次序。 */
export function orderRecoverableBatches(batches, now) {
  return (batches || [])
    .map((batch, index) => ({ batch, index }))
    .filter(({ batch }) => batchRecoverable(batch, now))
    .sort((x, y) => (
      Number(x.batch.restoreAt ?? 0) - Number(y.batch.restoreAt ?? 0)
      || Number(x.batch.hiddenFrom ?? x.batch.start ?? 0) - Number(y.batch.hiddenFrom ?? y.batch.start ?? 0)
      || x.index - y.index
    ))
    .map(({ batch }) => batch);
}

/**
 * 账本 firstSeenAt 查找器：按 (role, contentHash, occurrenceIndex=历史内同文先序) 查询。
 * miss 返回 null（放行）。
 */
export function makeLedgerLookup(ledger, agentId, conversationId) {
  return async function firstSeenAtOf(item, priorSame) {
    const hit = await ledger.lookup(agentId, conversationId, {
      role: item.role,
      contentHash: item.contentHash,
      occurrenceIndex: priorSame
    });
    return hit ? Number(hit.firstSeenAt) : null;
  };
}

/**
 * 计算「历史内同文先序」：该 index 之前相同 (role, contentHash) 的出现次数。
 * 与账本登记时按相同规则计 occurrence，保证重提历史能命中同一登记。
 */
export function occurrencePriorTo(meta, item) {
  let count = 0;
  for (const other of meta) {
    if (other.index >= item.index) break;
    if (other.role === item.role && other.contentHash === item.contentHash) count += 1;
  }
  return count;
}

/**
 * 网关变换主入口（async）。返回计划与投影；不落正文。
 *
 * messages: provider 原始数组；必须提供归一化提取函数。
 * roleOf/contentOf/toolCallIdOf/toolCallsOf: 缺省兼容 {role,content,tool_call_id|toolCallId,tool_calls|toolCalls}
 */
export async function transformGatewayRequest({
  engine,
  agentId,
  now,
  messages = [],
  conversationId = null,
  ledger = null,
  requestId = null,
  status = null,             // 可选：已算好的 buildAgentTurnContext；缺省自动算
  roleOf, contentOf, toolCallIdOf, toolCallsOf
} = {}) {
  const conv = assertConversationId(conversationId);
  engine?.settle?.(now);

  // 唯一权威投影（不复制任何状态计算）
  const ctx = status || (engine ? buildAgentTurnContext(engine, agentId, now) : {});

  const meta = toMetaList(messages, { roleOf, contentOf, toolCallIdOf, toolCallsOf });
  // 当前尾部 = 最后一条消息（本轮放行）
  const tailIndex = meta.length ? meta[meta.length - 1].index : null;

  // 登记当前尾部（firstSeenAt=now；重试同一 requestId 不重复登记）
  let registered = null;
  if (ledger && tailIndex != null) {
    const tail = meta[tailIndex];
    registered = await ledger.register(agentId, conv, {
      role: tail.role,
      content: tail.raw != null && contentOf ? contentOf(tail.raw) : tail.raw?.content ?? '',
      at: now,
      requestId,
      provider: null
    });
  }

  const batches = engine?.state?.fragmentBatches || [];
  const firstSeenAtOf = async (item) => {
    if (!ledger) return null;
    const hit = await ledger.lookup(agentId, conv, {
      role: item.role,
      contentHash: item.contentHash,
      occurrenceIndex: occurrencePriorTo(meta, item)
    });
    return hit ? Number(hit.firstSeenAt) : null;
  };

  // 遮蔽谓词 = 活跃窗口（readable=false 且未到 restoreAt）∪ 历史片段归属（稳定，防止原位回填）
  const maskAt = (timeMs) => {
    const t = Number(timeMs);
    if (!Number.isFinite(t)) return false;
    if (fragmentMemberOf(batches, t)) return true;
    return false;
  };

  // 历史消息（除 tail 外全部）逐个取时间（并行安全：账本读不写）
  const timeByIdx = new Map();
  for (const item of meta) {
    if (item.index === tailIndex) continue;
    if (SYSTEM_SOFT.has(item.role)) continue;
    timeByIdx.set(item.index, await firstSeenAtOf(item));
  }

  const plan = decideFilterPlan(meta, {
    firstSeenAtOf: (item) => timeByIdx.get(item.index) ?? null,
    hiddenAt: maskAt,
    tailIndex
  });

  // —— 渐进恢复（append-only）+ 恢复源选择 ——
  //
  // 每个可恢复 fragment 的每个 stage 只发射一次，按 (agent, conversation, fragmentId, stage) 幂等。
  // 内容**不落账本**：账本只记标记，正文每轮从权威源重新渲染：
  //   · 标记 source='raw' 且原始候选仍在本次 raw history 中 → 逐字恢复（受 Proof 可见度裁剪）
  //   · 原始候选已不在（被 compression/compaction 移除）→ 退化为 Proof records/digest 事实
  //   · Proof 可见度 = facts（硬断片）→ 即使原文仍在也只给事实
  // 每个批每轮最多推进一个未发射 stage，保证渐进追加、旧块不被改写。
  const recoveryBlocks = [];
  let newlyAppended = 0;
  if (ledger) {
    const markers = await ledger.recoveries(agentId, conv);
    const markerByKey = new Map(markers.map((m) => [m.key, m]));

    for (const batch of orderRecoverableBatches(batches, now)) {
      const visibility = resolveRecoveryVisibility(batch);
      const fid = batchKey(batch);
      const candidates = fragmentCandidates({ meta, timeByIdx, batches, batch, tailIndex });
      const evidence = hasProofEvidence(engine?.state, batch);

      for (let stage = 1; stage <= visibility.stages; stage += 1) {
        const key = `${fid}#${stage}`;
        const marker = markerByKey.get(key);
        const items = recoveryCandidatesFor(candidates, visibility, stage);
        const render = (source) => (
          source === 'raw'
            ? recoveryTextFromRaw(batch, items, { contentOf, visibility })
            : recoveryTextFromProof(engine?.state, batch)
        );

        if (marker) {
          // 已发射：按记录源重渲染。源已消失（raw 被压缩掉）则退化为 Proof 事实——
          // 行为约定：原文已经没了，就只能想起 Proof 还留下的东西。
          const source = marker.source === 'raw' && items.length > 0 ? 'raw' : 'proof';
          recoveryBlocks.push({
            key, fragmentId: fid, stage, source, count: source === 'raw' ? items.length : 0,
            text: render(source), degraded: marker.source === 'raw' && source === 'proof'
          });
          continue;
        }

        // 未发射：无可恢复内容且 Proof 无事实 → 不空发
        if (items.length === 0 && !evidence) break;

        const source = selectRecoverySource({ candidates: items, visibility });
        const text = render(source);
        const appended = await ledger.appendRecovery(agentId, conv, {
          key,
          fragmentId: fid,
          stage,
          source,
          at: now,
          count: source === 'raw' ? items.length : 0,
          digest: sha256(text)
        });
        if (appended.appended) {
          markerByKey.set(key, appended.entry);
          recoveryBlocks.push({
            key, fragmentId: fid, stage, source,
            count: source === 'raw' ? items.length : 0,
            text, degraded: false
          });
          newlyAppended += 1;
        }
        break; // 本批本轮只推进一级
      }
    }
  }
  const recoveryText = recoveryBlocks.map((b) => b.text).join('\n\n');

  return {
    agentId,
    conversationId: conv,
    now,
    status: ctx,
    revision: ctx.revision ?? 0,
    injected: Boolean(ctx.block),
    block: ctx.block || null,
    active: ctx.active === true,
    plan,
    tailIndex,
    registered,
    meta,
    recoveryBlocks,
    recoveryStack: recoveryBlocks.map(({ key, fragmentId, stage, source, count }) => ({ key, fragmentId, stage, source, count })),
    recoveryText: recoveryText || null,
    recoveriesAppended: newlyAppended
  };
}

export default {
  transformGatewayRequest,
  decideFilterPlan,
  hiddenAtForBatches,
  fragmentMemberOf,
  batchRecoverable,
  fragmentCandidates,
  sliceForVisibility,
  stageSlice,
  recoveryCandidatesFor,
  selectRecoverySource,
  orderRecoverableBatches,
  hasProofEvidence,
  recoveryTextFromRaw,
  recoveryTextFromProof,
  contentToText,
  placeholderText,
  toMetaList
};
