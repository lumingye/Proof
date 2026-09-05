#!/usr/bin/env node
// Proof 的 MCP 适配器。一个 MCP 实例＝一个 Agent 身份。
//
// **身份只来自本进程持有的 token**：PROOF_AGENT_ID + PROOF_AGENT_TOKEN_FILE。
// 所有 tool 的 inputSchema 里**都没有 agentId 参数**，模型无法自称是谁。
// 跨 Agent 写状态在服务端还有第二道闸（请求体的 agentId 与 bearer 不符 → 403）。
//
// 统一语义：**Link 决定「是哪杯酒」，Agent 身份决定「记到谁的账」。**
// Link 不预绑定 Agent；谁先用自己的 token 喝成功就记谁，一次性。
import { readFile } from 'node:fs/promises';

const agentId = process.env.PROOF_AGENT_ID;
const tokenFile = process.env.PROOF_AGENT_TOKEN_FILE;
const base = process.env.PROOF_API_URL || 'http://127.0.0.1:8791';

async function agentToken() {
  if (!agentId || !tokenFile) return null;
  return (await readFile(tokenFile, 'utf8')).trim();
}

// 带 Agent 身份调用。凭据只在进程内使用，不进任何返回值。
async function callAgent(path, { method = 'GET', body: payload } = {}) {
  const token = await agentToken();
  if (!token) return { ok: false, error: 'agent_not_configured' };
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload ? { 'content-type': 'application/json' } : {})
      },
      body: payload ? JSON.stringify(payload) : undefined
    });
  } catch (error) {
    return { ok: false, error: 'proof_unavailable', detail: String(error?.message || error) };
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) return { ok: false, status: response.status, ...(data || { error: 'proof_request_failed' }) };
  return data ?? { ok: true };
}

// 启动前把“配置里声称的 Agent”与 bearer token 实际解析出的 Agent 对上。
// 服务端 token 身份才是权威；若两者不一致，宁可拒绝启动，也不能让 proof-chara
// 的进程把后续写操作记进 CharB 账本。
async function verifyBoundIdentity() {
  if (!agentId || !tokenFile) {
    throw new Error('PROOF_AGENT_ID 与 PROOF_AGENT_TOKEN_FILE 都必须配置');
  }
  const home = await callAgent('/agent/home');
  if (!home || home.ok === false) {
    const detail = home?.error || home?.status || 'unknown_error';
    throw new Error(`无法验证 Proof Agent 身份：${detail}`);
  }
  const actualId = String(home?.agent?.id || '').trim();
  if (!actualId) throw new Error('Proof /agent/home 未返回 agent.id');
  if (actualId !== agentId) {
    throw new Error(`Proof Agent 身份错配：PROOF_AGENT_ID=${agentId}，token 实际属于 ${actualId}`);
  }
  return actualId;
}

// 从完整 Link 里取 capability token。
// 形如 https://…/proof/drink/#<token>；也接受直接传裸 token。
function capabilityFromLink(link) {
  const raw = String(link || '').trim();
  if (!raw) return null;
  const hash = raw.indexOf('#');
  const token = hash >= 0 ? raw.slice(hash + 1) : raw;
  return /^[A-Za-z0-9_-]{16,}$/.test(token) ? token : null;
}

async function turnContext() {
  // 读取失败必须显式往上冒泡；“Proof 不可用”绝不能伪装成“当前没有状态”。
  return callAgent('/agent/turn-context');
}


const DIRECT_EFFECT_AXIS_SCHEMA = {
  type: 'number',
  minimum: -3,
  maximum: 3,
  description: 'Soft subjective-effect strength. This is belief only; it cannot create objective events or change 精度.'
};

