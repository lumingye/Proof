// Gateway V1 集成收尾（轮 2）· 真实 server + 本地假上游。
// 覆盖：chat/responses/anthropic JSON+SSE、注入/无注入/reset、上游状态与头、4xx/5xx、
// 重定向拒绝、超时、取消、并发上限、体限、未知字段透传、content-length 重算、
// 多模态/工具/重复文本、日志与账本 canary 零泄露。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpRoot, removeTempDir } from './lib/gatewayEnv.mjs';

process.env.PROOF_AGENTS = 'charb:CharB,chara:CharA,charc:CharC'; // 测试 fixture：用户部署三 Agent（产品默认已 generic）
const SERVICE_ROOT = fileURLToPath(new URL('..', import.meta.url));

const CANARY = {
  gwKey: 'gateway-key-canary',
  upKey: 'upstream-key-canary',
  prompt: 'prompt-canary',
  image: 'image-canary',
  tool: 'tool-canary'
};

async function startFakeUpstream({ redirectTarget = null } = {}) {
  const state = { calls: [], aborted: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    state.calls.push({
      url: req.url,
      headers: { ...req.headers },
      rawLength: raw.length,
      rawText: raw.toString('utf8')
    });
    let body = {};
    try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { /* keep {} */ }

    if (body.mode === 'error429') {
      res.writeHead(429, { 'content-type': 'application/json', 'x-rate-limit-remaining': '5' });
      res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }));
      return;
    }
    if (body.mode === 'error500') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'server_error' } }));
      return;
    }
    if (body.mode === 'redirect') {
      res.writeHead(302, { location: redirectTarget || 'http://127.0.0.1:1/evil' });
      res.end('');
      return;
    }
    if (typeof body.mode === 'string' && body.mode.startsWith('slow')) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (res.destroyed || res.writableEnded) return;
    }
    req.on('close', () => { if (!res.writableEnded) state.aborted += 1; });

    const isStream = body.stream === true || body.stream === 'true';
    const kindPath = req.url.split('?')[0];
    if (isStream) {
      const events = [];
      if (kindPath === '/v1/messages') {
        events.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: '你' } });
        events.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: '好。' } });
        events.push({ type: 'message_stop' });
      } else if (kindPath === '/v1/responses') {
        events.push({ type: 'response.output_text.delta', delta: '你' });
        events.push({ type: 'response.output_text.delta', delta: '好。' });
        events.push({ type: 'response.completed' });
      } else {
        events.push({ choices: [{ delta: { role: 'assistant', content: '你' } }] });
        events.push({ choices: [{ delta: { content: '好。' }, finish_reason: 'stop' }] });
      }
      try {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const event of events) {
          if (res.destroyed) break;
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (!res.destroyed) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } catch {
        // 客户端已断：忽略
      }
      return;
    }

    try {
      res.writeHead(200, { 'content-type': 'application/json', 'x-upstream-ok': '1' });
    } catch {
      return;
    }
    let payload;
    if (kindPath === '/v1/messages') {
      payload = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: '安好。' }], stop_reason: 'end_turn' };
    } else if (kindPath === '/v1/responses') {
      payload = { id: 'resp_1', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '安好。' }] }] };
    } else {
      payload = { id: 'chat_1', choices: [{ index: 0, message: { role: 'assistant', content: '安好。' }, finish_reason: 'stop' }] };
    }
    res.end(JSON.stringify(payload));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { state, url: `http://127.0.0.1:${port}/v1`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function startServer(fake, { extraEnv = {} } = {}) {
  const base = tmpRoot();
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'gw-int-'));
  const port = 21000 + Math.floor(Math.random() * 2500);
  let stdout = '';
  let stderr = '';
  const env = {
    ...process.env,
    PROOF_HOST: '127.0.0.1',
    PROOF_PORT: String(port),
    PROOF_DATA_DIR: dir,
    PROOF_GATEWAY_ENABLED: '1',
    PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1',
    PROOF_OPENAI_BASE_URL: fake.url,
    PROOF_OPENAI_API_KEY: 'upstream-key-canary-secret',
    PROOF_ANTHROPIC_BASE_URL: fake.url,
    PROOF_ANTHROPIC_API_KEY: 'ant-server-secret',
    ...extraEnv
  };
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: SERVICE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (b) => { stdout += String(b); });
  child.stderr.on('data', (b) => { stderr += String(b); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('listen_timeout')), 10_000);
      child.stdout.on('data', (buf) => {
        if (String(buf).includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on('data', (buf) => { if (String(buf).includes('Error')) reject(new Error(`server_err:${String(buf).slice(0, 200)}`)); });
      child.on('exit', (code) => reject(new Error(`server_exit:${code}`)));
    });
  } catch (startError) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    throw startError;
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const charb = (await readFile(join(dir, 'charb.token'), 'utf8')).trim();
  const gwKey = env.PROOF_GATEWAY_ENABLED === '1' ? (await readFile(join(dir, 'charb.gateway-token'), 'utf8')).trim() : null;
  const api = async (path, { method = 'GET', token, body } = {}) => {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, headers: r.headers, json, text };
  };
  return {
    dir, port, child, charb, gwKey, baseUrl, api,
    stdout: () => stdout, stderr: () => stderr,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
      await removeTempDir(dir);
    }
  };
}

