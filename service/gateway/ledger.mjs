// Conversation 消息时间账本（提交 5 / contracts §4）。
//
// 解决的问题：OpenAI/Anthropic 的普通 messages[] 没有可信时间戳，
// 网关必须自己记住「这条消息最早什么时候见过」，硬断片才可能按时间窗口判定。
//
// 设计（最小数据）：
//  - 默认不保存正文；只保存正文摘要 + 角色 + 出现序号 + 首次出现时间；
//  - messageFingerprint = sha256(规范化角色 | 正文摘要 | occurrenceIndex)；
//  - 相同文本多次出现用 occurrenceIndex 区分（登记时按 (role, contentHash) 在该会话内累计）；
//  - 当前请求新追加的尾部消息 firstSeenAt=now；重试同一请求（同 requestId）不重复登记；
//  - conversationId 按 Agent 隔离，禁止穿越字符；缺失时用 'default' 单会话降级；
//  - 写入走原子写；进程重启后指纹/时间仍可匹配。
//
// 不读取引擎状态：断片窗口判定在 transform.mjs 里结合 engine.state.fragmentBatches 完成。

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from '../lib/atomicWrite.mjs';

export const LEDGER_FILE = 'gateway-ledger.json';
export const LEDGER_VERSION = 1;
export const DEFAULT_CONVERSATION = 'default';
const ID_RE = /^[A-Za-z0-9_.:-]+$/;

function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

/** 正文摘要：字符串直接摘；结构内容（数组/对象，含多模态块）先规范化再摘。 */
export function contentHashOf(content) {
  if (typeof content === 'string') return sha256(`s:${content}`);
  try {
    return sha256(`j:${JSON.stringify(content)}`);
  } catch {
    return sha256(`s:${String(content)}`);
  }
}

export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'developer' || r === 'system') return 'system';
  if (r === 'tool') return 'tool';
  if (r === 'user') return 'user';
  if (r === 'assistant') return 'assistant';
  return r || 'unknown';
}

export function fingerprintOf({ role, contentHash, occurrenceIndex }) {
  return sha256(`${normalizeRole(role)}|${contentHash}|${Number(occurrenceIndex) || 0}`);
}

export function assertConversationId(id) {
  if (id == null) return DEFAULT_CONVERSATION;
  if (typeof id !== 'string' || !ID_RE.test(id) || id.includes('..')) {
    throw Object.assign(new Error('invalid_conversation_id'), { status: 400 });
  }
  return id;
}

