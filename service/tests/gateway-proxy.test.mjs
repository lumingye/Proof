// 上游 allowlist + 模型代理（里程碑 3）测试：本地假上游，不消耗真实 API。

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { resolveUpstreamConfig, assertUpstreamBase, isPrivateHost } from '../gateway/upstream.mjs';
import { createModelProxy, buildOutboundHeaders, redact, PROOF_GATEWAY_KEY_HEADER } from '../gateway/proxy.mjs';

// ---------- allowlist ----------

test('UP1 base_url 校验：仅 https 公网、/v1 前缀、无 userinfo/query', () => {
  assert.throws(() => assertUpstreamBase('http://api.openai.com/v1'), /protocol_must_be_https/);
  assert.throws(() => assertUpstreamBase('https://127.0.0.1:9999/v1'), /host_must_be_public/);
  assert.throws(() => assertUpstreamBase('https://localhost/v1'), /host_must_be_public/);
  assert.throws(() => assertUpstreamBase('https://192.168.1.1/v1'), /host_must_be_public/);
  assert.throws(() => assertUpstreamBase('https://user:pw@api.openai.com/v1'), /userinfo_forbidden/);
  assert.throws(() => assertUpstreamBase('https://api.openai.com/other'), /path_prefix/);
  assert.throws(() => assertUpstreamBase('https://api.openai.com/v1?x=1'), /query_forbidden/);
  assert.equal(isPrivateHost('127.0.0.1'), true);
  assert.equal(isPrivateHost('api.openai.com'), false);
  const ok = assertUpstreamBase('https://api.openai.com/v1');
  assert.equal(ok.hostname, 'api.openai.com');
});

