// Provider 适配（里程碑 2）测试：透明透传、注入并入、硬过滤落各 provider 形状、tool 组。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../gateway/ledger.mjs';
import {
  buildOpenAiChatBody,
  buildOpenAiResponsesBody,
  buildAnthropicBody,
  openAiResponsesManaged,
  AGENT_STATE_USE_POLICY
} from '../gateway/adapters.mjs';
import { freshEngine, openBlackout, pushOnly, T0, H } from './lib/gatewayEngine.mjs';
import { makeTempDir, removeTempDir } from './lib/gatewayEnv.mjs';

async function withLedger(fn) {
  const dir = await makeTempDir('gw-ad-');
  const ledger = createLedger({ dataDir: dir, now: () => T0 + 60_000 });
  try {
    return await fn({ ledger });
  } finally {
    await removeTempDir(dir);
  }
}

test('OA1 Chat 透明透传：未知字段/tools 原样保留；无状态时不增删内容', async () => {
  await withLedger(async ({ ledger }) => {
    const engine = freshEngine();
    engine.setStateInjection(true);
    const body = {
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: '你好' }
      ],
      tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
      temperature: 0.7,
      x_unknown: { keep: true }
    };
    const { body: out, res } = await buildOpenAiChatBody({
      engine, agentId: 'charb', now: T0, body, ledger, conversationId: 'c1', requestId: 'r1'
    });
    assert.equal(res.active, false);
    assert.deepEqual(out.messages, body.messages, '无状态不增删消息');
    assert.deepEqual(out.tools, body.tools);
    assert.equal(out.tool_choice, 'auto');
    assert.equal(out.temperature, 0.7);
    assert.deepEqual(out.x_unknown, { keep: true });
    assert.equal(out.model, 'gpt-5');
  });
});

test('OA2 Chat 有状态：原始 system/历史前缀不变，状态追加在当前 user 尾部', async () => {
  await withLedger(async ({ ledger }) => {
    const engine = freshEngine();
    pushOnly(engine, T0);
    engine.setStateInjection(true);
    const body = { model: 'm', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: '再来' }] };
    const one = await buildOpenAiChatBody({ engine, agentId: 'charb', now: T0 + 60_000, body, ledger, conversationId: 'c1', requestId: 'r1' });
    assert.equal(one.res.injected, true);
    assert.deepEqual(one.body.messages[0], body.messages[0], '既有 system 字节不改写');
    assert.equal(one.body.messages.at(-1).role, 'user');
    assert.ok(one.body.messages.at(-1).content.startsWith('再来\n'), '用户原文保持在动态尾部之前');
    assert.ok(one.body.messages.at(-1).content.includes('[Proof 状态]'), '动态上下文追加到当前 user 尾部');
    assert.equal((JSON.stringify(one.body).match(/\[Proof 状态\]/g) || []).length, 1, '同一请求只注入一次');

    const body2 = { model: 'm', messages: [body.messages[0], body.messages[1], { role: 'assistant', content: '好' }, { role: 'user', content: '继续' }] };
    const two = await buildOpenAiChatBody({ engine, agentId: 'charb', now: T0 + 60_000, body: body2, ledger, conversationId: 'c1', requestId: 'r2' });
    assert.ok(two.body.messages[1].content.includes('[Proof 状态]'), '旧状态快照补回原历史消息');
    assert.equal(two.body.messages.at(-1).content, '继续', '状态文本未变时本轮零重复注入');
    assert.equal((JSON.stringify(two.body).match(/\[Proof 状态\]/g) || []).length, 1, '历史里只保留一次状态快照');
  });
});

test('OA3 Chat 硬过滤：窗口内历史成组**完全移除**（真实遮蔽），尾部与 system 保留', async () => {
  await withLedger(async ({ ledger }) => {
    const engine = freshEngine();
    openBlackout(engine, T0);
    // 本用例只钉“硬过滤”，隔离自动投递（默认开）的影响：
    engine.setStateInjection(false);
    await ledger.register('charb', 'c1', { role: 'user', content: '嗨', at: T0 });
    await ledger.register('charb', 'c1', { role: 'assistant', content: '嗨，喝点什么', at: T0 });

    const body = {
      model: 'm',
      messages: [
        { role: 'system', content: '酒保设定' },
        { role: 'user', content: '嗨' },
        { role: 'assistant', content: '嗨，喝点什么' },
        { role: 'user', content: '来杯水' }
      ]
    };
    const { body: out } = await buildOpenAiChatBody({
      engine, agentId: 'charb', now: T0 + 60_000, body, ledger, conversationId: 'c1', requestId: 'r2'
    });
    const roles = out.messages.map((m) => m.role);
    assert.equal(out.messages[0].content, '酒保设定');
    assert.equal(out.messages.length, 2, '窗口内整段完全移除，不留占位');
    assert.equal(roles[1], 'user');
    assert.equal(out.messages[1].content, '来杯水');
    assert.equal(JSON.stringify(out.messages).includes('[Proof 断片]'), false, '无原位占位');
    assert.ok(!out.messages.some((m) => m.content === '嗨，喝点什么' || m.content === '嗨'), '窗口内原文不得透传');
  });
});

