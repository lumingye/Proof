// /v1 模型端点编排（里程碑 4/5）。在 server.mjs 里每个匹配路由调一次。

import { PROOF_GATEWAY_KEY_HEADER, redact } from './proxy.mjs';
import { createStreamAccumulator, assertConversationId } from './router.mjs';

// undici fetch 会自动解压 gzip/br/deflate 响应；此时正文已是明文，原来的
// content-encoding/content-length 都必须剥掉，否则客户端会二次解压而损坏 JSON。
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer']);

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400 });
  }
}

function blackoutNow(engine, now) {
  if (!engine) return false;
  return (engine.state?.fragmentBatches || []).some((b) => b.readable !== true && now < Number(b.restoreAt));
}

function stripHopByHop(source) {
  const out = {};
  if (!source) return out;
  // undici Headers 是可迭代对象，不是普通对象：必须走 entries()，不能用 Object.entries。
  const entries = typeof source.entries === 'function' ? source.entries() : Object.entries(source);
  for (const [name, value] of entries) {
    const key = String(name);
    if (!HOP_BY_HOP.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

async function registerAssistantText(ledger, agentId, conversationId, requestId, provider, text) {
  if (!text) return null;
  return ledger.register(agentId, conversationId, {
    role: 'assistant',
    content: text,
    at: Date.now(),
    provider,
    requestId: `${requestId}#assistant`
  }).catch(() => null);
}

/**
 * 处理一次模型请求。
 * @returns {Promise<void>} 直接写 res。
 */
export async function handleModelEndpoint({ gateway, req, res, pathname, agentId }) {
  if (!gateway.enabled) return writeJson(res, 404, { ok: false, error: 'gateway_disabled' });
  const route = gateway.ROUTES[pathname];
  if (!route) return writeJson(res, 404, { ok: false, error: 'not_found' });

  let payload;
  try {
    payload = await readBody(req, gateway.maxBodyBytes);
  } catch (error) {
    return writeJson(res, error.status || 400, { ok: false, error: error.message });
  }

  const now = gateway.now();
  const engine = gateway.engineFor ? gateway.engineFor(agentId) : null;
  const conversationId = assertConversationId(req.headers['x-proof-conversation-id']);
  const rid = `${agentId}:${conversationId}:${now}:${Math.random().toString(36).slice(2, 8)}`;

  // provider-managed 上下文（previous_response_id）：黑out 活跃且未显式软降级 → 拒绝
  const managed = route.managed?.(payload) === true;
  if (managed && blackoutNow(engine, now) && process.env.PROOF_GATEWAY_ALLOW_SOFT_BLACKOUT !== '1') {
    return writeJson(res, 422, {
      ok: false,
      error: 'hard_blackout_requires_full_context',
      code: 'hard_blackout_requires_full_context',
      message: 'provider-managed continuation cannot be filtered; resend the full context or enable soft blackout explicitly.'
    });
  }

  let built;
  try {
    built = await route.build({
      engine,
      agentId,
      now,
      body: payload,
      ledger: gateway.ledger,
      conversationId,
      requestId: `${rid}#user`
    });
  } catch (error) {
    return writeJson(res, 400, { ok: false, error: redact(String(error?.message || error)) });
  }

  // 尾部登记只在请求真正进入上游后保留；失败/拒绝时收回，避免污染账本（规则：被拒请求不污染）。
  const forgetTail = () => gateway.ledger.removeByRequestId(agentId, conversationId, `${rid}#user`).catch(() => 0);

  const bodyText = JSON.stringify(built.body);
  const clientAbort = new AbortController();
  const onClientClose = () => clientAbort.abort('client_disconnected');
  res.on('close', onClientClose);

  const forwarded = await gateway.proxy.forward({
    kind: route.kind,
    suffix: route.suffix,
    headers: req.headers,
    body: bodyText,
    clientSignal: clientAbort.signal,
    signalReason: 'client_disconnected'
  });

  if (forwarded.aborted) {
    res.removeListener('close', onClientClose);
    await forgetTail();
    if (!res.writableEnded) {
      writeJson(res, forwarded.timedOut ? 504 : 499, {
        ok: false,
        error: forwarded.timedOut ? 'upstream_timeout' : 'client_closed_request'
      });
    }
    return;
  }
  if (forwarded.error) {
    res.removeListener('close', onClientClose);
    await forgetTail();
    return writeJson(res, 502, { ok: false, error: 'upstream_unavailable' });
  }
  const upstream = forwarded.response;

  // 上游重定向一律拒绝（不跟随、也不把 3xx 当正常响应透给客户端当“成功”）。
  if (upstream.status >= 300 && upstream.status < 400) {
    res.removeListener('close', onClientClose);
    upstream.body?.cancel?.().catch?.(() => {});
    forwarded.cleanup?.();
    await forgetTail();
    return writeJson(res, 502, { ok: false, error: 'upstream_redirect_forbidden' });
  }

  const isStream = payload.stream === true || payload.stream === 'true';
  if (!isStream) {
    const upstreamText = await upstream.text();
    res.removeListener('close', onClientClose);
    forwarded.cleanup?.();
    const headers = stripHopByHop(upstream.headers);
    res.writeHead(upstream.status, headers);
    if (upstream.status >= 200 && upstream.status < 300) {
      let assistant = '';
      try {
        const parsed = JSON.parse(upstreamText);
        if (route.name === 'anthropic') assistant = parsed?.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') || '';
        else if (route.name === 'openaiResponses') {
          assistant = (parsed?.output || []).filter((i) => i.type === 'message').flatMap((i) => i.content || []).filter((b) => b.type === 'output_text').map((b) => b.text).join('');
        } else assistant = parsed?.choices?.[0]?.message?.content ?? '';
      } catch {
        // 保留透传原文
      }
      await registerAssistantText(gateway.ledger, agentId, conversationId, rid, route.kind, assistant);
    } else {
      // 上游 4xx/5xx：收回尾部登记
      await forgetTail();
    }
    res.end(upstreamText);
    return;
  }

  // SSE：不缓冲，边读边写；旁路喂累加器，结束且完整才登记 assistant。
  const accumulator = createStreamAccumulator(route.name);
  res.writeHead(upstream.status, stripHopByHop(upstream.headers));
  let ok = true;
  try {
    await gateway.proxy.pipeStream(res, upstream, {
      onDataEvent: (data) => accumulator.feed(data),
      signal: clientAbort.signal,
      cleanup: () => {
        forwarded.cleanup?.();
        res.removeListener('close', onClientClose);
      }
    });
  } catch {
    ok = false;
  } finally {
    if (!ok) {
      await forgetTail();
      return;
    }
    // 正常结束但流不完整（未收到终止事件）——不登记半截 assistant，也不留污染尾部
    if (!accumulator.isComplete()) await forgetTail();
    else await registerAssistantText(gateway.ledger, agentId, conversationId, rid, route.kind, accumulator.text());
    if (!res.writableEnded) res.end();
  }
}

export { writeJson, readBody, blackoutNow, redact, PROOF_GATEWAY_KEY_HEADER };
export default { handleModelEndpoint };