export function createLedger({ dataDir, now = () => Date.now() } = {}) {
  if (!dataDir) throw new Error('gateway_ledger_data_dir_required');
  const nowFn = typeof now === 'function' ? now : () => Number(now);
  const file = join(dataDir, LEDGER_FILE);
  let cache = null;
  // 同一进程内并发写同一文件时，Windows rename 会 EPERM：写盘串行化。
  let writeQueue = Promise.resolve();

  function convKey(agentId, conversationId) {
    if (typeof agentId !== 'string' || !ID_RE.test(agentId)) {
      throw Object.assign(new Error('invalid_agent_id'), { status: 400 });
    }
    return `${agentId}__${assertConversationId(conversationId)}`;
  }

  async function load() {
    if (cache) return cache;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (raw.version !== LEDGER_VERSION || !raw.conversations || typeof raw.conversations !== 'object') {
        throw new Error('gateway_ledger_bad_file');
      }
      cache = { conversations: raw.conversations, createdAt: raw.createdAt ?? nowFn(), lastPruneAt: raw.lastPruneAt ?? 0 };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.message !== 'gateway_ledger_bad_file') throw error;
      cache = { conversations: {}, createdAt: nowFn(), lastPruneAt: 0 };
    }
    return cache;
  }

  async function save() {
    const state = await load();
    const payload = {
      version: LEDGER_VERSION,
      createdAt: state.createdAt,
      lastPruneAt: state.lastPruneAt ?? 0,
      conversations: state.conversations
    };
    const snapshot = `${JSON.stringify(payload, null, 2)}\n`;
    writeQueue = writeQueue.then(() => atomicWriteFile(file, snapshot));
    return writeQueue;
  }

  function conversationRef(agentId, conversationId) {
    const key = convKey(agentId, conversationId);
    const record = cache.conversations[key] || {
      agentId,
      conversationId: assertConversationId(conversationId),
      createdAt: nowFn(),
      updatedAt: nowFn(),
      messages: [],
      seenRequestIds: [],
      // 断片恢复：已发射块的**标记**（fragmentId/stage/source/at/digest），
      // 顺序稳定；正文永不落盘，内容每轮由 transform 从权威源重渲染。
      recoveries: []
    };
    cache.conversations[key] = record;
    return record;
  }

  /**
   * 登记一条消息。返回 { entry, appended, occurrenceIndex }。
   * 幂等：同一 (agentId, conversationId, requestId) 重复调用直接跳过（契约：重试不重复登记）。
   */
  async function register(agentId, conversationId, {
    role, content, at, provider = null, requestId = null, occurrenceIndex: forced
  } = {}) {
    const conv = assertConversationId(conversationId);
    const key = convKey(agentId, conv);
    await load();
    const ref = conversationRef(agentId, conv);
    const now = Number.isFinite(Number(at)) ? at : nowFn();

    if (requestId != null && ref.seenRequestIds.includes(requestId)) {
      const previous = ref.messages.find((m) => m.requestId === requestId);
      if (previous) return { entry: previous, appended: false, duplicate: true };
    }
    if (requestId != null) ref.seenRequestIds.push(requestId);

    const contentHash = contentHashOf(content);
    const roleNorm = normalizeRole(role);
    const occurrenceIndex = forced != null
      ? Number(forced)
      : ref.messages.filter((m) => m.role === roleNorm && m.contentHash === contentHash).length;
    const fp = fingerprintOf({ role: roleNorm, contentHash, occurrenceIndex });
    const existing = ref.messages.find((m) => m.fp === fp);
    if (existing) return { entry: existing, appended: false, duplicate: true };

    const entry = {
      agentId,
      conversationId: conv,
      fp,
      role: roleNorm,
      contentHash,
      occurrenceIndex,
      firstSeenAt: now,
      provider,
      requestId: requestId ?? null
    };
    ref.messages.push(entry);
    ref.updatedAt = now;
    await save();
    return { entry, appended: true, occurrenceIndex };
  }

  /** 依据（role, contentHash）在该会话里找第 occurrenceIndex 次出现的登记，命中给 firstSeenAt。 */
  async function lookup(agentId, conversationId, { role, contentHash, occurrenceIndex = 0 } = {}) {
    const conv = assertConversationId(conversationId);
    await load();
    const record = cache.conversations[convKey(agentId, conv)];
    if (!record) return null;
    const matches = record.messages.filter((m) => m.role === normalizeRole(role) && m.contentHash === contentHash);
    return matches[Number(occurrenceIndex) || 0] || null;
  }

  async function messages(agentId, conversationId) {
    const conv = assertConversationId(conversationId);
    await load();
    const record = cache.conversations[convKey(agentId, conv)];
    return record ? [...record.messages] : [];
  }

  /**
   * 给已登记的当前消息附上 Proof 自己生成的上下文快照。
   * 这里只允许保存 Proof 文本；用户正文仍只有不可逆摘要。
   */
  async function setProofContext(agentId, conversationId, requestId, text) {
    const conv = assertConversationId(conversationId);
    await load();
    const record = cache.conversations[convKey(agentId, conv)];
    const entry = record?.messages.find((m) => m.requestId === requestId);
    if (!entry) return null;
    entry.proofContext = String(text);
    entry.proofContextHash = sha256(text);
    record.updatedAt = nowFn();
    await save();
    return entry;
  }

  async function latestProofContext(agentId, conversationId) {
    const all = await messages(agentId, conversationId);
    for (let i = all.length - 1; i >= 0; i -= 1) {
      if (all[i].proofContextHash) return all[i];
    }
    return null;
  }

  async function conversations(agentId) {
    await load();
    const prefix = `${agentId}__`;
    return Object.entries(cache.conversations)
      .filter(([key, record]) => key.startsWith(prefix) && record.agentId === agentId)
      .map(([, record]) => ({
        conversationId: record.conversationId,
        messageCount: record.messages.length,
        updatedAt: record.updatedAt
      }))
      .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  }

  async function conversationCount(agentId) {
    return (await conversations(agentId)).length;
  }

  /** 丢弃整段会话（reset/关闭断片时由 transform 决定是否保留账本时间；此方法供运维）。 */
  async function dropConversation(agentId, conversationId) {
    const conv = assertConversationId(conversationId);
    await load();
    delete cache.conversations[convKey(agentId, conv)];
    await save();
  }

  /** 按 requestId 移除登记（用于上游失败/拒绝时收回尾部登记，避免污染账本）。 */
  async function removeByRequestId(agentId, conversationId, requestId) {
    const conv = assertConversationId(conversationId);
    await load();
    const record = cache.conversations[convKey(agentId, conv)];
    if (!record) return 0;
    const before = record.messages.length;
    record.messages = record.messages.filter((m) => m.requestId !== requestId);
    record.seenRequestIds = record.seenRequestIds.filter((id) => id !== requestId);
    record.updatedAt = nowFn();
    await save();
    return before - record.messages.length;
  }

  /**
   * 当前会话已发射的恢复标记（有序、稳定）。
   *
   * **只有标记，没有正文**：恢复块的内容每轮由 transform 从权威源重新渲染，
   * 账本只记住「哪个片段的第几段、以什么源、在什么时候发射过」，用于幂等与顺序。
   * digest 是渲染结果的 sha256（与消息 contentHash 同一手法），不是正文，也不可逆。
   */
  async function recoveries(agentId, conversationId) {
    const conv = assertConversationId(conversationId);
    await load();
    const record = cache.conversations[convKey(agentId, conv)];
    return record ? [...(record.recoveries || [])] : [];
  }

  /**
   * 追加一条恢复标记（按 key 幂等；key = `${fragmentId}#${stage}`）。
   * 不接受也不保存任何正文字段——传入 text 会被显式拒绝，防止调用方误存。
   */
  async function appendRecovery(agentId, conversationId, marker = {}) {
    const { key, fragmentId = null, stage = 1, source = 'proof', at, count = 0, digest = null } = marker;
    const conv = assertConversationId(conversationId);
    await load();
    const ref = conversationRef(agentId, conv);
    if (!key) throw new Error('recovery_key_required');
    // 硬约束：账本永不落正文。调用方误传 text 直接报错，避免悄悄退化成第二份 transcript。
    if (Object.prototype.hasOwnProperty.call(marker, 'text')) {
      throw new Error('recovery_ledger_must_not_store_text');
    }
    if ((ref.recoveries || []).some((r) => r.key === key)) return { appended: false, duplicate: true };
    const entry = {
      key: String(key),
      fragmentId: fragmentId == null ? String(key) : String(fragmentId),
      stage: Number(stage) || 1,
      source: source === 'raw' ? 'raw' : 'proof',
      count: Number(count) || 0,
      digest: digest ? String(digest) : null,
      at: Number.isFinite(at) ? at : nowFn()
    };
    ref.recoveries = [...(ref.recoveries || []), entry];
    ref.updatedAt = nowFn();
    await save();
    return { appended: true, entry };
  }

  async function prune({ retentionMs = 30 * 24 * 3600_000, now: at } = {}) {
    const ref = Number.isFinite(at) ? at : nowFn();
    await load();
    let dropped = 0;
    for (const [key, record] of Object.entries(cache.conversations)) {
      if (ref - Number(record.updatedAt || 0) > retentionMs) {
        delete cache.conversations[key];
        dropped += 1;
      }
    }
    cache.lastPruneAt = ref;
    if (dropped) await save();
    return { dropped };
  }

  return { register, lookup, messages, setProofContext, latestProofContext, conversations, conversationCount, dropConversation, removeByRequestId, recoveries, appendRecovery, prune, file };
}

export { sha256 };
export default { createLedger, contentHashOf, fingerprintOf, normalizeRole, DEFAULT_CONVERSATION };