test('OA4 Responses：function_call+function_call_output 成组，注入进 instructions，managed 检测', async () => {
  await withLedger(async ({ ledger }) => {
    const engine = freshEngine();
    pushOnly(engine, T0);
    engine.setStateInjection(true);
    const body = {
      model: 'gpt-5',
      input: [
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: '设定' }] },
        { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
        { type: 'function_call_output', call_id: 'call_1', output: '{"r":1}' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: '继续' }] }
      ]
    };
    const { body: out } = await buildOpenAiResponsesBody({
      engine, agentId: 'charb', now: T0 + 60_000, body, ledger, conversationId: 'c1', requestId: 'r3'
    });
    assert.equal(out.instructions.includes('[Proof 状态]'), true);
    assert.equal(out.input.length, 4, '无断片时不摘除');
    assert.equal(out.input[1].call_id, 'call_1');
    assert.ok(openAiResponsesManaged({ ...body, previous_response_id: 'resp_1' }), 'previous_response_id 触发 managed');
    assert.equal(openAiResponsesManaged(body), false);
  });
});

test('OA5 Responses 硬过滤：函数调用组整体摘除 + user 占位', async () => {
  await withLedger(async ({ ledger }) => {
    const engine = freshEngine();
    openBlackout(engine, T0);
    // 与 Responses function_call 的 contentOf（arguments）保持一致，才能命中账本
    await ledger.register('charb', 'c1', { role: 'assistant', content: '{"q":"a"}', at: T0 });
    const body = {
      model: 'm',
      input: [
        { type: 'function_call', call_id: 'call_9', name: 'lookup', arguments: '{"q":"a"}' },
        { type: 'function_call_output', call_id: 'call_9', output: '1' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: '新问题' }] }
      ]
    };
    const { body: out } = await buildOpenAiResponsesBody({
      engine, agentId: 'charb', now: T0 + 60_000, body, ledger, conversationId: 'c1', requestId: 'r4'
    });
    // 尾部 user 保留；函数调用组被**完全移除**（真实遮蔽，无占位）
    assert.equal(out.input.length, 1);
    assert.equal(out.input[0].content[0].text, '新问题');
    assert.equal(JSON.stringify(out.input).includes('function_call'), false);
    assert.equal(JSON.stringify(out.input).includes('"lookup"'), false);
  });
});

test('OA6 Anthropic：tool_result 用户消息映射为 tool 并入组；注入并进 system；无连续 assistant', async () => {
  await withLedger(async ({ ledger }) => {
    const engine = freshEngine();
    openBlackout(engine, T0);
    engine.setStateInjection(true);
    const assistantContent = [
      { type: 'text', text: '我来查。' },
      { type: 'tool_use', id: 'tu1', name: 'lookup', input: { q: 'x' } }
    ];
    await ledger.register('charb', 'c1', { role: 'assistant', content: assistantContent, at: T0 });
    const body = {
      model: 'claude-x',
      system: '你是一本正经的酒保。',
      messages: [
        { role: 'user', content: '查一下' },
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '结果1' }] },
        { role: 'assistant', content: '结果是 1。' },
        { role: 'user', content: '那继续。' }
      ]
    };
    const { body: out } = await buildAnthropicBody({
      engine, agentId: 'charb', now: T0 + 60_000, body, ledger, conversationId: 'c1', requestId: 'r5'
    });
    // 注入并入 system（前缀保留）；工具组隐藏 → 占位 user；其后 assistant 保留
    assert.equal(out.system.startsWith(`你是一本正经的酒保。\n${AGENT_STATE_USE_POLICY}`), true, `system=${JSON.stringify(out.system)}`);
    const policyIdx = out.system.indexOf(AGENT_STATE_USE_POLICY);
    const stateIdx = out.system.indexOf('[Proof 状态]');
    assert.ok(policyIdx >= 0 && stateIdx > policyIdx, 'host policy 在稳定前缀，且位于 [Proof 状态] 之前');
    assert.equal(out.system.slice(stateIdx).includes(AGENT_STATE_USE_POLICY), false, 'host policy 不得进入 [Proof 状态]');
    const roles = out.messages.map((m) => m.role);
    for (let i = 1; i < roles.length; i += 1) {
      assert.ok(!(roles[i - 1] === 'assistant' && roles[i] === 'assistant'), '不得出现连续 assistant');
    }
    assert.ok(!out.messages.some((m) => JSON.stringify(m.content).includes('我来查。')), '窗口内原文不透传');
    assert.ok(!out.messages.some((m) => JSON.stringify(m.content).includes('tool_use') || JSON.stringify(m.content).includes('tool_result')), '工具组整体移除');
    assert.equal(out.messages.at(-1).content, '那继续。');
    assert.equal(JSON.stringify(out.messages).includes('[Proof 断片]'), false, '无原位占位');
  });
});

test('OA7 Anthropic 无断片透传：system blocks/multimodal 原样保留', async () => {
  await withLedger(async ({ ledger }) => {
    const engine = freshEngine();
    const body = {
      model: 'claude-x',
      system: [{ type: 'text', text: '设定' }],
      messages: [
        { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }] },
        { role: 'user', content: '看到了吗' }
      ],
      max_tokens: 128,
      x_meta: 42
    };
    const { body: out } = await buildAnthropicBody({
      engine, agentId: 'charb', now: T0, body, ledger, conversationId: 'c1', requestId: 'r6'
    });
    assert.equal(out.messages.length, 2);
    assert.equal(out.messages[0].content[0].type, 'image');
    assert.equal(out.max_tokens, 128);
    assert.equal(out.x_meta, 42);
    assert.ok(Array.isArray(out.system));
  });
});
