// Provider 适配层（里程碑 2）。
//
// 原则：不做「最低公分母」。适配器只做三件事：
//   1. 把 provider 原始消息归一成元信息交给共享变换管线（transform.mjs）；
//   2. 按过滤计划从**原始对象**里摘除被隐藏的整组，原位放入各 provider 形状的占位；
//   3. 把注入块放入 provider 的合法位置，并保持原请求前缀尽可能稳定。
//
// 未改写的字段（tools、tool_choice、response_format、stop、temperature、
// 多模态 content、未知扩展字段、provider-managed 标识）一律原样保留在返回 body 里。

import { AGENT_STATE_USE_POLICY } from '../../engine/src/runtime/agentStateUsePolicy.js';
import { transformGatewayRequest } from './transform.mjs';
import { sha256 } from './ledger.mjs';

export { AGENT_STATE_USE_POLICY };

// ---------------- 通用小工具 ----------------

/** 依计划从原始数组**完全移除**被隐藏的整组（真实 context filtering，不回填、不留占位；用户设计 §2/§4）。 */
export function applyPlan(raw, plan) {
  if (!plan?.hideGroups?.length) return [...raw];
  const hidden = new Set();
  for (const group of plan.hideGroups) {
    for (const index of group.indexes) hidden.add(index);
  }
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (!hidden.has(i)) out.push(raw[i]);
  }
  return out;
}

/**
 * Layer 1 · 稳定宿主使用契约。固定正文，不随 stateHints 改写。
 * 只在自动投递动态 [Proof 状态] 时进入宿主前缀；不得塞进状态块或恢复块。
 */
export function composeStableHostPolicy(res) {
  if (!res?.block?.text) return null;
  return AGENT_STATE_USE_POLICY;
}

/**
 * 尾部上下文 = 恢复片段(稳定、append-only) → [Proof 状态]。
 * 两者明确分槽、各自带稳定标签、不混成一段。不含 Layer 1 host policy。
 */
export function composeTail(res) {
  const parts = [];
  if (res?.recoveryText) parts.push(res.recoveryText);
  if (res?.block?.text) parts.push(res.block.text);
  return parts.length ? parts.join('\n\n') : null;
}

/**
 * 宿主层额外正文：稳定 policy（前）+ 动态 tail（后）。
 * policy 字节固定，利于 prompt-cache 前缀；同一 request 只拼一份。
 */
export function composeHostExtra(res) {
  const parts = [];
  const policy = composeStableHostPolicy(res);
  if (policy) parts.push(policy);
  const tail = composeTail(res);
  if (tail) parts.push(tail);
  return parts.length ? parts.join('\n\n') : null;
}

function appendText(target, blockText) {
  if (typeof target === 'string') return `${target}\n${blockText}`;
  if (Array.isArray(target)) return [...target, { type: 'text', text: blockText }];
  return blockText;
}

/** 找到过滤结果里最后一个 system/developer 消息（若它在首个 user 之前）。 */
function lastSystemIndex(messages) {
  let found = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const role = messages[i]?.role;
    if (role === 'system' || role === 'developer') found = i;
    else if (role === 'user' || role === 'assistant' || role === 'tool') break;
  }
  return found;
}

function mergeSystemMessage(messages, blockText) {
  if (!blockText) return messages;
  const out = [...messages];
  const idx = lastSystemIndex(out);
  if (idx >= 0) {
    const target = out[idx];
    if (typeof target.content === 'string' || Array.isArray(target.content)) {
      out[idx] = { ...target, content: appendText(target.content, blockText) };
      return out;
    }
  }
  out.unshift({ role: 'system', content: blockText });
  return out;
}

/**
 * DeepSeek 要求 system 位于对话前缀，不能在多轮历史中间再插 system。动态块
 * 因而追加到当前 user 正文末尾：开头 system 与既有历史保持逐字不变，缓存只在
 * 本轮这个原本就新增的尾部发生 miss。非 user 尾部（如 tool result）则追加一条
 * user 上下文消息，保持 provider 的角色顺序合法。
 */
function appendTailUserContext(messages, blockText) {
  if (!blockText) return messages;
  const out = [...messages];
  const tailIndex = out.length - 1;
  const tail = out[tailIndex];
  if (tail?.role === 'user' && (typeof tail.content === 'string' || Array.isArray(tail.content))) {
    out[tailIndex] = { ...tail, content: appendText(tail.content, blockText) };
  } else {
    out.push({ role: 'user', content: blockText });
  }
  return out;
}

async function replayChatProofContexts(messages, res, ledger, agentId, conversationId) {
  const out = [...messages];
  const replayedHashes = new Set();
  if (!ledger) return { messages: out, replayedHashes };
  for (const item of res.meta || []) {
    if (item.index === res.tailIndex || item.role !== 'user') continue;
    const occurrenceIndex = (res.meta || []).filter((other) => other.index < item.index && other.role === item.role && other.contentHash === item.contentHash).length;
    const saved = await ledger.lookup(agentId, conversationId, { role: item.role, contentHash: item.contentHash, occurrenceIndex });
    if (!saved?.proofContext) continue;
    const at = out.findIndex((message) => message === item.raw);
    if (at >= 0) {
      out[at] = { ...out[at], content: appendText(out[at].content, saved.proofContext) };
      replayedHashes.add(saved.proofContextHash);
    }
  }
  return { messages: out, replayedHashes };
}