async function model(ctx, path, payload, { key, conv, extraHeaders = {} } = {}) {
  const r = await fetch(`${ctx.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'x-proof-gateway-key': key } : {}),
      ...(conv ? { 'x-proof-conversation-id': conv } : {}),
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* stream/err */ }
  return { status: r.status, headers: r.headers, json, text };
}

async function drinkV(ctx, ml) {
  const made = await ctx.api('/human/offers', { method: 'POST', body: { name: '杯', parts: [{ id: '伏特加', volume: ml }] } });
  const claim = await ctx.api('/agent/offers/claim', { method: 'POST', token: ctx.charb, body: { capabilityToken: made.json.link.split('#')[1] } });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
}

async function ledgerText(ctx) {
  try {
    const files = await readdir(ctx.dir);
    if (!files.includes('gateway-ledger.json')) return '';
    return await readFile(join(ctx.dir, 'gateway-ledger.json'), 'utf8');
  } catch {
    return '';
  }
}

// ---------------- 三协议矩阵 ----------------

test('I1 Responses JSON + SSE：透传与流均通过，注入/无注入正确', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    // 无状态零注入
    const idle = await model(ctx, '/v1/responses', {
      model: 'm',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      x_meta_unknown: { keep: 1 }
    }, { key: ctx.gwKey, conv: 'resp-i' });
    assert.equal(idle.status, 200, idle.text.slice(0, 200));
    const sentIdle = JSON.parse(fake.state.calls[0].rawText);
    assert.ok(!JSON.stringify(sentIdle).includes('[Proof 状态]'));
    assert.deepEqual(sentIdle.x_meta_unknown, { keep: 1 }, '未知字段原样透传');
    assert.equal(sentIdle.input[0].content[0].text, 'hi');

    // SSE
    fake.state.calls.length = 0;
    await ctx.api('/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    await drinkV(ctx, 200);
    const streamed = await model(ctx, '/v1/responses', {
      model: 'm',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '流' }] }],
      stream: true
    }, { key: ctx.gwKey, conv: 'resp-s' });
    assert.equal(streamed.status, 200, streamed.text.slice(0, 200));
    assert.ok(streamed.text.includes('[DONE]'), '含终止事件');
    const sentStream = JSON.parse(fake.state.calls[0].rawText);
    assert.ok(sentStream.instructions && sentStream.instructions.includes('[Proof 状态]'), 'SSE 请求同样带注入');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I2 Anthropic JSON + SSE：system 字符串/块、多轮、注入位置、密钥与版本头', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    await ctx.api('/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    await drinkV(ctx, 200);

    const body = {
      model: 'claude-x',
      system: [{ type: 'text', text: '设定' }, '第二段'],
      messages: [
        { role: 'user', content: '第一轮' },
        { role: 'assistant', content: '回复一' },
        { role: 'user', content: '第二轮' }
      ],
      max_tokens: 64,
      x_unknown: [1, 2]
    };
    const jsonRes = await model(ctx, '/v1/messages', body, { key: ctx.gwKey, conv: 'ant-1', extraHeaders: { 'anthropic-version': '2023-06-01' } });
    assert.equal(jsonRes.status, 200, jsonRes.text.slice(0, 200));
    const sent = JSON.parse(fake.state.calls[0].rawText);
    // 注入并入 system 末尾（块内追加 text 块）
    assert.ok(Array.isArray(sent.system) && sent.system.some((b) => typeof b === 'object' && b.type === 'text' && b.text.includes('[Proof 状态]')));
    assert.equal(sent.messages.length, 3, '无断片不改写消息');
    assert.deepEqual(sent.x_unknown, [1, 2]);
    assert.equal(sent.max_tokens, 64);
    // 头：x-api-key 是服务端配置；gateway key 不进上游；anthropic-version 原样转发
    assert.equal(fake.state.calls[0].headers['x-api-key'], 'ant-server-secret');
    assert.equal(fake.state.calls[0].headers['x-proof-gateway-key'], undefined);
    assert.equal(fake.state.calls[0].headers['anthropic-version'], '2023-06-01');

    // SSE
    fake.state.calls.length = 0;
    const streamed = await model(ctx, '/v1/messages', { ...body, messages: [{ role: 'user', content: '再会' }], stream: true }, { key: ctx.gwKey, conv: 'ant-2', extraHeaders: { 'anthropic-version': '2023-06-01' } });
    assert.equal(streamed.status, 200, streamed.text.slice(0, 200));
    assert.ok(streamed.text.includes('message_stop'), 'Anthropic 终止事件');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I3 Chat JSON：无状态/有状态/reset/未知字段/4xx/5xx/头透传', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    await ctx.api('/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    await drinkV(ctx, 200);
    const ok = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2 }, { key: ctx.gwKey, conv: 'c-1' });
    assert.equal(ok.status, 200);
    const sent = JSON.parse(fake.state.calls[0].rawText);
    assert.equal(sent.temperature, 0.2);
    assert.ok(JSON.stringify(sent).includes('[Proof 状态]'));

    // reset 后停止注入
    await ctx.api('/agent/reset', { method: 'POST', token: ctx.charb, body: { mode: '连宿醉一起清' } });
    fake.state.calls.length = 0;
    const afterReset = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: '现在' }] }, { key: ctx.gwKey, conv: 'c-2' });
    assert.equal(afterReset.status, 200);
    assert.ok(!JSON.stringify(fake.state.calls[0].rawText).includes('[Proof 状态]'), 'reset 后不再注入');

    // 4xx/5xx 与响应头透传
    const e4 = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'x' }], mode: 'error429' }, { key: ctx.gwKey, conv: 'c-3' });
    assert.equal(e4.status, 429);
    assert.equal(e4.headers.get('x-rate-limit-remaining'), '5');
    const e5 = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'x' }], mode: 'error500' }, { key: ctx.gwKey, conv: 'c-4' });
    assert.equal(e5.status, 500);
    // 4xx/5xx 不污染账本：失败会话尾部登记必须被收回
    const ledgerJson = JSON.parse(await ledgerText(ctx) || '{}');
    const convs = ledgerJson.conversations || {};
    assert.equal((convs['charb__c-3']?.messages || []).length, 0, '429 请求不得写账本');
    assert.equal((convs['charb__c-4']?.messages || []).length, 0, '500 请求不得写账本');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I4 上游重定向拒绝 + 超时 + 体限', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake, { extraEnv: { PROOF_GATEWAY_UPSTREAM_TIMEOUT_MS: '200', PROOF_GATEWAY_MAX_BODY_BYTES: '4096' } });
  try {
    // 重定向
    const redir = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'x' }], mode: 'redirect' }, { key: ctx.gwKey, conv: 'r-1' });
    assert.equal(redir.status, 502, redir.text.slice(0, 200));
    assert.equal(redir.json.error, 'upstream_redirect_forbidden');

    // 超时
    const timeoutRes = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'x' }], mode: 'slow' }, { key: ctx.gwKey, conv: 'r-2' });
    assert.equal(timeoutRes.status, 504, timeoutRes.text.slice(0, 200));
    assert.equal(timeoutRes.json.error, 'upstream_timeout');

    // 体限
    const big = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'x'.repeat(9000) }] }, { key: ctx.gwKey, conv: 'r-3' });
    assert.equal(big.status, 413, big.text.slice(0, 200));
    assert.equal(big.json.error, 'payload_too_large');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I9 并发上限：默认不排队，占满后 429，结束后恢复', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake, { extraEnv: { PROOF_GATEWAY_MAX_CONCURRENT: '2' } });
  try {
    const call = () => fetch(`${ctx.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-proof-gateway-key': ctx.gwKey },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 's' }], mode: 'slow-json' })
    });
    // 三路同时发：占满 2 个槽，第三个必须被稳定拒绝
    const [r1, r2, r3] = await Promise.all([call(), call(), call()]);
    const statuses = [r1.status, r2.status, r3.status].sort();
    const texts = await Promise.all([r1.text(), r2.text(), r3.text()]);
    assert.deepEqual(statuses, [200, 200, 429], `占满后第 3 个应 429，实际 ${JSON.stringify(statuses)} 详情 ${JSON.stringify(texts).slice(0, 300)}`);
    const after = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'again' }] }, { key: ctx.gwKey, conv: 'r-5' });
    assert.equal(after.status, 200, '结束后恢复');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I5 客户端取消中止上游；取消后仍可继续新请求', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    const controller = new AbortController();
    const r = await fetch(`${ctx.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-proof-gateway-key': ctx.gwKey },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'c' }], stream: true })
    });
    assert.equal(r.status, 200);
    const reader = r.body.getReader();
    await reader.read(); // 消费首块
    controller.abort('client_gone');
    await reader.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 150));
    const later = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: 'ok' }] }, { key: ctx.gwKey, conv: 'ccl' });
    assert.equal(later.status, 200, '取消后会话槽释放，新请求成功');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I6 多模态/工具/重复文本：内容不被改写、账本无正文、无孤立 tool result、content-length 重算', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    const toolId = 'call_canary_1';
    const chatBody = {
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${CANARY.image}==` } }] },
        { role: 'assistant', content: null, tool_calls: [{ id: toolId, type: 'function', function: { name: 'lookup', arguments: `{"q":"${CANARY.tool}"}` } }] },
        { role: 'tool', tool_call_id: toolId, content: '结果1' },
        { role: 'user', content: '继续' }
      ]
    };
    const originalPayload = JSON.stringify(chatBody);
    const res = await model(ctx, '/v1/chat/completions', chatBody, { key: ctx.gwKey, conv: 'mm-1' });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    const sent = fake.state.calls[0];
    const parsed = JSON.parse(sent.rawText);
    // 多模态/tool 组原样
    assert.ok(parsed.messages[0].content[1].image_url.url.includes(CANARY.image), '图片字节未被改写');
    assert.ok(parsed.messages[1].tool_calls[0].id === toolId, 'tool call 原样');
    assert.equal(parsed.messages[2].tool_call_id, toolId, 'tool result 保持配套');
    assert.ok(parsed.messages[3].content === '继续');
    // content-length 重算：与实际上游字节一致
    assert.equal(sent.headers['content-length'], String(sent.rawLength));
    // 账本不得含正文/base64/工具参数
    const ledger = await ledgerText(ctx);
    assert.ok(!ledger.includes(CANARY.image), '账本无图片正文');
    assert.ok(!ledger.includes(CANARY.tool), '账本无 tool 参数');
    assert.ok(!ledger.includes('看图'), '账本无提示词正文');

    // 重复文本 occurrence 区分：两次请求各发一次相同 user 文本
    const rA = await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: '相同文本' }] }, { key: ctx.gwKey, conv: 'dup-1' });
    assert.equal(rA.status, 200);
    const rB = await model(ctx, '/v1/chat/completions', {
      model: 'm',
      messages: [{ role: 'user', content: '相同文本' }, { role: 'user', content: '相同文本' }]
    }, { key: ctx.gwKey, conv: 'dup-1' });
    assert.equal(rB.status, 200);
    const entries = JSON.parse(await ledgerText(ctx));
    const conv = entries?.conversations?.['charb__dup-1'];
    const userEntries = (conv?.messages || []).filter((m) => m.role === 'user');
    assert.ok(userEntries.length >= 2, `同文应至少两条记录，实际 ${userEntries.length}`);
    assert.equal(new Set(userEntries.map((m) => m.fp)).size, userEntries.length, '同文不同 occurrence 指纹互异');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I7 canary 零泄露：日志/响应不出现任何 key、prompt、图片、tool 内容', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake, { extraEnv: { PROOF_GATEWAY_UPSTREAM_TIMEOUT_MS: '300' } });
  try {
    // 触发各类路径并植入 canary
    await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: `prompt-canary 见` }] }, { key: `bad-${CANARY.gwKey}` });
    await ctx.api('/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    await drinkV(ctx, 200);
    await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: CANARY.prompt }], mode: 'error429' }, { key: ctx.gwKey, conv: 'log-1' });
    await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${CANARY.image}==` } }] }], mode: 'error500' }, { key: ctx.gwKey, conv: 'log-2' });
    await model(ctx, '/v1/chat/completions', { model: 'm', messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'f', arguments: JSON.stringify({ q: CANARY.tool }) } }] }, { role: 'user', content: 'x' }], mode: 'slow' }, { key: ctx.gwKey, conv: 'log-3' });

    const logs = `${ctx.stdout()}\n${ctx.stderr()}`;
    for (const canary of Object.values(CANARY)) {
      assert.ok(!logs.includes(canary), `日志泄露 canary: ${canary}`);
    }
    assert.ok(!logs.includes('sk-server') && !logs.includes('ant-server'), '日志无上游密钥');
    assert.ok(!logs.includes(ctx.gwKey), '日志无 gateway key');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I8 content-length：注入后转发长度与上游实际字节一致（不沿用客户端旧长度）', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake);
  try {
    await ctx.api('/agent/injection', { method: 'POST', token: ctx.charb, body: { enabled: true } });
    await drinkV(ctx, 200);
    const payload = { model: 'm', messages: [{ role: 'system', content: '短' }, { role: 'user', content: 'hi' }] };
    const originalText = JSON.stringify(payload);
    await model(ctx, '/v1/chat/completions', payload, { key: ctx.gwKey, conv: 'cl-1' });
    const call = fake.state.calls[0];
    assert.equal(call.headers['content-length'], String(call.rawLength), 'content-length = 实际上游字节');
    assert.notEqual(call.rawLength, Buffer.byteLength(originalText), '注入改变了长度（未被旧长度覆盖）');
    assert.ok(call.rawLength > Buffer.byteLength(originalText), '注入后长度更大');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});

test('I10 模式隔离：Gateway 关闭时 /v1 明确 404 gateway_disabled，普通路由不受影响', async () => {
  const fake = await startFakeUpstream();
  const ctx = await startServer(fake, { extraEnv: { PROOF_GATEWAY_ENABLED: '0' } });
  try {
    // 未启用：POST /v1 一律 404 gateway_disabled（不进入鉴权，也不要求 key）
    const v1 = await ctx.api('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-proof-gateway-key': 'any-key-must-not-matter' },
      body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] }
    });
    assert.equal(v1.status, 404, v1.text.slice(0, 200));
    assert.equal(v1.json?.error, 'gateway_disabled');
    const v1m = await ctx.api('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] }
    });
    assert.equal(v1m.status, 404, v1m.text.slice(0, 200));
    assert.equal(v1m.json?.error, 'gateway_disabled');

    // 普通路由完整可用：health、公开链接、agent turn-context 照常
    const health = await ctx.api('/health');
    assert.equal(health.status, 200);
    const agentTc = await ctx.api('/agent/turn-context', { token: ctx.charb });
    assert.equal(agentTc.status, 200, agentTc.text.slice(0, 200));
    assert.equal(fake.state.calls.length, 0, '关闭态绝不触达上游');
  } finally {
    await ctx.stop();
    await fake.close();
  }
});
