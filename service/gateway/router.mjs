// 网关编排层（里程碑 4）。纯函数/装配：不直接依赖 server.mjs。

import { createModelProxy, redact } from './proxy.mjs';
import { resolveUpstreamConfig } from './upstream.mjs';
import { buildOpenAiChatBody, buildOpenAiResponsesBody, buildAnthropicBody, openAiResponsesManaged } from './adapters.mjs';
import { assertConversationId } from './ledger.mjs';

export const MAX_BODY_DEFAULT = 2 * 1024 * 1024;

export const ROUTES = {
  '/v1/chat/completions': { name: 'openaiChat', kind: 'openai', suffix: '/chat/completions', build: buildOpenAiChatBody },
  '/v1/responses': { name: 'openaiResponses', kind: 'openai', suffix: '/responses', build: buildOpenAiResponsesBody, managed: openAiResponsesManaged },
  '/v1/messages': { name: 'anthropic', kind: 'anthropic', suffix: '/messages', build: buildAnthropicBody }
};

/** 每个 provider 一种流事件累加器（旁路登记用，不阻塞转发）。 */
export function createStreamAccumulator(routeName) {
  const text = { value: '' };
  let completed = false;
  const feed = (payload) => {
    if (payload === '[DONE]') {
      completed = true;
      return;
    }
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    if (routeName === 'anthropic') {
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') {
        text.value += data.delta.text;
      } else if (data.type === 'message_stop') {
        completed = true;
      }
      return;
    }
    if (routeName === 'openaiResponses') {
      if (data.type === 'response.output_text.delta' && typeof data.delta === 'string') text.value += data.delta;
      else if (data.type === 'response.completed') completed = true;
      return;
    }
    // openaiChat
    if (Array.isArray(data.choices)) {
      for (const choice of data.choices) {
        if (typeof choice.delta?.content === 'string') text.value += choice.delta.content;
      }
      if (data.choices[0]?.finish_reason) completed = true;
    }
  };
  return {
    feed,
    text: () => text.value,
    isComplete: () => completed,
    markComplete: () => { completed = true; }
  };
}

export function buildGateway({
  getEngine,
  dataDir,
  env = process.env,
  now = () => Date.now(),
  maxBodyBytes,
  timeoutMs,
  maxConcurrent
} = {}) {
  if (typeof getEngine !== 'function') throw new Error('gateway_get_engine_required');
  const upstreams = resolveUpstreamConfig(env);
  const bodyLimit = Number.isFinite(Number(maxBodyBytes))
    ? Number(maxBodyBytes)
    : positiveInt(env.PROOF_GATEWAY_MAX_BODY_BYTES, MAX_BODY_DEFAULT, 'PROOF_GATEWAY_MAX_BODY_BYTES');
  const upstreamTimeout = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : positiveInt(env.PROOF_GATEWAY_UPSTREAM_TIMEOUT_MS, 120_000, 'PROOF_GATEWAY_UPSTREAM_TIMEOUT_MS');
  const concurrentLimit = Number.isFinite(Number(maxConcurrent))
    ? Number(maxConcurrent)
    : positiveInt(env.PROOF_GATEWAY_MAX_CONCURRENT, 16, 'PROOF_GATEWAY_MAX_CONCURRENT');
  const proxy = createModelProxy({ upstreams, timeoutMs: upstreamTimeout });
  const enabled = env.PROOF_GATEWAY_ENABLED === '1';

  // 并发上限：不排队，超过直接失败关闭（安全默认 16）。
  const concurrency = {
    active: 0,
    limit: concurrentLimit,
    tryAcquire() {
      if (this.active >= this.limit) return false;
      this.active += 1;
      return true;
    },
    release() {
      this.active = Math.max(0, this.active - 1);
    }
  };

  function resolveRequestContext({ agentId, conversationId, requestId }) {
    const conv = assertConversationId(conversationId);
    const rid = String(requestId || `${agentId}:${conv}:${now()}:${Math.random().toString(36).slice(2, 8)}`);
    return { agentId, conversationId: conv, requestId: rid, now: now() };
  }

  return {
    upstreams,
    proxy,
    enabled,
    ROUTES,
    resolveRequestContext,
    maxBodyBytes: bodyLimit,
    timeoutMs: upstreamTimeout,
    concurrency,
    now,
    engineFor: getEngine,
    env
  };
}

function positiveInt(raw, fallback, name) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} 必须是大于 0 的整数`);
  return Math.floor(n);
}

export { redact, assertConversationId };
export default { buildGateway, createStreamAccumulator, ROUTES, MAX_BODY_DEFAULT };