export function isTextPartOnly(content) {
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return content.every((part) => part && typeof part === 'object' && (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text'));
}

// ---------------- OpenAI Chat Completions ----------------

export function buildOpenAiChatBody({ engine, agentId, now, body, ledger, conversationId, requestId }) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return transformGatewayRequest({
    engine,
    agentId,
    now,
    messages,
    conversationId,
    ledger,
    requestId,
    roleOf: (m) => m.role,
    contentOf: (m) => m.content,
    toolCallIdOf: (m) => m.tool_call_id ?? null,
    toolCallsOf: (m) => m.tool_calls ?? null
  }).then(async (res) => {
    const replay = await replayChatProofContexts(applyPlan(messages, res.plan), res, ledger, agentId, conversationId);
    const filtered = replay.messages;
    let extra = composeHostExtra(res);
    const latest = await ledger?.latestProofContext?.(agentId, conversationId);
    if (!extra && latest?.proofContextHash && !latest.proofContext.includes('先前的 Proof 状态已经解除')) {
      extra = '[Proof 状态更新]\n先前的 Proof 状态已经解除。';
    }
    if (extra && latest?.proofContextHash === sha256(extra) && replay.replayedHashes.has(latest.proofContextHash)) extra = null;
    if (extra && res.registered?.entry?.requestId) {
      await ledger.setProofContext(agentId, conversationId, res.registered.entry.requestId, extra);
    }
    const out = { ...body, messages: appendTailUserContext(filtered, extra) };
    return { body: out, res };
  });
}

// ---------------- OpenAI Responses ----------------

function responsesItems(body) {
  if (Array.isArray(body?.input)) return body.input;
  if (typeof body?.input === 'string') {
    return [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }];
  }
  return [];
}

function responsesMeta(item) {
  const type = item?.type;
  if (type === 'function_call') {
    return { role: 'assistant', hasToolCalls: true, toolCallId: item.call_id ?? null, toolCalls: [item] };
  }
  if (type === 'function_call_output') {
    return { role: 'tool', hasToolCalls: false, toolCallId: item.call_id ?? null, toolCalls: null };
  }
  if (type === 'message') {
    return { role: item.role ?? 'user', hasToolCalls: false, toolCallId: null, toolCalls: null };
  }
  // 未知/未来类型：不进过滤决策，直接透传（保守）
  return { role: 'unknown', hasToolCalls: false, toolCallId: null, toolCalls: null };
}

export function buildOpenAiResponsesBody({ engine, agentId, now, body, ledger, conversationId, requestId }) {
  const items = responsesItems(body);
  return transformGatewayRequest({
    engine,
    agentId,
    now,
    messages: items,
    conversationId,
    ledger,
    requestId,
    roleOf: (item) => responsesMeta(item).role,
    contentOf: (item) => item.content ?? item.arguments ?? item.output ?? '',
    toolCallIdOf: (item) => responsesMeta(item).toolCallId,
    toolCallsOf: (item) => (responsesMeta(item).hasToolCalls ? [item] : null)
  }).then((res) => {
    const filtered = applyPlan(items, res.plan);
    const out = { ...body };
    out.input = filtered;
    const extra = composeHostExtra(res);
    if (extra) {
      if (typeof body.instructions === 'string') out.instructions = appendText(body.instructions, extra);
      else if (Array.isArray(body.instructions)) out.instructions = appendText(body.instructions, extra);
      else out.instructions = extra;
    }
    return { body: out, res };
  });
}

export function openAiResponsesManaged(body) {
  return body?.previous_response_id != null;
}

// ---------------- Anthropic Messages ----------------

function anthropicContentIsToolResult(content) {
  return Array.isArray(content) && content.length > 0 && content.every((part) => part?.type === 'tool_result');
}

function anthropicToolIds(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part?.type === 'tool_use').map((part) => part.id);
}

function anthropicRoleOf(message) {
  if (message?.role === 'assistant') return 'assistant';
  if (message?.role === 'user' && anthropicContentIsToolResult(message.content)) return 'tool';
  return message?.role ?? 'unknown';
}

export function buildAnthropicBody({ engine, agentId, now, body, ledger, conversationId, requestId }) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return transformGatewayRequest({
    engine,
    agentId,
    now,
    messages,
    conversationId,
    ledger,
    requestId,
    roleOf: anthropicRoleOf,
    contentOf: (m) => m.content,
    toolCallIdOf: (m) => {
      if (!Array.isArray(m.content)) return null;
      const hit = m.content.find((part) => part?.type === 'tool_result');
      return hit?.tool_use_id ?? null;
    },
    toolCallsOf: (m) => (m.role === 'assistant' ? anthropicToolIds(m.content) : null)
  }).then((res) => {
    // 完全移除隐藏组（真实遮蔽）。Anthropic 交替结构依赖被移除的整段 message 自身分组已整体处理。
    const filtered = applyPlan(messages, res.plan);
    const out = { ...body };
    out.messages = filtered;
    const extra = composeHostExtra(res);
    if (extra) {
      if (typeof body.system === 'string') out.system = appendText(body.system, extra);
      else if (Array.isArray(body.system)) out.system = appendText(body.system, extra);
      else out.system = extra;
    }
    return { body: out, res };
  });
}

export { appendText, lastSystemIndex, appendTailUserContext };
export default {
  applyPlan,
  composeTail,
  composeStableHostPolicy,
  composeHostExtra,
  buildOpenAiChatBody,
  buildOpenAiResponsesBody,
  buildAnthropicBody,
  openAiResponsesManaged
};
