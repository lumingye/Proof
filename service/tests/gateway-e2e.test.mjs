// Gateway V1 端到端（里程碑 4/5）：真实 server.mjs + 本地假上游。
// 覆盖身份、自动注入、硬断片过滤、SSE 直通、reset 停注、错误透传、managed 拒绝。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpRoot, removeTempDir } from './lib/gatewayEnv.mjs';

process.env.PROOF_AGENTS = 'charb:CharB,chara:CharA,charc:CharC'; // 测试 fixture：用户部署三 Agent（产品默认已 generic）
const SERVICE_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function startFakeUpstream() {
  const state = { calls: [], lastAuth: null, mode: 'default' };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    state.lastAuth = req.headers.authorization || req.headers['x-api-key'] || null;
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep empty */ }
    state.calls.push({ url: req.url, headers: { ...req.headers }, body });
    if (body.mode === 'error429') {
      res.writeHead(429, { 'content-type': 'application/json', 'x-rate-limit-remaining': '5' });
      res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }));
      return;
    }
    const isStream = body.stream === true || body.stream === 'true';
    if (isStream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"role":"assistant","content":"你"}}]}\n\n');
      setTimeout(() => {
        if (!res.writableEnded) {
          res.write('data: {"choices":[{"delta":{"content":"好。"},"finish_reason":"stop"}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, 30);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'x-upstream-ok': '1' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '我是假上游的回复。' } }] }));
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

async function startServer(fake, { gatewayOn = true } = {}) {
  const base = tmpRoot();
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'gw-e2e-'));
  const port = 20000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: SERVICE_ROOT,
    env: {
      ...process.env,
      PROOF_HOST: '127.0.0.1',
      PROOF_PORT: String(port),
      PROOF_DATA_DIR: dir,
      PROOF_GATEWAY_ENABLED: gatewayOn ? '1' : '0',
      PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1',
      PROOF_OPENAI_BASE_URL: fake.url,
      PROOF_OPENAI_API_KEY: 'sk-server-secret',
      PROOF_ANTHROPIC_BASE_URL: fake.url,
      PROOF_ANTHROPIC_API_KEY: 'ant-server-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('listen_timeout')), 10_000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (buf) => { if (String(buf).includes('Error')) reject(new Error(`server_err:${String(buf).slice(0, 300)}`)); });
    child.on('exit', (code) => reject(new Error(`server_exit:${code}`)));
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const charb = (await readFile(join(dir, 'charb.token'), 'utf8')).trim();
  let gwKey = null;
  if (gatewayOn) gwKey = (await readFile(join(dir, 'charb.gateway-token'), 'utf8')).trim();
  return { dir, port, child, charb, gwKey, baseUrl };
}

async function stopServer(ctx) {
  ctx.child.kill('SIGTERM');
  await new Promise((resolve) => ctx.child.once('exit', resolve));
  await removeTempDir(ctx.dir);
}

async function api(ctx, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${ctx.baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: response.status, headers: response.headers, json, text };
}

async function gatewayChat(ctx, payload, { key, bearerKey, apiKeyHeader, convId, extraHeaders = {} } = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(key ? { 'x-proof-gateway-key': key } : {}),
    ...(bearerKey ? { authorization: `Bearer ${bearerKey}` } : {}),
    ...(apiKeyHeader ? { [apiKeyHeader]: key } : {}),
    ...(convId ? { 'x-proof-conversation-id': convId } : {}),
    ...extraHeaders
  };
  const response = await fetch(`${ctx.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* stream or err */ }
  return { status: response.status, headers: response.headers, json, text };
}

test('E2-mobile OpenAI-compatible 客户端可用 Bearer API Key，缺 conversation header 时安全降级', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    const response = await gatewayChat(ctx, {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '手机端测试' }]
    }, { bearerKey: ctx.gwKey });
    assert.equal(response.status, 200, response.text);
    assert.equal(fake.state.calls.length, 1);
    assert.equal(fake.state.calls[0].headers.authorization, 'Bearer sk-server-secret', 'client Bearer key must be stripped and replaced by the server upstream key');
    assert.equal(fake.state.calls[0].body.model, 'deepseek-chat');
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-mobile API Key 字段兼容 x-api-key / api-key 传输', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    for (const apiKeyHeader of ['x-api-key', 'api-key']) {
      const response = await gatewayChat(ctx, {
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: apiKeyHeader }]
      }, { key: ctx.gwKey, apiKeyHeader });
      assert.equal(response.status, 200, `${apiKeyHeader}: ${response.text}`);
    }
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-mobile RikkaHub chat/completions 尾斜杠与标准路径等价', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    const response = await fetch(`${ctx.baseUrl}/v1/chat/completions/`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.gwKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'slash' }] })
    });
    assert.equal(response.status, 200, await response.text());
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

/** 给 charb 引擎灌入大剂量（≈15.8 杯 → 断片 + 强推力）。 */
/** 给 charb 引擎灌入指定毫升伏特加。 */
async function drinkV(ctx, ml) {
  const made = await api(ctx, '/human/offers', {
    method: 'POST',
    body: { name: '测试杯', parts: [{ id: '伏特加', volume: ml }] }
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const claim = await api(ctx, '/agent/offers/claim', {
    method: 'POST',
    token: ctx.charb,
    body: { capabilityToken: made.json.link.split('#')[1] }
  });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
}

/** 大剂量（≈15.8 杯 → 断片 + 强推力）。 */
async function drinkBig(ctx) {
  await drinkV(ctx, 500);
}

test('E2-1 身份：缺 key / 错 key / 自称他人 agentId 均拒绝，正确 key 放行', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    const payload = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
    assert.equal((await gatewayChat(ctx, payload)).status, 401, '缺 key');
    assert.equal((await gatewayChat(ctx, payload, { key: 'wrong' })).status, 401, '错 key');
    const forbidden = await gatewayChat(ctx, payload, { key: ctx.gwKey, extraHeaders: { 'x-proof-agent-id': 'charc' } });
    assert.equal(forbidden.status, 403);
    const ok = await gatewayChat(ctx, payload, { key: ctx.gwKey, convId: 'c-1' });
    assert.equal(ok.status, 200, ok.text.slice(0, 200));
    assert.ok(fake.state.lastAuth.includes('sk-server-secret'), '上游收到服务端密钥');
    assert.ok(!JSON.stringify(fake.state.calls[0].headers).includes(ctx.gwKey), '上游收不到 Proof key');
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-2 无状态自动注入不产生额外内容；有状态自动注入无需 MCP', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    const idle = await gatewayChat(ctx, { model: 'm', messages: [{ role: 'system', content: '酒保设定' }, { role: 'user', content: '你好' }] }, { key: ctx.gwKey, convId: 'idle-c' });
    assert.equal(idle.status, 200);
    const sentIdle = fake.state.calls[0].body;
    assert.equal(sentIdle.messages.length, 2, '无状态不增删消息');
    assert.ok(!JSON.stringify(sentIdle).includes('[Proof 状态]'), '无状态不注入');

    await api(ctx, '/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    await drinkV(ctx, 200); // ≈6.3 杯：有推力、无断片
    fake.state.calls.length = 0;
    const active = await gatewayChat(ctx, { model: 'm', messages: [{ role: 'user', content: '再来一杯' }] }, { key: ctx.gwKey, convId: 'active-c' });
    assert.equal(active.status, 200);
    const sentActive = fake.state.calls[0].body;
    assert.ok(JSON.stringify(sentActive).includes('[Proof 状态]'), '有状态自动注入，无需模型主动调 MCP');
    assert.equal(sentActive.messages.at(-1).role, 'user');
    assert.ok(sentActive.messages.at(-1).content.startsWith('再来一杯\n'), '当前用户原文保持在动态状态之前');
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-3 硬断片：窗口内历史下一轮被**完全移除**（真实遮蔽），当前轮可见；原文不透传', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    await api(ctx, '/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    await drinkBig(ctx);

    const conv = 'blackout-c';
    // 第一轮：当前用户消息正常回应（本轮仍经历）
    const first = await gatewayChat(ctx, {
      model: 'm',
      messages: [{ role: 'user', content: '我们刚才聊到哪儿了' }]
    }, { key: ctx.gwKey, convId: conv });
    assert.equal(first.status, 200);
    // 第二轮：历史（上一轮 user + 假上游 assistant 回复）落在窗口内 → 完全移除（不留原位占位）
    fake.state.calls.length = 0;
    const second = await gatewayChat(ctx, {
      model: 'm',
      messages: [
        { role: 'user', content: '我们刚才聊到哪儿了' },
        { role: 'assistant', content: '我是假上游的回复。' },
        { role: 'user', content: '再说一遍' }
      ]
    }, { key: ctx.gwKey, convId: conv });
    assert.equal(second.status, 200);
    const sent = fake.state.calls[0].body;
    const serialized = JSON.stringify(sent);
    assert.ok(!serialized.includes('我是假上游的回复。'), 'assistant 原文不透传');
    assert.ok(!serialized.includes('我们刚才聊到哪儿了'), '历史 user 原文不透传');
    assert.ok(!serialized.includes('[Proof 断片]'), '无原位占位（真实遮蔽）');
    assert.ok(serialized.includes('再说一遍'), '当前轮仍可见');
    assert.ok(serialized.includes('[Proof 状态]'), '注入仍在');
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-4 reset 后停止注入，且断片立即解除', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    await api(ctx, '/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    await drinkBig(ctx);
    const reset = await api(ctx, '/agent/reset', { method: 'POST', token: ctx.charb, body: { mode: '连宿醉一起清' } });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    fake.state.calls.length = 0;
    const after = await gatewayChat(ctx, { model: 'm', messages: [{ role: 'user', content: '现在呢' }] }, { key: ctx.gwKey, convId: 'reset-c' });
    assert.equal(after.status, 200);
    const sent = fake.state.calls[0].body;
    assert.ok(!JSON.stringify(sent).includes('[Proof 状态]'), 'reset 后不再注入');
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-5 SSE 流直通：chunk 顺序不变并含 [DONE]，无需整体缓冲', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    const response = await fetch(`${ctx.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-proof-gateway-key': ctx.gwKey, 'x-proof-conversation-id': 'stream-c' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: '流式' }], stream: true })
    });
    assert.equal(response.status, 200);
    const chunks = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    const full = chunks.join('');
    assert.ok(full.includes('data: {"choices":[{"delta":{"role":"assistant","content":"你"}}]'));
    assert.ok(full.includes('data: [DONE]'));
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-6 上游错误/头透传与 managed 拒绝', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    const err = await gatewayChat(ctx, { model: 'm', messages: [{ role: 'user', content: 'x' }], mode: 'error429' }, { key: ctx.gwKey });
    assert.equal(err.status, 429, '上游 429 原样透传');
    assert.equal(err.headers.get('x-rate-limit-remaining'), '5');
    assert.equal(err.json.error.message, 'slow down');
    assert.ok(!err.text.includes('sk-server-secret'), '错误正文不含上游密钥');

    // provider-managed：断片活跃时拒绝（带正确 key）
    await drinkBig(ctx);
    const managedRes = await fetch(`${ctx.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-proof-gateway-key': ctx.gwKey },
      body: JSON.stringify({ model: 'm', previous_response_id: 'resp_1', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] })
    });
    const managedBody = await managedRes.json();
    assert.equal(managedRes.status, 422, JSON.stringify(managedBody));
    assert.equal(managedBody.error, 'hard_blackout_requires_full_context');
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-7 关闭 gateway 时 /v1 一律不可用', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake, { gatewayOn: false });
  try {
    const res = await gatewayChat(ctx, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, { key: ctx.gwKey });
    assert.equal(res.status, 404);
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-8 自动投递默认开启：无需手工 /agent/injection，饮酒后下一模型轮自动带 [Proof 状态]', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    // 不调用任何 /agent/injection
    const home = await api(ctx, '/agent/home', { token: ctx.charb });
    assert.equal(home.status, 200);
    assert.equal(home.json.stateInjectionEnabled, true, '总开关默认开');
    const drink = await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.charb });
    assert.equal(drink.status, 200, drink.text.slice(0, 200));
    assert.ok(drink.json.drink && drink.json.drink.actualEffectDescription, '当轮返回实际效果');
    fake.state.calls.length = 0;
    const active = await gatewayChat(ctx, { model: 'm', messages: [{ role: 'user', content: '下一轮' }] }, { key: ctx.gwKey, convId: 'ad-on-c' });
    assert.equal(active.status, 200);
    const sent = fake.state.calls[0].body;
    assert.ok(JSON.stringify(sent).includes('[Proof 状态]'), '默认自动注入，无需手动开启');
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});

test('E2-9 总开关：关后 Gateway 不再自动注入但读取正常；再开同一状态恢复自动注入', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.charb });
    // 关闭自动投递
    const off = await api(ctx, '/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: false } });
    assert.equal(off.status, 200);
    // 继续喝酒：drink 成功、当轮有效果、ledger 正常
    const drink2 = await api(ctx, '/agent/menu/cup-金汤力/drink', { method: 'POST', token: ctx.charb });
    assert.equal(drink2.status, 200, drink2.text.slice(0, 200));
    assert.ok(drink2.json.drink && drink2.json.drink.actualEffectDescription);
    // Gateway 轮不自动注入
    fake.state.calls.length = 0;
    const chat = await gatewayChat(ctx, { model: 'm', messages: [{ role: 'user', content: '现在呢' }] }, { key: ctx.gwKey, convId: 'ad-off-c' });
    assert.equal(chat.status, 200);
    const sent = fake.state.calls[0].body;
    assert.ok(!JSON.stringify(sent).includes('[Proof 状态]'), '关闭后不再自动注入');
    // 手动读取仍可读到状态
    const tc = await api(ctx, '/agent/turn-context', { token: ctx.charb });
    assert.equal(tc.json.hasState, true);
    assert.equal(tc.json.injected, false);
    assert.ok(tc.json.context && tc.json.context.text, 'context 手动仍可读');
    // 重新开启：无需重新饮酒，下一轮恢复自动注入
    await api(ctx, '/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    fake.state.calls.length = 0;
    const chat2 = await gatewayChat(ctx, { model: 'm', messages: [{ role: 'user', content: '又回来' }] }, { key: ctx.gwKey, convId: 'ad-back-c' });
    assert.equal(chat2.status, 200);
    const sent2 = fake.state.calls[0].body;
    assert.ok(JSON.stringify(sent2).includes('[Proof 状态]'), '再开后同一状态恢复自动注入');
  } finally {
    await stopServer(ctx);
    await fake.close();
  }
});