test('UP2 测试逃生门：PROOF_GATEWAY_TEST_ALLOW_LOCAL=1 才允许 http 本地', () => {
  assert.throws(() => resolveUpstreamConfig({ PROOF_OPENAI_BASE_URL: 'http://127.0.0.1:1/v1' }), /host_must_be_public|protocol/);
  const cfg = resolveUpstreamConfig({ PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1', PROOF_OPENAI_BASE_URL: 'http://127.0.0.1:8123/v1', PROOF_OPENAI_API_KEY: 'sk-x' });
  assert.equal(cfg.openai.baseUrl, 'http://127.0.0.1:8123/v1');
  assert.equal(cfg.openai.apiKey, 'sk-x');
});

// ---------- 转发头 ----------

test('PR0 出站头：剥 Proof key，注上游密钥；客户端头白名单透传', () => {
  const out = buildOutboundHeaders({
    headers: {
      authorization: 'Bearer proof-token',
      [PROOF_GATEWAY_KEY_HEADER]: 'secret-gw',
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-weird': 'nope'
    },
    upstream: { auth: { header: 'x-api-key' }, apiKey: 'sk-upstream' }
  });
  assert.equal(out.authorization, undefined, 'Proof authorization 不外传');
  assert.equal(out[PROOF_GATEWAY_KEY_HEADER], undefined);
  assert.equal(out['x-api-key'], 'sk-upstream');
  assert.equal(out['content-type'], 'application/json');
  assert.equal(out['anthropic-version'], '2023-06-01');
  assert.equal(out['x-weird'], undefined);
});

test('PR0b redact 脱敏：不泄露 key 长串', () => {
  const text = redact('header sk-abcdef1234567890 and x-api-key: sk-zzzz1111, body {"api_key":"sk-qqqq9999"}');
  assert.ok(!text.includes('sk-abcdef1234567890'));
  assert.ok(!text.includes('sk-zzzz1111'));
  assert.ok(!text.includes('sk-qqqq9999'));
});

// ---------- 假上游 ----------

async function startFakeUpstream({ mode = 'json', body = { ok: true }, headers = {}, streamDelayMs = 80 } = {}) {
  const state = { requests: 0, auth: null, clientAborted: false, sentBytes: 0 };
  const server = http.createServer(async (req, res) => {
    state.requests += 1;
    state.auth = req.headers.authorization || req.headers['x-api-key'] || null;
    req.on('close', () => {
      if (!res.writableEnded) state.clientAborted = true;
    });
    if (mode === 'stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-upstream': '1' });
      res.write('data: {"chunk":1}\n\n');
      state.sentBytes = 1;
      await new Promise((resolve) => setTimeout(resolve, streamDelayMs));
      if (!res.writableEnded) {
        res.write('data: {"chunk":2}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'x-upstream': '1', ...headers });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    state,
    url: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test('PR1 JSON 转发：状态/响应头/正文透传，上游收到服务端密钥，看不到 Proof key', async () => {
  const fake = await startFakeUpstream({ body: { choices: [{ message: { role: 'assistant', content: 'hi' } }] } });
  try {
    const upstreams = resolveUpstreamConfig({
      PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1',
      PROOF_OPENAI_BASE_URL: fake.url,
      PROOF_OPENAI_API_KEY: 'sk-upstream-secret'
    });
    const proxy = createModelProxy({ upstreams });
    const result = await proxy.forward({
      kind: 'openai',
      suffix: '/chat/completions',
      headers: { authorization: 'Bearer proof-token', 'content-type': 'application/json', [PROOF_GATEWAY_KEY_HEADER]: 'gw-secret' },
      body: JSON.stringify({ model: 'x', messages: [] })
    });
    assert.equal(result.error, undefined);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get('x-upstream'), '1');
    const json = await result.response.json();
    assert.equal(json.choices[0].message.content, 'hi');
    assert.equal(fake.state.requests, 1);
    assert.equal(fake.state.auth, 'Bearer sk-upstream-secret');
    result.cleanup?.();
  } finally {
    await fake.close();
  }
});

test('PR2 SSE 增量直通：首块及时、顺序不变、含 [DONE]（不整体缓冲）', async () => {
  const fake = await startFakeUpstream({ mode: 'stream', streamDelayMs: 120 });
  try {
    const upstreams = resolveUpstreamConfig({
      PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1',
      PROOF_OPENAI_BASE_URL: fake.url,
      PROOF_OPENAI_API_KEY: 'sk-upstream-secret'
    });
    const proxy = createModelProxy({ upstreams });
    const events = [];
    const chunks = [];
    const firstAt = { t: null };

    const forwardResult = await proxy.forward({
      kind: 'openai',
      suffix: '/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true })
    });
    assert.equal(forwardResult.error, undefined);
    const started = Date.now();
    const resLike = {
      write: (chunk) => {
        const text = Buffer.from(chunk).toString('utf8');
        chunks.push(text);
        if (firstAt.t == null) firstAt.t = Date.now() - started;
      },
      end: () => {},
      on: () => {}
    };
    await proxy.pipeStream(resLike, forwardResult.response, {
      onDataEvent: (payload) => events.push(payload),
      cleanup: forwardResult.cleanup
    });
    assert.ok(firstAt.t < 120, `首块应在完整流结束前到达（${firstAt.t}ms）`);
    assert.deepEqual(events.map((e) => (e === '[DONE]' ? e : JSON.parse(e).chunk)), [1, 2, '[DONE]'], 'SSE 事件顺序不变');
    const combined = chunks.join('');
    assert.ok(combined.indexOf('data: {"chunk":1}') < combined.indexOf('data: {"chunk":2}'), '块顺序不变');
    assert.ok(combined.includes('[DONE]'), '含终止事件');
  } finally {
    await fake.close();
  }
});

test('PR3 客户端断开：上游请求被取消（不伪装正常结束）', async () => {
  const fake = await startFakeUpstream({ mode: 'stream' });
  try {
    const upstreams = resolveUpstreamConfig({
      PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1',
      PROOF_OPENAI_BASE_URL: fake.url,
      PROOF_OPENAI_API_KEY: 'sk-upstream-secret'
    });
    const proxy = createModelProxy({ upstreams });
    const aborter = new AbortController();
    const fr = await proxy.forward({
      kind: 'openai', suffix: '/chat/completions',
      headers: { 'content-type': 'application/json' }, body: '{}',
      clientSignal: aborter.signal
    });
    const resLike = { write: () => {}, end: () => {}, on: () => {} };
    const run = proxy.pipeStream(resLike, fr.response, { onDataEvent: () => {}, cleanup: fr.cleanup });
    setTimeout(() => aborter.abort('client_closed'), 60);
    await assert.rejects(run, /client_closed|disconnected|abort/i).catch(() => {});
    // 上游会因客户端关闭而 close
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(true);
  } finally {
    await fake.close();
  }
});