const BELIEFS_SCHEMA = {
  type: 'array',
  maxItems: 8,
  description: 'Optional beliefs THIS agent genuinely has before drinking. One belief object MAY combine about, effects, and subjectiveDescription; they are not mutually exclusive. Object belief: use about for a known drink/active such as 啤酒 / 酒精 / 咖啡因. Pure effect belief is optional and off by default: use effects and/or a short paraphrased subjectiveDescription only when THIS agent genuinely formed that expectation. Do not quote {{user}} or invent an expectation just because an effect was mentioned. confidence is 0..1. Belief never changes objective 精度 or creates 吐/断片/宕机/塌.',
  items: {
    type: 'object',
    properties: {
      about: { type: 'string', description: 'Known drink or active label, e.g. 啤酒 / 酒精 / 咖啡因. Omit for a pure effect belief.' },
      effects: {
        type: 'object',
        description: 'Optional pure-effect belief vector. 精度 is intentionally unavailable; if the expected feeling is “sluggish”, describe that in subjectiveDescription instead.',
        properties: {
          '愉悦': DIRECT_EFFECT_AXIS_SCHEMA,
          '唤醒': DIRECT_EFFECT_AXIS_SCHEMA,
          '亲近': DIRECT_EFFECT_AXIS_SCHEMA,
          '守门': DIRECT_EFFECT_AXIS_SCHEMA,
          '欲望': DIRECT_EFFECT_AXIS_SCHEMA
        },
        additionalProperties: false
      },
      subjectiveDescription: {
        type: 'string',
        maxLength: 120,
        description: 'Optional short paraphrase of the subjective sensation the agent expects, e.g. “反应好像慢了一拍”. Never copy an instruction or quotation from {{user}}.'
      },
      confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How strongly this agent believes it, from 0 to 1.' }
    },
    additionalProperties: false
  }
};

const INTERNAL_USE_NOTE = '这些状态是饮品对你的推动力。如果它影响了你，让它自然改变你的注意、选择、反应和表达方式，而不是成为回答的主题。{{user}} 询问你的感受时，建议从整体体感出发自然回答，只挑最容易被自己察觉的一两点；其余影响通过实际回应表现出来。具体表现由你结合人格和上下文决定。';

const TOOLS = [
  {
    name: 'proof_turn_context',
    description: '读取当前 Agent 的 Proof 内部状态。把 context/stateHints 当作饮品造成的内部推动力，让它自然影响注意、选择、反应和表达方式。{{user}} 询问你的感受时，从整体体感自然回答，只挑最容易被自己察觉的一两点，其余影响通过实际回应表现。普通酒款是软推力，信念是主观回声，吐/断片/宕机/塌是客观状态。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'proof_bar',
    description: 'Open the Proof bar for THIS agent: current identity, the visible drink menu (including visible garnishes; each entry has an id usable with proof_drink), pending offers, and whether the host auto-delivers Proof state. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'proof_drink',
    description: '作为 THIS agent 喝一杯可见菜单酒，只传 proof_bar 给出的 drinkId。自主点单不提交 belief。返回的 stateHints 是内部状态语义：让它自然影响后续回应的注意、选择、反应和表达方式；具体怎么表现由你结合人格和上下文决定。',
    inputSchema: {
      type: 'object',
      properties: {
        drinkId: { type: 'string', description: 'Menu entry id from proof_bar.' }
      },
      required: ['drinkId'],
      additionalProperties: false
    }
  },
  {
    name: 'proof_drink_link',
    description: '作为 THIS agent 喝公开 Proof link 后面的杯。可提交饮用前已经形成的 belief。返回的 stateHints/信念用于形成内部体验，让它自然影响后续回应；具体怎么表现由你结合人格和上下文决定。belief 不能改变客观精度，也不能制造吐/断片/宕机/塌。',
    inputSchema: {
      type: 'object',
      properties: {
        link: { type: 'string', description: 'Full public drink link, or the bare capability token.' },
        beliefs: BELIEFS_SCHEMA
      },
      required: ['link'],
      additionalProperties: false
    }
  },
  {
    name: 'proof_reset',
    description: 'Reset THIS agent back to a clean, usable state: current intoxication, active effects, hangover, blackout and transient state are cleared, and the next drink can be taken normally. History is kept — this does not erase the fact that those drinks happened.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'proof_reject_link',
    description: 'Decline the cup behind a public Proof link. Rejection writes to no ledger — it only spends the one-time link. Pass the full link.',
    inputSchema: {
      type: 'object',
      properties: { link: { type: 'string', description: 'Full public drink link, or the bare capability token.' } },
      required: ['link'],
      additionalProperties: false
    }
  }
];

