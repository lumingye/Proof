// 模型代理（里程碑 3）。
//
// - 固定 allowlist 上游（upstream.mjs），客户端不可指定 base_url（防 SSRF）；
// - 转发前剥离 Proof 鉴权头，加入服务端上游密钥；
// - 不缓冲流式响应：SSE 分块直通，只在旁路累计文本用于结束后登记账本；
// - 客户端断开即取消上游（AbortController）；
// - 不跟随上游重定向（redirect:'manual'，避免绕过 allowlist）；
// - 上游状态码/响应头透传；日志与错误一律脱敏，不落 key/正文。

import { resolveUpstreamConfig } from './upstream.mjs';

export const PROOF_GATEWAY_KEY_HEADER = 'x-proof-gateway-key';
// 禁止转发给上游的请求头（大小写不敏感）
const STRIPPED_HEADERS = new Set([
  'authorization',
  'x-api-key',
  PROOF_GATEWAY_KEY_HEADER,
  'x-proof-gateway-key',
  'cookie',
  'host',
  'content-length',
  'transfer-encoding',
  'connection'
]);
// 只透传给上游的客户端头白名单（其余客户端头不转发）
const PASSTHROUGH_HEADERS = new Set([
  'content-type',
  'accept',
  'anthropic-version',
  'anthropic-beta',
  'openai-organization',
  'openai-project',
  'user-agent',
  'accept-encoding'
]);

export function redact(text) {
  return String(text == null ? '' : text)
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1…')
    .replace(/("api[_-]?key"\s*[:=]\s*")[^",\s}]+/gi, '$1…')
    .replace(/(x-api-key\s*[:=]\s*)[^\s,;]+/gi, '$1…');
}

export function buildOutboundHeaders({ headers = {}, upstream }) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = String(name).toLowerCase();
    if (STRIPPED_HEADERS.has(lower)) continue;
    if (!PASSTHROUGH_HEADERS.has(lower)) continue;
    out[name] = value;
  }
  const auth = upstream.auth;
  if (upstream.apiKey) {
    if (auth.header === 'authorization') out.authorization = `Bearer ${upstream.apiKey}`;
    else out[auth.header] = upstream.apiKey;
  }
  return out;
}

export function createModelProxy({ upstreams, onRegisterAssistant, timeoutMs = 120_000 } = {}) {
  const cfg = upstreams || resolveUpstreamConfig(process.env);

  function endpoint(kind, suffix) {
    const target = cfg[kind];
    if (!target) throw new Error(`upstream_not_configured:${kind}`);
    return `${target.baseUrl}${suffix}`;
  }

  /**
   * 转发 JSON 请求，返回未消费的 Response（供调用方决定流式/非流式）。
   */
  async function forward({ kind, suffix, headers, body, clientSignal, signalReason }) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signalReason || 'client_disconnected');
    if (clientSignal) {
      if (clientSignal.aborted) return { aborted: true };
      clientSignal.addEventListener('abort', onAbort, { once: true });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort('upstream_timeout');
    }, timeoutMs);
    const upstreamHeaders = buildOutboundHeaders({ headers, upstream: cfg[kind] });
    try {
      const response = await fetch(endpoint(kind, suffix), {
        method: 'POST',
        headers: upstreamHeaders,
        body,
        signal: controller.signal,
        redirect: 'manual' // 不跟随重定向：每跳重新校验在 V1 不支持，直接禁止
      });
      return { response, controller, timeout: timer, cleanup: () => {
        clearTimeout(timer);
        clientSignal?.removeEventListener('abort', onAbort);
      } };
    } catch (error) {
      clearTimeout(timer);
      clientSignal?.removeEventListener('abort', onAbort);
      if (timedOut) return { aborted: true, timedOut: true, error: 'upstream_timeout' };
      if (error?.name === 'AbortError' || error?.cause?.name === 'AbortError' || /abort/i.test(String(error?.message || ''))) {
        return { aborted: true, timedOut: false, error: error.message };
      }
      return { error };
    }
  }

  /** SSE 行解析：从响应体流中按块切行（不做完整缓冲）。 */
  async function pipeStream(res, response, { onDataEvent, signal, cleanup }) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let ok = true;
    const done = (code) => { ok = code; };
    try {
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload) onDataEvent?.(payload);
          }
        }
        res.write(value); // 原样增量转发（字节保序）
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          if (line.startsWith('data:') && line.slice(5).trim()) onDataEvent?.(line.slice(5).trim());
        }
        res.write(buffer);
      }
    } catch (error) {
      ok = false;
      throw error;
    } finally {
      cleanup?.();
    }
    return ok;
  }

  return { forward, pipeStream, endpoint, cfg };
}

export default { createModelProxy, buildOutboundHeaders, redact, PROOF_GATEWAY_KEY_HEADER };
