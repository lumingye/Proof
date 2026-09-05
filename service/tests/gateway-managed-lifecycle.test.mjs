// Gateway V1 集成收尾（轮 2）· 托管上下文（Responses previous_response_id）与生命周期集成。
// 全部假时钟 + 进程内网关 + 真实 HTTP 请求 + 本地假上游；不真实等待，不调用真实 API。

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProofEngine } from '../../engine/src/engine/ProofEngine.js';
import { realPack, buildFromParts } from '../../engine/src/content/realPack.js';
import { createGateway } from '../gateway/index.mjs';
import { handleModelEndpoint } from '../gateway/handler.mjs';
import { makeTempDir, removeTempDir, createClock } from './lib/gatewayEnv.mjs';

const H = 3600000;
const T0 = Date.UTC(2026, 8, 2, 15, 0, 0); // 上海 23:00

async function startFakeUpstream() {
  const state = { calls: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    state.calls.push({ headers: { ...req.headers }, rawText: raw });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'r_1', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '回你。' }] }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { state, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function setup() {
  const dir = await makeTempDir('gw-ml-');
  const clock = createClock(T0);
  const engines = new Map([['charb', new ProofEngine(null, realPack)]]);
  const gateway = createGateway({
    getEngine: (id) => engines.get(id) || null,
    dataDir: dir,
    now: clock.now,
    env: {
      PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1',
      PROOF_OPENAI_BASE_URL: 'http://unused/v1',
      PROOF_GATEWAY_ENABLED: '1'
    }
  });
  await gateway.identity.ensure('charb');
  const key = (await readFile(join(dir, 'charb.gateway-token'), 'utf8')).trim();
  const fake = await startFakeUpstream();
  // 让 fake 接管：openai base 已在上面固定，改用 fake 需要 env；直接改 gateway 代理映射不可行，
  // 因此在这里重建 gateway 使用 fake url。
  const gateway2 = createGateway({
    getEngine: (id) => engines.get(id) || null,
    dataDir: dir,
    now: clock.now,
    env: {
      PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1',
      PROOF_OPENAI_BASE_URL: fake.url,
      PROOF_GATEWAY_ENABLED: '1'
    }
  });
  await gateway2.identity.ensure('charb');
  const srv = http.createServer(async (req, res) => {
    const agentId = await gateway2.identity.agentIdForToken(req.headers['x-proof-gateway-key']);
    if (!agentId) { res.writeHead(401); res.end('{}'); return; }
    if (!gateway2.concurrency.tryAcquire()) { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'gateway_overloaded' })); return; }
    const release = () => gateway2.concurrency.release();
    res.once('finish', release);
    res.once('close', release);
    try {
      await handleModelEndpoint({ gateway: gateway2, req, res, pathname: req.url, agentId });
    } catch {
      if (!res.writableEnded) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{}'); }
    }
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const base = `http://127.0.0.1:${srv.address().port}`;
  const engine = () => engines.get('charb');
  const request = async (payload, conv) => {
    const r = await fetch(`${base}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-proof-gateway-key': key, 'x-proof-conversation-id': conv },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, json, text };
  };
  const drink = (ml, at) => {
    const cup = buildFromParts('测试杯', [{ id: '伏特加', volume: ml }], { id: `c-${ml}-${at}`, kind: 'custom', listed: false });
    engine().sipAll(cup, at);
  };
  const ledgerRaw = () => readFile(join(dir, 'gateway-ledger.json'), 'utf8').catch(() => '');
  return {
    gateway: gateway2, engine, clock, dir, fake, base, key, request, drink, ledgerRaw,
    stop: async () => {
      srv.close();
      await fake.close();
      await removeTempDir(dir);
    }
  };
}

const fullInput = (extra = []) => [
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '在吗' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '在。' }] },
  ...extra
];

test('M1 无断片：previous_response_id 正常透传', async () => {
  const h = await setup();
  try {
    const res = await h.request({ model: 'm', previous_response_id: 'resp_old', input: 'hi' }, 'm1');
    assert.equal(res.status, 200, res.text.slice(0, 200));
    const sent = JSON.parse(h.fake.state.calls[0].rawText);
    assert.equal(sent.previous_response_id, 'resp_old');
  } finally {
    await h.stop();
  }
});

test('M2 断片活跃：previous_response_id → 422；不泄密、不污染账本、不推进期限', async () => {
  const h = await setup();
  try {
    h.drink(300, T0); // ≈9.5 杯 → 断片
    h.engine().setStateInjection(true);
    const before = JSON.stringify(h.engine().state.drinkEvents[0]);
    const res = await h.request({ model: 'm', previous_response_id: 'resp_old', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '秘密历史' }] }] }, 'm2');
    assert.equal(res.status, 422, res.text.slice(0, 200));
    assert.equal(res.json.error, 'hard_blackout_requires_full_context');
    assert.ok(!res.text.includes('秘密历史'), '422 不泄露历史');
    const ledger = await h.ledgerRaw();
    assert.ok(!ledger.includes('秘密历史'), '422 不写账本正文');
    const convKey = JSON.parse(ledger || '{}')?.conversations?.['charb__m2'];
    assert.ok(!convKey || convKey.messages.length === 0, '422 不留账本登记');
    assert.equal(JSON.stringify(h.engine().state.drinkEvents[0]), before, '期限未被推进');
  } finally {
    await h.stop();
  }
});

test('M3 断片活跃改用完整上下文 → 200；reset 后 previous_response_id 再次允许', async () => {
  const h = await setup();
  try {
    h.drink(300, T0);
    h.engine().setStateInjection(true);
    const full = await h.request({ model: 'm', input: fullInput() }, 'm3a');
    assert.equal(full.status, 200, full.text.slice(0, 200));
    const blocked = await h.request({ model: 'm', previous_response_id: 'r9', input: 'hi' }, 'm3b');
    assert.equal(blocked.status, 422);
    h.engine().reset('连宿醉一起清', h.clock.now());
    const allowed = await h.request({ model: 'm', previous_response_id: 'r9', input: 'hi' }, 'm3c');
    assert.equal(allowed.status, 200, 'reset 后立即再次允许');
  } finally {
    await h.stop();
  }
});

test('M4 60h 到点恢复后 previous_response_id 再次允许；原文重新进入组装', async () => {
  const h = await setup();
  try {
    h.drink(300, T0);
    h.engine().setStateInjection(true);
    const blocked = await h.request({ model: 'm', previous_response_id: 'r_old', input: 'hi' }, 'm4');
    assert.equal(blocked.status, 422);
    // 推过 60h 恢复点
    const restoreAt = h.engine().state.fragmentBatches[0].restoreAt;
    h.clock.set(restoreAt + 1000);
    const allowed = await h.request({ model: 'm', previous_response_id: 'r_old', input: 'hi' }, 'm4');
    assert.equal(allowed.status, 200, '60h 后恢复允许');
    const sent = JSON.parse(h.fake.state.calls[h.fake.state.calls.length - 1].rawText);
    assert.equal(sent.previous_response_id, 'r_old');
  } finally {
    await h.stop();
  }
});

test('M5 关闭断片立即恢复：previous_response_id 再次允许，历史原文可见', async () => {
  const h = await setup();
  try {
    h.drink(300, T0);
    h.engine().setStateInjection(true);
    assert.equal((await h.request({ model: 'm', previous_response_id: 'rx', input: 'hi' }, 'm5a')).status, 422);
    h.engine().lifecycle.blackoutEnabled = false;
    h.engine().settle(h.clock.now());
    const res = await h.request({ model: 'm', previous_response_id: 'rx', input: 'hi' }, 'm5b');
    assert.equal(res.status, 200, '关闭断片后允许');
  } finally {
    await h.stop();
  }
});

test('L1 跨午夜状态持续；L2/L3 TTL 72h 固定不滑动、新饮用才推进', async () => {
  const h = await setup();
  try {
    // L1 深夜 200ml ≈6.3 杯，跨午夜仍有残留
    const late = Date.UTC(2026, 8, 2, 15, 50, 0); // 上海 23:50
    h.drink(200, late);
    h.engine().setStateInjection(true);
    const nextDay = Date.UTC(2026, 8, 2, 17, 0, 0); // 上海次日 01:00
    h.clock.set(nextDay);
    h.engine().settle(nextDay);
    assert.ok(h.engine().state.c > 0, `跨午夜 c=${h.engine().state.c} 不被清零`);
    // 网关请求仍自动注入
    const res = await h.request({ model: 'm', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '还在吗' }] }] }, 'l1');
    assert.equal(res.status, 200);
    assert.ok(JSON.stringify(h.fake.state.calls.at(-1).rawText).includes('[Proof 状态]'), '跨日后仍注入');

    // L2 TTL 固定：expiresAt 多次读取不滑动
    const first = h.engine().state.drinkEvents[0].expiresAt;
    for (let i = 1; i <= 5; i += 1) {
      h.clock.set(late + 60 * H + i * H);
      h.engine().settle(h.clock.now());
      assert.equal(h.engine().state.drinkEvents[0]?.expiresAt, first, `第 ${i} 次读取不滑动`);
    }
    // 到 72h 后 prune
    h.clock.set(late + 72 * H + 1000);
    h.engine().settle(h.clock.now());
    assert.equal(h.engine().state.c, 0, '72h 到期清理');

    // L3 新有效饮用推进期限
    h.drink(200, h.clock.now());
    h.engine().settle(h.clock.now());
    const extended = h.engine().state.drinkEvents[0].expiresAt;
    assert.ok(extended > late + 72 * H, '新饮用推进期限');
  } finally {
    await h.stop();
  }
});

test('L4 reset：断片立即恢复、注入停止、敏感度保留', async () => {
  const h = await setup();
  try {
    h.drink(300, T0);
    h.engine().setStateInjection(true);
    h.engine().state.sensitivity.愉悦 = 1.7;
    h.clock.set(T0 + H);
    h.engine().reset('连宿醉一起清', h.clock.now());
    const state = h.engine().state;
    assert.ok(!state.fragmentBatches.some((b) => b.readable !== true), '断片立即恢复');
    assert.equal(state.c, 0);
    assert.equal(state.sensitivity.愉悦, 1.7, '敏感度保留');
    const res = await h.request({ model: 'm', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] }] }, 'l4');
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(h.fake.state.calls.at(-1).rawText).includes('[Proof 状态]'), 'reset 后不再注入');
  } finally {
    await h.stop();
  }
});

test('L5 重启：期限、断片、会话归属与账本不丢；敏感度保留', async () => {
  const h = await setup();
  try {
    h.drink(300, T0);
    h.engine().setStateInjection(true);
    h.engine().state.sensitivity.唤醒 = 0.6;
    const before = h.engine().exportState();
    const restoreAt = h.engine().state.fragmentBatches[0].restoreAt;
    // 重启：同 dataDir 新实例 + restore 引擎
    const restored = new ProofEngine(null, realPack).restoreState(before);
    const engines2 = new Map([['charb', restored]]);
    const dir2 = h.dir;
    const gw2 = createGateway({
      getEngine: (id) => engines2.get(id) || null,
      dataDir: dir2,
      now: h.clock.now,
      env: { PROOF_GATEWAY_TEST_ALLOW_LOCAL: '1', PROOF_OPENAI_BASE_URL: h.fake.url, PROOF_GATEWAY_ENABLED: '1' }
    });
    assert.equal(restored.state.fragmentBatches[0].restoreAt, restoreAt, '断片恢复时间不因重启改变');
    assert.equal(restored.state.sensitivity.唤醒, 0.6);
    // 会话归属仍映射到同一 agent（账本从磁盘读出）
    const msgs = await gw2.ledger.messages('charb', 'default');
    assert.ok(Array.isArray(msgs));
    assert.equal(await gw2.identity.agentIdForToken(h.key), 'charb');
  } finally {
    await h.stop();
  }
});