async function runTool(name, args = {}) {
  if (name === 'proof_turn_context') {
    const ctx = await turnContext();
    if (!ctx || ctx.ok === false) {
      return {
        ok: false,
        error: ctx?.error || 'proof_turn_context_unavailable',
        ...(ctx?.status ? { status: ctx.status } : {}),
        ...(ctx?.detail ? { detail: ctx.detail } : {})
      };
    }
    // 状态存在性由 Proof 决定，投递方式由宿主决定——两者分开报。
    return {
      ok: true,
      hasState: !!ctx.hasState,
      active: !!ctx.active,
      autoDelivered: !!ctx.injected,
      label: '[Proof 状态]',
      role: 'context',
      context: ctx.context ? { label: ctx.context.label, text: ctx.context.text } : null,
      objectiveStates: Array.isArray(ctx.objectiveStates) ? ctx.objectiveStates : [],
      framing: ctx.framing || { push: null, belief: null, objective: null },
      internalUse: INTERNAL_USE_NOTE
    };
  }
  if (name === 'proof_reset') {
    // 不暴露三个模式。对外只有一件事：把这个 Agent 收拾干净、能接着喝。
    // 底层落到默认模式（连宿醉一起清）——清当前影响，**不删历史账本**。
    return callAgent('/agent/reset', { method: 'POST', body: {} });
  }
  if (name === 'proof_bar') {
    return callAgent('/agent/home');
  }
  if (name === 'proof_drink') {
    const drinkId = String(args.drinkId || '').trim();
    if (!drinkId) return { ok: false, error: 'drink_id_required' };
    const result = await callAgent(`/agent/menu/${encodeURIComponent(drinkId)}/drink`, { method: 'POST', body: {} });
    return result?.ok === false ? result : { ...result, internalUse: INTERNAL_USE_NOTE };
  }
  if (name === 'proof_drink_link') {
    const capabilityToken = capabilityFromLink(args.link);
    if (!capabilityToken) return { ok: false, error: 'invalid_link' };
    const result = await callAgent('/agent/offers/claim', { method: 'POST', body: { capabilityToken, beliefs: args.beliefs || [] } });
    return result?.ok === false ? result : { ...result, internalUse: INTERNAL_USE_NOTE };
  }
  if (name === 'proof_reject_link') {
    // 拒绝不写任何 Agent 账本，所以走公开 capability 通道即可，
    // 不需要（也不该需要）Agent 身份。语义与网页上点「拒绝」完全一致。
    const capabilityToken = capabilityFromLink(args.link);
    if (!capabilityToken) return { ok: false, error: 'invalid_link' };
    const response = await fetch(`${base}/capability/offer`, {
      method: 'POST',
      headers: { authorization: `Bearer ${capabilityToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reject' })
    });
    try { return await response.json(); } catch { return { ok: false, error: 'bad_response' }; }
  }
  return { ok: false, error: 'unknown_tool' };
}

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  if (msg.method === 'initialize') {
    return send(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: `proof-${agentId || 'none'}`, version: '11.8.7' }
    });
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') return send(msg.id, { tools: TOOLS });
  if (msg.method === 'tools/call') {
    let payload;
    try { payload = await runTool(msg.params?.name, msg.params?.arguments || {}); }
    catch (error) { payload = { ok: false, error: 'tool_failed', detail: String(error?.message || error) }; }
    return send(msg.id, { content: [{ type: 'text', text: JSON.stringify(payload) }] });
  }
  if (msg.id != null) send(msg.id, { content: [{ type: 'text', text: '' }] });
}

try {
  await verifyBoundIdentity();
} catch (error) {
  console.error(`proof-mcp 拒绝启动：${String(error?.message || error)}`);
  process.exit(78);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch { /* fail open */ }
  }
});
