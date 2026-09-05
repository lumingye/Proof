// Gateway token → agentId 身份映射（提交 4）。
//
// 规则（contracts §2）：
//  - agentId 只从已认证的 Gateway token 推导；body/query/header 自填 agentId 不可信；
//  - 每个 token 唯一绑定一个 agentId；不同 Agent 之间互不可见；
//  - 匿名默认拒绝（由调用方对空结果返回 401）；
//  - 映射文件只存 token 的 SHA-256，不存原文；原文 token 写入 0600 的 *.gateway-token 文件供运维下发；
//  - 拒绝路径穿越式 agentId（白名单字符集，禁止 '/'、'\\'、'..'）。
//
// 本模块不读引擎、不复制任何生理/断片状态。持久化仅此一张最小映射。

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from '../lib/atomicWrite.mjs';

export const IDENTITY_FILE = 'gateway-identity.json';
export const AGENT_ID_RE = /^[A-Za-z0-9_.:-]+$/;

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function assertValidAgentId(agentId) {
  if (typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId) || agentId.includes('..')) {
    throw Object.assign(new Error('invalid_agent_id'), { status: 400 });
  }
  return agentId;
}

export function newGatewayToken() {
  return randomBytes(32).toString('base64url');
}

export function createIdentity({ dataDir, now = () => Date.now() } = {}) {
  if (!dataDir) throw new Error('gateway_identity_data_dir_required');
  const nowFn = typeof now === 'function' ? now : () => Number(now);
  const file = join(dataDir, IDENTITY_FILE);
  let cache = null;

  async function load() {
    if (cache) return cache;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (raw.version !== 1 || !raw.entries || typeof raw.entries !== 'object') {
        throw new Error('gateway_identity_bad_file');
      }
      cache = {
        entries: new Map(Object.entries(raw.entries)),
        createdAt: raw.createdAt ?? nowFn()
      };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.message !== 'gateway_identity_bad_file') throw error;
      cache = { entries: new Map(), createdAt: nowFn() };
    }
    return cache;
  }

  async function save() {
    const state = await load();
    const payload = {
      version: 1,
      createdAt: state.createdAt,
      entries: Object.fromEntries([...state.entries].map(([agentId, rec]) => [agentId, rec]))
    };
    await atomicWriteFile(file, `${JSON.stringify(payload, null, 2)}\n`);
  }

  /** 幂等发放：已存在则返回既有 token（不换）。写 0600 原文文件供运维读取。 */
  async function ensure(agentId) {
    assertValidAgentId(agentId);
    const state = await load();
    const existing = state.entries.get(agentId);
    let token = null;
    if (existing) {
      // 映射只存哈希；幂等语义靠回读原文 token 文件维持（不回读即每次都是新 token）。
      try {
        token = (await readFile(join(dataDir, `${agentId}.gateway-token`), 'utf8')).trim() || null;
      } catch {
        token = null;
      }
    }
    if (!token) {
      token = newGatewayToken();
      state.entries.set(agentId, { tokenHash: hashToken(token), createdAt: nowFn() });
      await save();
      await atomicWriteFile(join(dataDir, `${agentId}.gateway-token`), `${token}\n`);
    }
    return { agentId, token };
  }

  async function rotate(agentId) {
    assertValidAgentId(agentId);
    const state = await load();
    const token = newGatewayToken();
    state.entries.set(agentId, { tokenHash: hashToken(token), createdAt: nowFn() });
    await save();
    await atomicWriteFile(join(dataDir, `${agentId}.gateway-token`), `${token}\n`);
    return { agentId, token };
  }

  /** 常量时间比对；命中返回 agentId，否则 null。 */
  async function agentIdForToken(token) {
    if (!token) return null;
    const state = await load();
    const candidate = Buffer.from(hashToken(token));
    for (const [agentId, record] of state.entries) {
      const expected = Buffer.from(record.tokenHash);
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return agentId;
    }
    return null;
  }

  async function list() {
    const state = await load();
    return [...state.entries.keys()].sort();
  }

  async function has(agentId) {
    const state = await load();
    return state.entries.has(agentId);
  }

  return { ensure, rotate, agentIdForToken, list, has, file };
}

export default { createIdentity, hashToken, newGatewayToken, assertValidAgentId, AGENT_ID_RE };
