import http from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProofEngine, buildFromParts, ingredients, menu, realPack, sanitizeClaimedName, sanitizeIntro, sanitizeFinish, assembleEffectDescription, assembleFlavorDescription, publicEffectDescription, createTurnBridge, resolveLifecycleConfig, isReservedHiddenName, normalizeGarnishes, buildAgentTurnContext, STATE_FRAME_NOTE, DETERMINISTIC_EFFECT_FRAME_NOTE, OBJECTIVE_EFFECT_FRAME_NOTE, BELIEF_EFFECT_FRAME_NOTE, sanitizeSubjectiveBelief, buildAgentStateHints, projectAgentObjectiveStates } from '../engine/src/index.js';
import { hashUnit, HIDDEN_DRAW_P } from '../engine/src/core/hiddenDraw.js';
import { adminFromRequest, mintSession, sessionCookie, writeAuthStatus, auditRecord } from './lib/adminAuth.mjs';
import { createGateway } from './gateway/index.mjs';
import { handleModelEndpoint } from './gateway/handler.mjs';
import { PROOF_GATEWAY_KEY_HEADER } from './gateway/proxy.mjs';

const HOST = process.env.PROOF_HOST || '127.0.0.1';
const PORT = Number(process.env.PROOF_PORT || 8791);
const PUBLIC_DRINK_URL = process.env.PROOF_PUBLIC_DRINK_URL || `http://${HOST}:${PORT}/proof/drink/`;
// 生命周期配置。**非法值直接抛错，不静默回退。**
const LIFECYCLE = resolveLifecycleConfig(process.env);
const DATA_DIR = LIFECYCLE.stateDbPath || process.env.PROOF_DATA_DIR || fileURLToPath(new URL('./state/', import.meta.url));
const STATE_FILE = `${DATA_DIR}/engine.json`;
const ENGINES_FILE = `${DATA_DIR}/engines.json`;
const TOKEN_FILE = `${DATA_DIR}/agents.json`;
const CATALOG_FILE = `${DATA_DIR}/catalog.json`;
// 已消费/已过期的公开链接保留多久后清理。只增不减会让状态文件无限长大。
const PUBLIC_LINK_RETENTION_MS = Number.isFinite(Number(process.env.PROOF_PUBLIC_LINK_RETENTION_HOURS))
  ? Math.max(1, Number(process.env.PROOF_PUBLIC_LINK_RETENTION_HOURS)) * 3600000
  : 72 * 3600000;
const PUBLIC_LINK_TTL_MS = Number.isFinite(Number(process.env.PROOF_PUBLIC_LINK_TTL_MS))
  ? Math.max(1, Number(process.env.PROOF_PUBLIC_LINK_TTL_MS))
  : 30 * 60 * 1000;
const ADMIN_PASSWORD_MIN = 12;
const ADMIN_SETUP_KEY = String(process.env.PROOF_ADMIN_SETUP_KEY || '');
// 明确的本地开发开关，**默认关**。没有它、也没有 setup key，初始化端点一律不开。
const ALLOW_INSECURE_ADMIN_SETUP = String(process.env.PROOF_ALLOW_INSECURE_ADMIN_SETUP || '').toLowerCase() === 'true';
const BINDS_EXTERNALLY = !['127.0.0.1', '::1', 'localhost'].includes(HOST);
// 对外监听又没有 setup key —— 直接拒绝启动，不给「主人会抢先设置」留侥幸。
if (BINDS_EXTERNALLY && !ADMIN_SETUP_KEY) {
  console.error('proof-service 拒绝启动：对外监听（PROOF_HOST=' + HOST + '）时必须设置 PROOF_ADMIN_SETUP_KEY');
  process.exit(78);
}
// Agent 名册。**正式契约是 N >= 1、数量不定**。产品默认只创建一个通用身份；
// 加第 N+1 个 Agent 不必改源码：设 PROOF_AGENTS 即可。
//
// 两种写法都收：
//   PROOF_AGENTS='chara:CharA,charb:CharB'
//   PROOF_AGENTS='[{"id":"chara","name":"CharA"},{"id":"charb","name":"CharB"}]'
//
// id 会变成 <DATA_DIR>/<id>.token 的文件名与状态文件的键，所以严格校验：
// 只允许 [a-z0-9_-]，长度 1..32，互不重复，且不得与公开引擎前缀 'public:' 冲突。
const DEFAULT_AGENTS = [
  { id: 'char', name: 'Char' }
];

function parseAgents(raw) {
  const text = String(raw || '').trim();
  if (!text) return DEFAULT_AGENTS;
  let list;
  if (text.startsWith('[')) {
    list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('PROOF_AGENTS JSON 必须是数组');
    list = list.map((row) => ({ id: String(row?.id || '').trim(), name: String(row?.name || row?.id || '').trim() }));
  } else {
    list = text.split(',').map((pair) => {
      const [id, name] = pair.split(':');
      return { id: String(id || '').trim(), name: String(name || id || '').trim() };
    });
  }
  if (!list.length) throw new Error('PROOF_AGENTS 至少要有一个 Agent');
  const seen = new Set();
  for (const agent of list) {
    if (!/^[a-z0-9_-]{1,32}$/.test(agent.id)) {
      throw new Error(`PROOF_AGENTS 里的 id 不合法：${JSON.stringify(agent.id)}（只允许 a-z 0-9 _ -，长度 1..32）`);
    }
    if (seen.has(agent.id)) throw new Error(`PROOF_AGENTS 里的 id 重复：${agent.id}`);
    seen.add(agent.id);
    if (!agent.name) agent.name = agent.id;
  }
  return list;
}

// **测试专用**：让本服务创建的所有引擎使用确定性的杯 id，从而关掉隐藏抽卡。
//
// 为什么装在服务侧：服务自己 new ProofEngine(...)，测试没有注入点；
// 而单一烈酒的杯够 heaven 的抽卡资格，5% 的运行会被改名，断言 claimedName
// 的用例会随机失败（例如 expected '无目标杯' / actual 'heaven'）。
// 测试必须注入确定性，不能靠「这次应该抽不到」，
// 也不许为了让测试绿去改生产行为——所以开关默认关，生产路径一字不动。
//
// 结构性保证它只能在测试里用：**对外监听时带上这个开关一律拒绝启动。**
const TEST_FIXED_CUP_IDS = String(process.env.PROOF_TEST_FIXED_CUP_IDS || '').toLowerCase() === 'true';
if (TEST_FIXED_CUP_IDS && BINDS_EXTERNALLY) {
  console.error('proof-service 拒绝启动：PROOF_TEST_FIXED_CUP_IDS 只能用于本地测试，不得对外监听');
  process.exit(78);
}
// 递增序列，逐个验证落在 5% 之外（命中的跳过）。id 必须唯一——引擎按 cup.id 找杯。
let fixedCupSeq = 0;
function nextFixedCupId() {
  for (;;) {
    const id = `svc-fixed-${fixedCupSeq}`;
    fixedCupSeq += 1;
    if (hashUnit(id) >= HIDDEN_DRAW_P) return id;
  }
}
// 生产恒为空对象 —— ProofEngine 退回 randomUUID，抽卡照旧。
const ENGINE_OPTS_EXTRA = TEST_FIXED_CUP_IDS ? { idFactory: nextFixedCupId } : {};

let AGENTS;
try {
  AGENTS = parseAgents(process.env.PROOF_AGENTS);
} catch (error) {
  console.error(`proof-service 拒绝启动：${error.message}`);
  process.exit(78);
}

// 公开饮酒链接的占位身份（接口约定：链接给谁，谁就是饮用者）。
// 不预绑定接收者；隔离结算见 publicEngines。字面量 user / char 与 {{user}} / {{char}} 同义。
const PUBLIC_ENGINE_PREFIX = 'public:';
const PUBLIC_MIXER_ID = 'user';
const PUBLIC_DRINKER_ID = 'char';
const DEFAULT_DRINK_NAME = '{{user}}的特调';

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function loadTokens() {
  let records;
  try {
    records = JSON.parse(await readFile(TOKEN_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    records = {};
  }

  // PROOF_AGENTS 是当前权威名册。已有 Agent 保留原凭据；新加入的 Agent
  // 在第一次启动时自动获得独立 token。这样 N+1 Agent 真正做到只改配置，
  // 不需要手工改 agents.json，也不会重置任何既有身份。
  let changed = false;
  for (const agent of AGENTS) {
    let record = records[agent.id];
    if (!record) {
      const token = randomBytes(32).toString('base64url');
      record = { name: agent.name, tokenHash: hashToken(token) };
      records[agent.id] = record;
      const path = `${DATA_DIR}/${agent.id}.token`;
      await writeFile(path, `${token}\n`, { mode: 0o600 });
      await chmod(path, 0o600);
      changed = true;
    } else if (record.name !== agent.name) {
      record.name = agent.name;
      changed = true;
    }
  }

  // 兼容最早期 agents.json 的一次性 bootstrapToken：如果仍存在就完成落盘，
  // 随后立即从记录中删除明文。未列在 PROOF_AGENTS 的旧记录不参与认证，
  // 但暂不破坏性删除，方便运维误删配置后恢复。
  for (const [id, record] of Object.entries(records)) {
    if (!record?.bootstrapToken) continue;
    const path = `${DATA_DIR}/${id}.token`;
    try { await readFile(path, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(path, `${record.bootstrapToken}\n`, { mode: 0o600 });
      await chmod(path, 0o600);
    }
    delete record.bootstrapToken;
    changed = true;
  }

  if (changed || !Object.keys(records).length) {
    await writeFile(TOKEN_FILE, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
    await chmod(TOKEN_FILE, 0o600);
  }

  // 只有当前配置中的 Agent 能认证；旧的持久记录不自动复活身份。
  return Object.fromEntries(
    AGENTS.map((agent) => [agent.id, records[agent.id]])
      .filter(([, record]) => record?.tokenHash)
  );
}

const tokenRecords = await loadTokens();

async function loadAdmin() {
  const path = `${DATA_DIR}/admin.token`;
  let token;
  try { token = (await readFile(path, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { tokenHash: null, sessionSecret: randomBytes(32).toString('hex'), configured: false };
  }
  if (!token) return { tokenHash: null, sessionSecret: randomBytes(32).toString('hex'), configured: false };
  return { tokenHash: hashToken(token), sessionSecret: hashToken(`session:${token}`), configured: true };
}

let adminSecrets = await loadAdmin();

function requireAdmin(req, res) {
  const admin = adminFromRequest(req, { adminTokenHash: adminSecrets.tokenHash, sessionSecret: adminSecrets.sessionSecret, hashToken });
  if (!admin) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  return admin;
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// 首次设置管理口令的准入。
// **注意**：服务通常跑在反向代理后面，此时 req.socket.remoteAddress 永远是回环地址，
// 「来自本机」不能当作凭据。所以没有 setup key 时默认关闭，
// 只有显式打开 PROOF_ALLOW_INSECURE_ADMIN_SETUP 的本地开发才放行。
function canInitializeAdmin(req, payload) {
  if (ADMIN_SETUP_KEY) {
    const given = Buffer.from(String(payload.setupKey || ''));
    const expected = Buffer.from(ADMIN_SETUP_KEY);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
  if (!ALLOW_INSECURE_ADMIN_SETUP) return false;
  return !BINDS_EXTERNALLY && isLoopbackAddress(req.socket.remoteAddress);
}

async function setAdminPassword(password) {
  if (typeof password !== 'string' || password.length < ADMIN_PASSWORD_MIN) {
    throw Object.assign(new Error('admin_password_too_short'), { status: 400 });
  }
  const path = `${DATA_DIR}/admin.token`;
  await writeFile(path, `${password}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  adminSecrets = { tokenHash: hashToken(password), sessionSecret: hashToken(`session:${password}`), configured: true };
}

function rememberAudit(entry) {
  catalog.audit = [...(catalog.audit || []), entry].slice(-200);
}

function turnContextFor(agentId, now = Date.now()) {
  return createTurnBridge({ getEngine: engineFor, agentId }).beforeModelTurn(now);
}

function publicLink(token) {
  return `${PUBLIC_DRINK_URL.replace(/\/?$/, '/')}#${token}`;
}

function capabilityForOffer(offerId) {
  return (catalog.capabilities || []).find((entry) => entry.offerId === offerId && entry.token);
}

async function loadEngines() {
  const opts = { lifecycle: LIFECYCLE, ...ENGINE_OPTS_EXTRA };
  try {
    const saved = JSON.parse(await readFile(ENGINES_FILE, 'utf8'));
    const agents = new Map(AGENTS.map((agent) => [agent.id, saved[agent.id] ? ProofEngine.restoreState(saved[agent.id], realPack, opts) : new ProofEngine(null, realPack, opts)]));
    const publicEngines = new Map(Object.entries(saved)
      .filter(([key]) => key.startsWith(PUBLIC_ENGINE_PREFIX))
      .map(([key, state]) => [key.slice(PUBLIC_ENGINE_PREFIX.length), ProofEngine.restoreState(state, realPack, opts)]));
    return { agents, publicEngines };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const agents = new Map(AGENTS.map((agent) => [agent.id, new ProofEngine(null, realPack, opts)]));
    // 旧单 Agent 存档（engine.json）升级目标 = registry 的第一个 Agent（generic/自定义皆可），
    // 不再写死任何部署身份。
    const legacyTarget = AGENTS[0]?.id;
    try { if (legacyTarget) agents.set(legacyTarget, ProofEngine.restoreState(await readFile(STATE_FILE, 'utf8'), realPack, opts)); }
    catch (legacyError) { if (legacyError.code !== 'ENOENT') throw legacyError; }
    return { agents, publicEngines: new Map() };
  }
}

async function loadCatalog() {
  try { return JSON.parse(await readFile(CATALOG_FILE, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return { drinks: [], proposals: [], visibility: {} }; }
}

const loadedEngines = await loadEngines();
const engines = loadedEngines.agents;
const publicEngines = loadedEngines.publicEngines;
let catalog = await loadCatalog();
catalog.visibility ||= {};
catalog.capabilities ||= [];
catalog.audit ||= [];
// “存入酒单”就是固定酒身份。旧版本把用户保存的酒误标为 custom；启动时原地
// 迁移，并从当前已接受效果恢复完整性格。尚未递出的未来杯自动使用最新版，
// 已创建 offer 自己持有快照，不会被追溯改写。
for (const item of catalog.drinks || []) {
  if (!item?.cup) continue;
  item.cup.kind = 'menu';
  item.cup.listed = true;
  if (item.cup.effects) {
    item.cup.characterEffects = { ...item.cup.effects, 精度: 0 };
    item.cup.characterIdentity = item.cup.claimedName;
    item.cup.baseVector = { ...item.cup.effects, 精度: 0 };
    item.cup.claimedEffects = { ...item.cup.effects, 精度: 0 };
  }
}
let writeQueue = Promise.resolve();

// —— 模型网关（V1，可选，默认关：PROOF_GATEWAY_ENABLED=1 才启用）——
// 普通模式（MCP/hook/HTTP/CLI /agent/turn-context）不受影响。
const gatewayEnabled = process.env.PROOF_GATEWAY_ENABLED === '1';
const gateway = gatewayEnabled ? createGateway({
  getEngine: (id) => engines.get(id) || null,
  dataDir: DATA_DIR,
  env: process.env
}) : null;
if (gateway) {
  for (const agent of AGENTS) await gateway.identity.ensure(agent.id);
}
// 最近一次代理时间（诊断用；只记时刻不记内容）
let lastProxyByAgent = new Map();

function expirePublicOffers(now = Date.now()) {
  let changed = false;
  for (const capability of catalog.capabilities) {
    if (capability.status !== 'open' || now - Number(capability.createdAt || 0) < PUBLIC_LINK_TTL_MS) continue;
    capability.status = 'expired';
    capability.expiredAt = now;
    const engine = publicEngineFor(capability.offerId);
    const offer = engine?.offers.get(capability.offerId);
    if (offer && offer.status === 'open') {
      offer.status = 'expired';
      offer.expiredAt = now;
    }
    changed = true;
  }
  // 清理：已消费/已过期且超过保留期的公开链接与其一次性引擎。
  // **只清公开链接这一侧**，Agent 状态、审计与酒单历史一律不动。
  const cutoff = now - PUBLIC_LINK_RETENTION_MS;
  const keep = [];
  for (const capability of catalog.capabilities) {
    // 终态＝这条链接不可能再被消费。四种都算：
    //   consumed 匿名喝掉 / claimed Agent 领走 / expired 过期 / rejected 被拒
    // 原来只认前两种，claimed（Agent 领取成功）与 rejected 会永远留在表里。
    const done = ['consumed', 'claimed', 'expired', 'rejected'].includes(capability.status);
    const at = Number(capability.consumedAt || capability.expiredAt || capability.createdAt || 0);
    if (done && at > 0 && at < cutoff) {
      publicEngines.delete(capability.offerId);
      changed = true;
      continue;
    }
    keep.push(capability);
  }
  if (keep.length !== catalog.capabilities.length) catalog.capabilities = keep;
  return changed;
}

function persist() {
  const agentStates = Object.fromEntries([...engines].map(([id, value]) => [id, value.exportState()]));
  const publicStates = Object.fromEntries([...publicEngines].map(([id, value]) => [`${PUBLIC_ENGINE_PREFIX}${id}`, value.exportState()]));
  const payload = JSON.stringify({ ...agentStates, ...publicStates });
  const catalogPayload = JSON.stringify(catalog);
  const tmp = `${ENGINES_FILE}.${process.pid}.tmp`;
  const catalogTmp = `${CATALOG_FILE}.${process.pid}.tmp`;
  writeQueue = writeQueue.then(async () => {
    await writeFile(tmp, payload, { mode: 0o600 });
    await writeFile(catalogTmp, catalogPayload, { mode: 0o600 });
    await rename(tmp, ENGINES_FILE);
    await rename(catalogTmp, CATALOG_FILE);
  });
  return writeQueue;
}

function engineFor(agentId) { return engines.get(agentId); }

function publicEngineFor(offerId) { return publicEngines.get(offerId); }

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(payload);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw Object.assign(new Error('body_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function authenticate(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) return null;
  const candidate = Buffer.from(hashToken(match[1]));
  for (const [id, record] of Object.entries(tokenRecords)) {
    const expected = Buffer.from(record.tokenHash);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return { id, name: record.name };
  }
  return null;
}

// OpenAI-compatible clients commonly expose only "API Key" and therefore
// send it as Authorization: Bearer. Gateway routes accept that transport in
// addition to x-proof-gateway-key; the value is still resolved exclusively by
// the Gateway identity map and is stripped before forwarding upstream.
function gatewayKeyFromRequest(req) {
  const explicit = req.headers[PROOF_GATEWAY_KEY_HEADER];
  if (typeof explicit === 'string' && explicit) return explicit;
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (match?.[1]) return match[1];
  // Some OpenAI-compatible mobile clients label the same API Key field using
  // an Anthropic/Azure-style header even for chat/completions.
  for (const name of ['x-api-key', 'api-key']) {
    const value = req.headers[name];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

// 并列 adapter 的身份通道：
//   MCP / HTTP 普通 Agent = Bearer agent token；
//   Gateway 会话 = x-proof-gateway-key（映射到同一 Agent）。
// 模型永远无法自报 agentId 冒充身份——两条通道都只认凭据。
async function resolveAgentIdentity(req) {
  const bearer = authenticate(req);
  if (bearer) return bearer;
  const key = req.headers[PROOF_GATEWAY_KEY_HEADER];
  if (typeof key === 'string' && gateway) {
    const id = await gateway.identity.agentIdForToken(key);
    if (id) {
      const record = AGENTS.find((a) => a.id === id);
      if (record) return { id: record.id, name: record.name };
    }
  }
  return null;
}

// 复刻引擎“当前杯未结束前不得开始喝第二杯”的公开判定（只读 state，不引入第二套逻辑）。
function canStartCupForAgent(engine, cup) {
  const current = engine?.state?.currentCup;
  return !(current && !current.closed && current.id !== cup?.id);
}

// 当前 Agent 可见的菜单杯源（未做投影裁剪，供饮用构造用）。
function visibleMenuCups() {
  return [...menu.filter((cup) => cup.listed !== false), ...catalog.drinks.map((item) => item.cup)]
    .filter((cup) => catalog.visibility[cup.id] !== false)
    .filter((cup) => !isReservedMenuEntry(cup));
}

function authenticateCapability(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) return null;
  const candidate = Buffer.from(hashToken(match[1]));
  return catalog.capabilities.find((entry) => {
    const expected = Buffer.from(entry.tokenHash);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }) || null;
}

function effectText(vec) {
  if (!vec || !Object.values(vec).some((v) => v)) return '';
  return publicEffectDescription(assembleEffectDescription(vec, realPack.effectLexicon)).text || '';
}

// 保留身份不得出现在普通菜单或 AI 点单列表里。
// **同时按名称判定**，不只依赖 listed / kind——历史数据可能两者都正常。
function isReservedMenuEntry(cup) {
  return isReservedHiddenName(cup?.claimedName);
}

function publicMenu() {
  return [...menu.filter((cup) => cup.listed !== false), ...catalog.drinks.map((item) => item.cup)]
    .filter((cup) => catalog.visibility[cup.id] !== false)
    .filter((cup) => !isReservedMenuEntry(cup))
    .map(aiOrderProjection);
}

// Agent 侧饮用未成功时的回滚。
// createOffer 会往 tonightDelivered 与 records 各推一条「递出」，
// 所以「先建 offer 再发现喝不下」会留下幽灵记录。这里按 offerId 精确撤掉，
// 让一次失败的尝试在账上不留痕。**不改引擎语义**，只清服务端自己发起的那一次。
function abortAgentOffer(engine, offerId) {
  if (!engine || !offerId) return;
  engine.offers.delete(offerId);
  engine.state.tonightDelivered = (engine.state.tonightDelivered || []).filter((r) => r.id !== offerId);
  engine.state.records = (engine.state.records || []).filter((r) => r.id !== offerId);
}

// 菜单上「当前 Agent 看得见」的杯，与 publicMenu() 同一口径。
// 隐藏酒不在 menu 的 listed 集合里，因此天然点不到。
function visibleCupById(drinkId) {
  return [...menu.filter((cup) => cup.listed !== false), ...catalog.drinks.map((item) => item.cup)]
    .filter((cup) => catalog.visibility[cup.id] !== false)
    .filter((cup) => !isReservedMenuEntry(cup))
    .find((cup) => cup.id === drinkId) || null;
}

const OBJECTIVE_EVENT_TYPES = new Set(['吐', '宕机', '断片', '塌']);

function sanitizeAgentBeliefs(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 8) throw Object.assign(new Error('invalid_beliefs'), { status: 400 });
  const allowedObjects = new Set([
    ...menu.map((cup) => cup.claimedName),
    ...Object.keys(realPack.beliefProfiles || {})
  ]);
  const directAxes = new Set(['愉悦', '唤醒', '亲近', '守门', '欲望']);

  return raw.map((entry) => {
    const confidence = Number(entry?.confidence ?? 1);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw Object.assign(new Error('invalid_belief'), { status: 400 });
    }

    const out = { confidence };
    const about = String(entry?.about || '').trim();
    const hasKnownAbout = about && allowedObjects.has(about);
    if (hasKnownAbout) out.about = about;

    if (entry?.effects != null) {
      if (!entry.effects || typeof entry.effects !== 'object' || Array.isArray(entry.effects)) {
        throw Object.assign(new Error('invalid_belief_effects'), { status: 400 });
      }
      const effects = {};
      for (const [axis, value] of Object.entries(entry.effects)) {
        // 信念不能改变客观精度。对 MCP/HTTP 调用方容错：显式传精度时直接丢弃，
        // 其主观“迟钝感”应放 subjectiveDescription，而不是伪造客观数值。
        if (axis === '精度') continue;
        if (!directAxes.has(axis)) throw Object.assign(new Error('invalid_belief_effects'), { status: 400 });
        const n = Number(value);
        if (!Number.isFinite(n) || n < -3 || n > 3) throw Object.assign(new Error('invalid_belief_effects'), { status: 400 });
        if (n) effects[axis] = n;
      }
      if (Object.keys(effects).length) out.effects = effects;
    }

    if (entry?.subjectiveDescription != null) {
      const subjectiveDescription = sanitizeSubjectiveBelief(entry.subjectiveDescription);
      if (String(entry.subjectiveDescription).trim() && !subjectiveDescription) {
        throw Object.assign(new Error('invalid_subjective_belief'), { status: 400 });
      }
      if (subjectiveDescription) out.subjectiveDescription = subjectiveDescription;
    }

    const hasDirect = !!out.effects || !!out.subjectiveDescription;
    if (about && !hasKnownAbout && !hasDirect) throw Object.assign(new Error('unknown_belief_object'), { status: 400 });
    if (!hasKnownAbout && !hasDirect) throw Object.assign(new Error('empty_belief'), { status: 400 });
    return out;
  });
}

function cupWithAgentBeliefs(cup, rawBeliefs) {
  const cloned = structuredClone(cup);
  cloned.agentBeliefs = sanitizeAgentBeliefs(rawBeliefs);
  return cloned;
}

function framingForDrink(claimedName, events = [], beliefs = [], evalResult = null) {
  const objective = (events || []).some((event) => OBJECTIVE_EVENT_TYPES.has(event?.type));
  const beliefVector = evalResult?.beliefStrength || {};
  const hasBeliefVector = Object.entries(beliefVector).some(([axis, value]) => axis !== '精度' && Math.abs(Number(value) || 0) > 1e-9);
  const hasBelief = (beliefs || []).length > 0 || hasBeliefVector;
  return {
    effect: isReservedHiddenName(claimedName) ? DETERMINISTIC_EFFECT_FRAME_NOTE : STATE_FRAME_NOTE,
    ...(hasBelief ? { belief: BELIEF_EFFECT_FRAME_NOTE } : {}),
    ...(objective ? { objective: OBJECTIVE_EFFECT_FRAME_NOTE } : {})
  };
}

function offersFor(agentId) {
  const engine = engineFor(agentId);
  return [...engine.offers.values()]
    .filter((offer) => offer.drinkerId === agentId && offer.status === 'open')
    .map((offer) => ({ id: offer.oneTimeId, createdAt: offer.createdAt, ...engine.viewOffer(offer.oneTimeId, agentId).projection }));
}

function publicMixerProjection(engine, offer) {
  const source = engine.viewOffer(offer.oneTimeId, PUBLIC_DRINKER_ID).projection || {};
  const projection = publicBeforeProjection(source);
  if (offer.status === 'consumed') {
    // 味道与实际效果只存在于**饮用那一刻**的结果里（offer.consumedResult）。
    // 原来拿第一屏的 source 去取，flavorDescription 根本不在里面，
    // 于是每一杯喝过的酒在调酒方历史里都写着「没有明显味道。」。
    Object.assign(projection, publicAfterProjection(offer.consumedResult || source));
    // 固定酒历史遵循固定性格，不展示旧版本曾错误混入的配方药理结果。
    if (offer.cup?.kind === 'menu') {
      projection.actualEffectDescription = {
        text: effectText(offer.cup.characterEffects || offer.cup.effects || {}) || ZERO_PUSH_TEXT
      };
    }
    if (offer.effectVisibleToMixer === false) delete projection.actualEffectDescription;
  }
  return projection;
}

function humanOffers() {
  const rows = [];
  for (const [targetId, engine] of engines) {
    for (const offer of engine.offers.values()) {
      // 公开链接被 Agent 领取时会复制成 Agent 私有 offer。历史应仍以原公开杯为
      // 唯一凭据，否则同一次递出会出现两个不同 ID 的重复行。
      const mirroredClaim = catalog.capabilities.some((capability) =>
        capability.claimedBy === targetId
        && (capability.claimedOfferId === offer.oneTimeId
          || (!capability.claimedOfferId && capability.consumedAt === offer.createdAt))
      );
      if (mirroredClaim) continue;
      rows.push({ id: offer.oneTimeId, targetId, status: offer.status, createdAt: offer.createdAt, projection: engine.viewOffer(offer.oneTimeId, offer.mixerId).projection });
    }
  }
  for (const engine of publicEngines.values()) {
    for (const offer of engine.offers.values()) {
      // 公开 offer 无 targetId：链接给谁就是谁的，不回传接收者身份。
      rows.push({ id: offer.oneTimeId, status: offer.status, createdAt: offer.createdAt, projection: publicMixerProjection(engine, offer) });
    }
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

function findOfferRow(offerId) {
  for (const [targetId, engine] of engines) {
    const offer = engine.offers.get(offerId);
    if (offer) return { offer, engine, targetId };
  }
  const publicEngine = publicEngineFor(offerId);
  const publicOffer = publicEngine?.offers.get(offerId);
  if (publicOffer) return { offer: publicOffer, engine: publicEngine, targetId: null };
  return null;
}

function validateParts(parts) {
  if (!Array.isArray(parts) || !parts.length) throw Object.assign(new Error('recipe_required'), { status: 400 });
  const normalized = parts.map((part) => ({ id: String(part.id), volume: Number(part.volume) }));
  if (normalized.some((part) => !ingredients[part.id] || !Number.isFinite(part.volume) || part.volume <= 0 || part.volume > 500)) {
    throw Object.assign(new Error('invalid_recipe'), { status: 400 });
  }
  if (normalized.reduce((sum, part) => sum + part.volume, 0) > 500) throw Object.assign(new Error('recipe_too_large'), { status: 400 });
  return normalized;
}

// 装饰物由服务端允许列表约束；客户端在普通配料上自称 decorative 无效
// （validateParts 只保留 id 与 volume，装饰信息进不来）。
function validateGarnishes(raw) {
  try {
    return normalizeGarnishes(raw);
  } catch (error) {
    throw Object.assign(new Error(error.message || 'invalid_garnish'), { status: 400 });
  }
}

function sameRecipe(a, b) {
  const normalize = (xs) => xs.map((x) => [x.id, Number(x.volume.toFixed(6))]).sort((x, y) => x[0].localeCompare(y[0], 'zh-CN'));
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

// —— 公开饮酒结果（接口约定）——

const PORTABLE_RESULT_HEADER = '[Proof 饮酒结果]';
const ZERO_PUSH_TEXT = '没有什么额外的东西被推动。';
const NO_FLAVOR_TEXT = '没有明显味道。';

// 服务端三类公开投影白名单：AI 点单、公开喝前、公开喝后各自独立。
// 配方、剂量、信念拆分、宿主专用 stateInjection 一律不出公开饮酒响应。
const AI_ORDER_PROJECTION_KEYS = [
  'id',
  'name',
  'intro',
  'recipe',
  'flavorDescription',
  'effectDescription',
  'cupType',
  'color',
  // 装饰物是外观，跟杯型颜色同级；不挂进来，AI 点单时看不见杯口那圈盐。
  'garnishes'
];
const PUBLIC_BEFORE_PROJECTION_KEYS = ['claimedName', 'intro', 'cupType', 'color', 'garnishes'];
const PUBLIC_AFTER_PROJECTION_KEYS = ['flavorDescription', 'finish', 'actualEffectDescription'];

function pickProjection(source, keys) {
  return Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]));
}

function aiOrderProjection(cup) {
  const claimedEffects = cup.claimedEffects || cup.effects || {};
  const flavorDescription = cup.registeredFlavorText
    || cup.claimedFlavorText
    || assembleFlavorDescription(
      cup.claimedFlavor || {},
      realPack.flavorLexicon,
      {},
      cup.id || cup.claimedName || ''
    ).text
    || NO_FLAVOR_TEXT;
  const projection = {
    id: cup.id,
    name: cup.claimedName,
    intro: cup.intro,
    recipe: (cup.recipe || []).map((part) => ({ id: part.id, volume: part.volume })),
    flavorDescription,
    effectDescription: cup.registeredEffectText || effectText(claimedEffects) || ZERO_PUSH_TEXT,
    cupType: cup.cupType,
    color: cup.color,
    garnishes: cup.garnishes || []
  };
  return pickProjection(projection, AI_ORDER_PROJECTION_KEYS);
}

function publicBeforeProjection(projection) {
  return pickProjection(projection || {}, PUBLIC_BEFORE_PROJECTION_KEYS);
}

function publicAfterProjection(projection) {
  const source = projection || {};
  const actualEffectText = source.actualEffectDescription?.text || ZERO_PUSH_TEXT;
  const output = {
    flavorDescription: source.flavorDescription || NO_FLAVOR_TEXT,
    actualEffectDescription: { text: actualEffectText }
  };
  if (source.finish) output.finish = source.finish;
  return pickProjection(output, PUBLIC_AFTER_PROJECTION_KEYS);
}

// Agent/MCP 饮用结果与人类结果页分层。人类仍保留文学化 actualEffectDescription；
// Agent 不接收那段可复述正文，也不接收轴名/方向/数值，只拿当前合成状态的简短语义提示。
function agentAfterDrinkProjection(projection, cup = null, evalResult = null) {
  const source = projection || {};
  const hints = buildAgentStateHints(evalResult?.state, { maxHints: 4 });
  const out = {
    flavorDescription: source.flavorDescription || NO_FLAVOR_TEXT,
    ...(hints.length ? { stateHints: hints } : {}),
    ...((Array.isArray(source.garnishes) && source.garnishes.length) || (Array.isArray(cup?.garnishes) && cup.garnishes.length) ? { garnishes: (source.garnishes?.length ? source.garnishes : cup.garnishes) } : {})
  };
  if (source.finish) out.finish = source.finish;
  return out;
}

function compactAgentEvents(events = []) {
  return projectAgentObjectiveStates(events);
}

function portableCopyText({ claimedName, projection, consumedAtIso, events = [] }) {
  const effect = projection?.actualEffectDescription?.text
    ? projection.actualEffectDescription.text
    : ZERO_PUSH_TEXT;
  const lines = [
    PORTABLE_RESULT_HEADER,
    '递酒者：{{user}}',
    '饮用者：{{char}}',
    `酒名：${claimedName || '一杯没有说明的特调'}`,
    `入口：${projection?.flavorDescription || NO_FLAVOR_TEXT}`
  ];
  // 字目随 UI 一起改：这一栏是递酒者留给饮用者的一句话，不是酒的余韵。
  if (projection?.finish) lines.push(`留言：${projection.finish}`);
  lines.push(`当前推力：${effect}`);
  lines.push(`状态时间：${consumedAtIso}`);
  lines.push('');
  // framing 仍由 engine 统一提供：普通酒是内在推力；两种隐藏结果是确定事件。
  // 起因：Char 喝完之后直接把效果原文复述了出来——第二人称的描写看起来就像台词。
  lines.push(isReservedHiddenName(claimedName) ? DETERMINISTIC_EFFECT_FRAME_NOTE : STATE_FRAME_NOTE);
  if ((events || []).some((event) => OBJECTIVE_EVENT_TYPES.has(event?.type))) {
    lines.push(OBJECTIVE_EFFECT_FRAME_NOTE);
  }
  return lines.join('\n');
}

function buildPortableResult(claimedName, projection, consumedAtMs, events = []) {
  const consumedAtIso = new Date(consumedAtMs).toISOString();
  return {
    consumedAt: consumedAtIso,
    copyText: portableCopyText({ claimedName, projection, consumedAtIso, events })
  };
}

async function createHumanOffer(payload) {
  const parts = validateParts(payload.parts);
  const base = payload.baseMenuId ? [...menu, ...catalog.drinks.map((item) => item.cup)].find((cup) => cup.id === payload.baseMenuId) : null;
  const name = sanitizeClaimedName(payload.name, { ingredientIds: Object.keys(ingredients) }) || DEFAULT_DRINK_NAME;
  const cupTypes = { '子弹杯': 90, '矮球杯': 300, '高球杯': 350, '鸡尾酒杯': 250, '碟形杯': 200, '大杯': 500 };
  if (payload.cupType && !cupTypes[payload.cupType]) throw Object.assign(new Error('invalid_cup_type'), { status: 400 });
  if (payload.cupType && parts.reduce((sum, part) => sum + part.volume, 0) > cupTypes[payload.cupType]) throw Object.assign(new Error('cup_overflow'), { status: 400 });
  const intro = sanitizeIntro(payload.intro ?? (base && name === base.claimedName ? base.intro : ''), { ingredientIds: Object.keys(ingredients) }) || '一杯没有说明的特调。';
  let finish = '';
  if (payload.finish != null && String(payload.finish).trim()) {
    const fin = sanitizeFinish(payload.finish, { ingredientIds: Object.keys(ingredients) });
    if (!fin.ok) throw Object.assign(new Error(fin.error), { status: 400 });
    finish = fin.value;
  }
  const cup = base && name === base.claimedName && sameRecipe(parts, base.recipe) && (!payload.cupType || payload.cupType === base.cupType)
    ? base
    : buildFromParts(name, parts, { kind: 'custom', listed: false, intro, finish, garnishes: validateGarnishes(payload.garnishes) });
  if (payload.cupType) cup.cupType = payload.cupType;
  // 接口约定：公开链接不预绑定接收者，按单杯、单 offer 隔离结算。
  // 每个公开 offer 使用独立的一次性引擎；结果不写入任何 Agent 持久引擎，也不写共享匿名引擎。
  const engine = new ProofEngine(null, realPack, { lifecycle: LIFECYCLE, ...ENGINE_OPTS_EXTRA });
  const offerId = engine.createOffer(cup, PUBLIC_MIXER_ID, PUBLIC_MIXER_ID, PUBLIC_DRINKER_ID, Date.now());
  const offer = engine.offers.get(offerId);
  const effectVisibleToMixer = payload.effectVisibleToMixer !== false;
  offer.effectVisibleToMixer = effectVisibleToMixer;
  publicEngines.set(offerId, engine);
  const capabilityToken = randomBytes(32).toString('base64url');
  catalog.capabilities.push({ offerId, tokenHash: hashToken(capabilityToken), token: capabilityToken, createdAt: Date.now(), status: 'open' });
  await persist();
  return { ok: true, offerId, name, link: publicLink(capabilityToken) };
}

function customItem(id) { return catalog.drinks.find((item) => item.id === id); }
function sanitizePatch(value) {
  const patch = {};
  if (value.intro != null) patch.intro = sanitizeIntro(value.intro, { ingredientIds: Object.keys(ingredients) });
  if (value.finish != null) {
    const fin = sanitizeFinish(value.finish, { ingredientIds: Object.keys(ingredients) });
    if (!fin.ok) throw Object.assign(new Error(fin.error), { status: 400 });
    patch.finish = fin.value;
  }
  if (value.effects != null) {
    const axes = ['愉悦', '唤醒', '亲近', '守门', '欲望', '精度'];
    patch.effects = {};
    for (const [axis, amount] of Object.entries(value.effects)) {
      const n = Number(amount);
      if (!axes.includes(axis) || !Number.isFinite(n) || n < -3 || n > 3 || (axis === '精度' && n > 0)) throw Object.assign(new Error('invalid_effects'), { status: 400 });
      patch.effects[axis] = n;
    }
  }
  if (!Object.keys(patch).length) throw Object.assign(new Error('empty_patch'), { status: 400 });
  return patch;
}

async function saveCustomDrink(payload) {
  const parts = validateParts(payload.parts);
  const name = sanitizeClaimedName(payload.name, { ingredientIds: Object.keys(ingredients) }) || DEFAULT_DRINK_NAME;
  // 保留身份不能被写进普通菜单（Heaven / HEAVEN 同样拦）。
  if (isReservedHiddenName(name)) throw Object.assign(new Error('reserved_hidden_name'), { status: 400 });
  const garnishes = validateGarnishes(payload.garnishes);
  const intro = sanitizeIntro(payload.intro, { ingredientIds: Object.keys(ingredients) }) || '一杯没有说明的特调。';
  let finish = '';
  if (payload.finish != null && String(payload.finish).trim()) {
    const fin = sanitizeFinish(payload.finish, { ingredientIds: Object.keys(ingredients) });
    if (!fin.ok) throw Object.assign(new Error(fin.error), { status: 400 });
    finish = fin.value;
  }
  const cup = buildFromParts(name, parts, { kind: 'menu', listed: true, intro, finish, garnishes });
  const cupTypes = { '子弹杯': 90, '矮球杯': 300, '高球杯': 350, '鸡尾酒杯': 250, '碟形杯': 200, '大杯': 500 };
  if (payload.cupType) { if (!cupTypes[payload.cupType] || cup.totalVolume > cupTypes[payload.cupType]) throw Object.assign(new Error('cup_overflow'), { status: 400 }); cup.cupType = payload.cupType; }
  cup.id = `saved-${randomUUID()}`;
  catalog.drinks.push({ id: cup.id, cup, createdAt: Date.now(), updatedAt: Date.now() });
  catalog.visibility[cup.id] = true;
  await persist();
  return { ok: true, drink: { id: cup.id, name: cup.claimedName, intro: cup.intro, cupType: cup.cupType, color: cup.color } };
}

// 无参数 reset 的默认语义：清当前影响与持续注入（敏感度保留）。
export const DEFAULT_RESET_MODE = '连宿醉一起清';

async function resetAgent(agentId, mode, actor) {
  const resolved = mode == null || mode === '' ? DEFAULT_RESET_MODE : mode;
  if (!['醒酒', '连宿醉一起清', '这晚不算'].includes(resolved)) throw Object.assign(new Error('invalid_reset_mode'), { status: 400 });
  mode = resolved;
  // **普通 reset**（不指定模式）必须能把 Agent 收拾干净——包括放弃一只没喝完的杯。
  // 普通 reset 不再 409，也不借用会删除历史的「这晚不算」。
  // 明确指定 醒酒 / 这晚不算 的管理员调用维持既有语义，仍会拒绝。
  const isPlainReset = mode === DEFAULT_RESET_MODE;
  const result = engineFor(agentId).reset(mode, Date.now(), { discardOpenCup: isPlainReset });
  if (result?.ok === false) return { status: 409, body: result };
  await persist();
  return { status: 200, body: { ok: true, agentId, mode, actor } };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const gatewayPath = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, version: 1 });
    // —— 模型网关入口（V1）——
    if (req.method === 'POST' && gateway && gateway.ROUTES[gatewayPath]) {
      if (!gateway.enabled) return json(res, 404, { ok: false, error: 'gateway_disabled' });
      if (!gateway.concurrency.tryAcquire()) {
        return json(res, 429, { ok: false, error: 'gateway_overloaded' });
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        gateway.concurrency.release();
      };
      res.once('finish', release);
      res.once('close', release);
      const keyHeader = gatewayKeyFromRequest(req);
      if (!keyHeader) {
        return json(res, 401, { ok: false, error: 'gateway_key_required' });
      }
      const agentId = await gateway.identity.agentIdForToken(keyHeader);
      if (!agentId) return json(res, 401, { ok: false, error: 'gateway_key_invalid' });
      // 匿名不得自称 Agent：body/query/header 里的 agentId 一律不可信，身份只来自 key
      if (req.headers['x-proof-agent-id'] && req.headers['x-proof-agent-id'] !== agentId) {
        return json(res, 403, { ok: false, error: 'forbidden' });
      }
      lastProxyByAgent.set(agentId, Date.now());
      try {
        await handleModelEndpoint({ gateway, req, res, pathname: gatewayPath, agentId });
      } catch (error) {
        // 上游响应头/正文一旦开始透传，就不能再拼接第二份 JSON 错误体。
        if (!res.headersSent && !res.writableEnded) {
          json(res, 500, { ok: false, error: 'gateway_internal_error' });
        } else if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/v1/')) {
      return json(res, gateway?.enabled ? 401 : 404, { ok: false, error: gateway?.enabled ? 'gateway_key_required' : 'gateway_disabled' });
    }
   if (req.method === 'GET' && url.pathname === '/human/auth-status') {
     const admin = adminFromRequest(req, { adminTokenHash: adminSecrets.tokenHash, sessionSecret: adminSecrets.sessionSecret, hashToken });
      return json(res, 200, { ok: true, ...writeAuthStatus(!!admin, adminSecrets.configured) });
   }
    if (req.method === 'POST' && url.pathname === '/human/admin/password') {
      const payload = await body(req);
      if (adminSecrets.configured) {
        const admin = requireAdmin(req, res);
        if (!admin) return;
      } else if (!canInitializeAdmin(req, payload)) {
        // 不回显 setup key，也不说明差在哪一步。
        return json(res, 403, { ok: false, error: 'admin_setup_not_allowed' });
      }
      await setAdminPassword(payload.password);
      const token = mintSession(adminSecrets.sessionSecret, 'admin');
      return json(res, 200, { ok: true, configured: true }, { 'set-cookie': sessionCookie(token) });
    }
   if (req.method === 'POST' && url.pathname === '/human/session') {
      const admin = adminFromRequest(req, { adminTokenHash: adminSecrets.tokenHash, sessionSecret: adminSecrets.sessionSecret, hashToken });
      if (!admin || admin.via !== 'bearer') return json(res, 401, { ok: false, error: 'unauthorized' });
      const token = mintSession(adminSecrets.sessionSecret, admin.id);
      const payload = JSON.stringify({ ok: true, authenticated: true });
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'set-cookie': sessionCookie(token)
      });
      return res.end(payload);
    }
    if (req.method === 'GET' && url.pathname === '/human/agents') {
      const admin = adminFromRequest(req, { adminTokenHash: adminSecrets.tokenHash, sessionSecret: adminSecrets.sessionSecret, hashToken });
      const agents = AGENTS.map((agent) => {
        const row = { id: agent.id, name: agent.name };
        if (admin) row.stateInjectionEnabled = !!engineFor(agent.id)?.isInjectionEnabled();
        return row;
      });
      return json(res, 200, { agents, ...writeAuthStatus(!!admin, adminSecrets.configured) });
    }
    if (req.method === 'GET' && url.pathname === '/human/menu') return json(res, 200, { drinks: catalog.drinks.filter((item) => !isReservedMenuEntry(item.cup)).map((item) => ({ id: item.id, name: item.cup.claimedName, intro: item.cup.intro, cupType: item.cup.cupType, color: item.cup.color, effects: item.cup.effects || {}, recipe: item.cup.recipe || [] })), visibility: catalog.visibility });
    if (req.method === 'GET' && url.pathname === '/human/offers') {
      if (expirePublicOffers()) await persist();
      return json(res, 200, { offers: humanOffers() });
    }
    if (req.method === 'POST' && url.pathname === '/human/offers') return json(res, 201, await createHumanOffer(await body(req)));
    let match = /^\/human\/offers\/([^/]+)\/link$/.exec(url.pathname);
   if (match && req.method === 'POST') {
      if (expirePublicOffers()) await persist();
     const found = findOfferRow(match[1]);
      if (!found) return json(res, 404, { ok: false, error: 'offer_not_found' });
      if (found.offer.status !== 'open') return json(res, 409, { ok: false, error: 'capability_spent' });
      const existing = capabilityForOffer(match[1]);
      if (existing) {
        const reused = { ok: true, reused: true, offerId: match[1], name: found.offer.claimedName, link: publicLink(existing.token) };
        if (found.targetId) reused.targetId = found.targetId;
        return json(res, 200, reused);
      }
      return json(res, 409, { ok: false, error: 'capability_spent' });
    }
    if (req.method === 'POST' && url.pathname === '/human/menu') return json(res, 201, await saveCustomDrink(await body(req)));
    match = /^\/human\/visibility\/([^/]+)$/.exec(url.pathname);
    if (match && req.method === 'PATCH') {
      const visibilityId = decodeURIComponent(match[1]);
      const exists = [...menu, ...catalog.drinks.map((item) => item.cup)].some((cup) => cup.id === visibilityId); if (!exists) return json(res, 404, { ok: false, error: 'not_found' });
      catalog.visibility[visibilityId] = !!(await body(req)).visible; await persist(); return json(res, 200, { ok: true, visible: catalog.visibility[visibilityId] });
    }
    match = /^\/human\/menu\/([^/]+)$/.exec(url.pathname);
    if (match && req.method === 'PATCH') {
      const item = customItem(match[1]); if (!item) return json(res, 404, { ok: false, error: 'not_found' });
      const payload = await body(req), name = sanitizeClaimedName(payload.name, { ingredientIds: Object.keys(ingredients) }); if (!name) return json(res, 400, { ok: false, error: 'name_required' });
      if (isReservedHiddenName(name)) return json(res, 400, { ok: false, error: 'reserved_hidden_name' });
      item.cup.claimedName = name;
      if (item.cup.kind === 'menu') item.cup.characterIdentity = name;
      item.updatedAt = Date.now(); await persist(); return json(res, 200, { ok: true });
    }
    if (match && req.method === 'DELETE') {
      const before = catalog.drinks.length; catalog.drinks = catalog.drinks.filter((item) => item.id !== match[1]);
      if (catalog.drinks.length === before) return json(res, 404, { ok: false, error: 'not_found' });
      catalog.proposals = catalog.proposals.filter((proposal) => proposal.drinkId !== match[1]); delete catalog.visibility[match[1]]; await persist(); return json(res, 200, { ok: true });
    }
    match = /^\/human\/menu\/([^/]+)\/proposals$/.exec(url.pathname);
    if (match && req.method === 'POST') {
      if (!customItem(match[1])) return json(res, 404, { ok: false, error: 'not_found' });
      const payload = await body(req); if (!AGENTS.some((agent) => agent.id === payload.targetId)) return json(res, 400, { ok: false, error: 'unknown_target' });
      const proposal = { id: randomUUID(), drinkId: match[1], targetId: payload.targetId, patch: sanitizePatch(payload.patch || {}), status: 'pending', createdAt: Date.now() };
      catalog.proposals.push(proposal); await persist(); return json(res, 201, { ok: true, proposalId: proposal.id });
    }
    match = /^\/human\/agents\/([^/]+)\/reset$/.exec(url.pathname);
    if (match && req.method === 'POST') {
      const admin = requireAdmin(req, res); if (!admin) return;
      if (!engineFor(match[1])) return json(res, 404, { ok: false, error: 'not_found' });
      const result = await resetAgent(match[1], (await body(req)).mode, admin.id);
      rememberAudit(auditRecord({ actorType: admin.type, actorId: admin.id, targetId: match[1], action: 'reset', result: result.body?.mode || false }));
      await persist();
      return json(res, result.status, result.body);
    }
    match = /^\/human\/agents\/([^/]+)\/injection$/.exec(url.pathname);
    if (match && req.method === 'POST') {
      const admin = requireAdmin(req, res); if (!admin) return;
      if (!engineFor(match[1])) return json(res, 404, { ok: false, error: 'not_found' });
      const payload = await body(req);
      const result = engineFor(match[1]).setStateInjection(!!payload.enabled);
      rememberAudit(auditRecord({ actorType: admin.type, actorId: admin.id, targetId: match[1], action: 'injection', result: !!result.stateInjection }));
      await persist();
      return json(res, 200, { ok: true, agentId: match[1], stateInjection: result.stateInjection });
    }

   if (url.pathname === '/capability/offer') {
     const capability = authenticateCapability(req);
     if (!capability) return json(res, 401, { ok: false, error: 'unauthorized' });
      if (capability.status === 'open' && Date.now() - Number(capability.createdAt || 0) >= PUBLIC_LINK_TTL_MS) {
        expirePublicOffers();
        await persist();
      }
      if (req.method === 'GET' && capability.status !== 'open') {
        return json(res, 410, { ok: false, error: capability.status === 'expired' ? 'link_expired' : 'capability_spent' });
      }
     if (capability.status === 'claimed') return json(res, 409, { ok: false, error: 'capability_spent' });
     const engine = publicEngineFor(capability.offerId);
     if (!engine) return json(res, 404, { ok: false, error: 'not_found' });
     if (req.method === 'GET') {
       const viewed = engine.viewOffer(capability.offerId, PUBLIC_DRINKER_ID, Date.now());
        if (!viewed.ok) return json(res, 404, viewed);
        if (viewed.status !== 'open') return json(res, 410, { ok: false, error: 'link_expired' });
        return json(res, 200, {
          ok: true,
          status: viewed.status,
          projection: publicBeforeProjection(viewed.projection)
        });
     }
      if (req.method === 'POST') {
        const payload = await body(req);
        if (payload.action === 'drink') {
         const result = engine.drinkOffer(capability.offerId, PUBLIC_DRINKER_ID, req.headers['idempotency-key'] || capability.offerId, Date.now());
          if (!result.ok) {
            if (result.error === 'expired') {
              capability.status = 'expired';
              capability.expiredAt = Date.now();
              await persist();
              return json(res, 410, { ok: false, error: 'link_expired' });
            }
            return json(res, 409, { ok: false, error: result.error });
          }
          const offer = engine.offers.get(capability.offerId);
          const consumedAt = capability.consumedAt ?? offer?.drunkAt ?? Date.now();
          if (!result.idempotent) {
            capability.status = 'consumed';
            capability.consumedAt = consumedAt;
            for (const cap of catalog.capabilities) {
              if (cap.offerId === capability.offerId) delete cap.token;
            }
            await persist();
          }
          // 公开响应白名单（接口约定）：不再透出宿主专用 stateInjection / sipResults / eval 等内部字段。
          return json(res, 200, {
            ok: true,
            idempotent: !!result.idempotent,
            projection: publicAfterProjection(result.projection),
            portableResult: buildPortableResult(offer?.claimedName, result.projection, consumedAt, result.events || [])
          });
        }
        if (payload.action === 'reject') {
          const result = engine.rejectOffer(capability.offerId, PUBLIC_DRINKER_ID, Date.now());
          if (!result.ok) return json(res, 409, { ok: false, error: result.error });
          if (!result.idempotent) {
            capability.status = 'rejected';
            for (const cap of catalog.capabilities) {
              if (cap.offerId === capability.offerId) delete cap.token;
            }
            await persist();
          }
          return json(res, 200, { ok: true, idempotent: !!result.idempotent, status: 'rejected' });
        }
        return json(res, 400, { ok: false, error: 'invalid_action' });
      }
    }

    if (url.pathname.startsWith('/agent/')) {
      const agent = await resolveAgentIdentity(req);
      if (!agent) return json(res, 401, { ok: false, error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/agent/home') {
        const eng = engineFor(agent.id);
        const turn = turnContextFor(agent.id, Date.now());
        return json(res, 200, {
          agent: { id: agent.id, name: agent.name },
          menu: publicMenu(),
          offers: offersFor(agent.id),
          proposals: catalog.proposals.filter((p) => p.targetId === agent.id && p.status === 'pending'),
          stateInjection: turn.injected ? turn.block : null,
          stateInjectionEnabled: eng.isInjectionEnabled(),
          hasState: turn.hasState === true
        });
      }
      // Agent 自主进酒吧饮用：不需要先生成 Link。
      // capability 不存在；只有 drinkOffer 真正成功才写该 Agent ledger/state。
      if (req.method === 'POST' && /^\/agent\/menu\/[^/]+\/drink$/.test(url.pathname)) {
        const payload = await body(req);
        if (payload.agentId && payload.agentId !== agent.id) return json(res, 403, { ok: false, error: 'forbidden' });
        if (Object.hasOwn(payload, 'beliefs')) return json(res, 400, { ok: false, error: 'beliefs_not_allowed_for_menu_order' });
        const wanted = decodeURIComponent(url.pathname.replace(/^\/agent\/menu\//, '').replace(/\/drink$/, ''));
        const eng = engineFor(agent.id);
        const cup = visibleMenuCups().find((c) => c.id === wanted || c.claimedName === wanted || c.id === `cup-${wanted}`) || null;
        if (!cup) return json(res, 404, { ok: false, error: 'drink_not_found' });
        if (!canStartCupForAgent(eng, cup)) return json(res, 409, { ok: false, error: 'cannot_drink_now' });
        const offerId = eng.createOffer(cup, PUBLIC_MIXER_ID, PUBLIC_MIXER_ID, agent.id, Date.now());
        const result = eng.drinkOffer(offerId, agent.id, `menu-${cup.id}-${randomUUID()}`, Date.now());
        if (!result.ok) return json(res, 409, { ok: false, error: result.error });
        await persist();
        return json(res, 200, {
          ok: true,
          offerId,
          revision: eng.state.revision || 0,
          projection: agentAfterDrinkProjection(result.projection, cup, result.eval),
          events: compactAgentEvents(result.events || []),
          states: compactAgentEvents(result.states || result.eval?.presentation?.states || []),
          framing: framingForDrink(cup.claimedName, result.events || [], [], result.eval)
        });
      }
      if (req.method === 'GET' && url.pathname === '/agent/turn-context') {
        return json(res, 200, turnContextFor(agent.id, Date.now()));
      }
      if (req.method === 'GET' && (url.pathname === '/agent/gateway' || url.pathname === '/agent/gateway/status')) {
        // 安全诊断：不含密钥、聊天正文、内部提示词或其他 Agent 数据
        const eng = engineFor(agent.id);
        const projection = eng ? buildAgentTurnContext(eng, agent.id, Date.now()) : null;
        const batch = eng?.state?.fragmentBatches?.find((b) => b.readable !== true && Date.now() < Number(b.restoreAt)) || null;
        const conversationCount = gateway ? (await gateway.ledger.conversationCount(agent.id)) : 0;
        return json(res, 200, {
          ok: true,
          agentId: agent.id,
          active: projection?.active === true,
          revision: projection?.revision ?? eng?.state?.revision ?? 0,
          blackoutActive: Boolean(batch),
          restoreAt: batch ? Number(batch.restoreAt) : null,
          blackoutRecoveryHours: eng?.lifecycle?.blackoutRecoveryHours ?? null,
          transientTtlHours: eng?.lifecycle?.transientTtlHours ?? null,
          provider: gateway ? 'openai+anthropic' : null,
          conversationCount,
          lastProxyAt: lastProxyByAgent.get(agent.id) ?? null,
          gatewayEnabled: gateway?.enabled === true
        });
      }
      if (req.method === 'POST' && url.pathname === '/agent/gateway/config') {
        // 生命周期配置唯一来自服务端 env/lifecycle；此处只回显，不接受第二份真相。
        const eng = engineFor(agent.id);
        return json(res, 200, {
          ok: true,
          note: 'lifecycle_config_owned_by_server_env',
          injectionEnabled: eng?.isInjectionEnabled() === true,
          blackoutRecoveryHours: eng?.lifecycle?.blackoutRecoveryHours ?? null,
          transientTtlHours: eng?.lifecycle?.transientTtlHours ?? null
        });
      }
      if (req.method === 'POST' && url.pathname === '/agent/injection') {
        const payload = await body(req);
        if (payload.agentId && payload.agentId !== agent.id) return json(res, 403, { ok: false, error: 'forbidden' });
        const result = engineFor(agent.id).setStateInjection(!!payload.enabled);
        rememberAudit(auditRecord({ actorType: 'agent', actorId: agent.id, targetId: agent.id, action: 'injection', result: !!result.stateInjection }));
        await persist();
        return json(res, 200, result);
      }
      // Agent 自主点酒：直接从可见菜单饮用。
      // 身份**只**来自 bearer token；请求体里的 agentId 只能与自己一致，否则 403。
      // 复用既有 createOffer → drinkOffer，不另造生理状态逻辑。
      match = /^\/agent\/menu\/([^/]+)\/drink$/.exec(url.pathname);
      if (match && req.method === 'POST') {
        const payload = await body(req);
        if (payload.agentId && payload.agentId !== agent.id) return json(res, 403, { ok: false, error: 'forbidden' });
        // 自主点菜单是“我明确选择了哪杯”的已知路径，不让模型顺手预测一套 placebo。
        // belief 只留给被递来的/身份或效果存在不确定性的杯（proof_drink_link）。
        if (payload.beliefs != null) return json(res, 400, { ok: false, error: 'beliefs_not_allowed_for_menu_order' });
        const drinkId = decodeURIComponent(match[1]);
        const visibleCup = visibleCupById(drinkId);
        if (!visibleCup) return json(res, 404, { ok: false, error: 'drink_not_found' });
        const cup = visibleCup;
        const menuEngine = engineFor(agent.id);
        const menuNow = Date.now();
        const menuOfferId = menuEngine.createOffer(cup, PUBLIC_MIXER_ID, PUBLIC_MIXER_ID, agent.id, menuNow);
        const menuResult = menuEngine.drinkOffer(menuOfferId, agent.id, `menu-${drinkId}-${menuNow}`, menuNow);
        if (!menuResult.ok) {
          // 跟 claim 同一条规矩：没喝成就当没发生，账上不留痕。
          abortAgentOffer(menuEngine, menuOfferId);
          return json(res, 409, { ok: false, error: menuResult.error });
        }
        rememberAudit(auditRecord({ actorType: 'agent', actorId: agent.id, targetId: agent.id, action: 'menu-drink', result: true }));
        await persist();
        return json(res, 200, {
          ok: true,
          drinkId,
          offerId: menuOfferId,
          projection: agentAfterDrinkProjection(menuResult.projection, cup, menuResult.eval),
          events: compactAgentEvents(menuResult.events || []),
          states: compactAgentEvents(menuResult.states || menuResult.eval?.presentation?.states || []),
          framing: framingForDrink(cup.claimedName, menuResult.events || [], [], menuResult.eval)
        });
      }

      // 接口约定领取/兑换：归属在饮用时确定，而不是递出时确定。
      // 只有经过 Agent bearer 鉴权的请求才能写入该 Agent 引擎；
      // 匿名网页饮用与 Agent 领取互斥，先成功者消费该 offer；仅凭 capability token 不得自称某个 Agent。
     if (req.method === 'POST' && url.pathname === '/agent/offers/claim') {
        if (expirePublicOffers()) await persist();
       const payload = await body(req);
        if (payload.agentId && payload.agentId !== agent.id) return json(res, 403, { ok: false, error: 'forbidden' });
        const token = String(payload.capabilityToken || '');
        if (!token) return json(res, 400, { ok: false, error: 'capability_token_required' });
        const candidate = Buffer.from(hashToken(token));
        const entry = catalog.capabilities.find((cap) => {
          const expected = Buffer.from(cap.tokenHash);
          return candidate.length === expected.length && timingSafeEqual(candidate, expected);
        }) || null;
        if (!entry) return json(res, 404, { ok: false, error: 'capability_not_found' });
        if (entry.status !== 'open') return json(res, 409, { ok: false, error: 'capability_spent' });
        const publicEngine = publicEngineFor(entry.offerId);
        const publicOffer = publicEngine?.offers.get(entry.offerId);
        if (!publicEngine || !publicOffer || publicOffer.status !== 'open') return json(res, 409, { ok: false, error: 'capability_spent' });
        const agentEngine = engineFor(agent.id);
        const claimNow = Date.now();
        const claimedCup = cupWithAgentBeliefs(publicOffer.cup, payload.beliefs);
        const claimedOfferId = agentEngine.createOffer(claimedCup, PUBLIC_MIXER_ID, PUBLIC_MIXER_ID, agent.id, claimNow);
        const result = agentEngine.drinkOffer(claimedOfferId, agent.id, `claim-${entry.offerId}`, claimNow);
        if (!result.ok) {
          // **只有真的喝下去，Link 才算被消费。**
          // 旧实现先把 capability 标成 claimed/consumed 再检查结果，于是
          // 「当前喝不下」会把链接吞掉，还在 Agent 引擎里留一个孤儿 offer。
          // 现在：链接保持 open、不写 Agent ledger、不留中间归属状态，
          // 状态恢复后仍可由任一 Agent 或匿名网页正常消费。
          abortAgentOffer(agentEngine, claimedOfferId);
          return json(res, 409, { ok: false, error: result.error });
        }
        entry.status = 'claimed';
        entry.claimedBy = agent.id;
        entry.claimedOfferId = claimedOfferId;
        entry.consumedAt = claimNow;
        publicOffer.status = 'consumed';
        publicOffer.drunkAt = claimNow;
        // Agent 通过公开 Link 喝掉后，公开 offer 本身并没有在 publicEngine 里执行 drinkOffer。
        // 若不把 Agent 的喝后投影回填到这只公开 offer，调酒方历史只能看到喝前 source，
        // 最终就会错误 fallback 成“没有明显味道 / 没有额外推力”。这里只保存公开喝后白名单，
        // 不把 Agent 的轴值、belief 拆分或其他内部字段带回调酒方历史。
        publicOffer.consumedResult = publicAfterProjection(result.projection);
        delete entry.token;
        rememberAudit(auditRecord({ actorType: 'agent', actorId: agent.id, targetId: agent.id, action: 'claim', result: true }));
        await persist();
        return json(res, 200, {
          ok: true,
          claimed: true,
          offerId: claimedOfferId,
          capabilityOfferId: entry.offerId,
          idempotent: false,
          projection: agentAfterDrinkProjection(result.projection, claimedCup, result.eval),
          events: compactAgentEvents(result.events || []),
          states: compactAgentEvents(result.states || result.eval?.presentation?.states || []),
          framing: framingForDrink(claimedCup.claimedName, result.events || [], claimedCup.agentBeliefs || [], result.eval)
        });
      }
      match = /^\/agent\/offers\/([^/]+)(?:\/(drink|reject))?$/.exec(url.pathname);
      const engine = engineFor(agent.id);
      if (match && engine.offers.get(match[1])?.drinkerId !== agent.id) return json(res, 404, { ok: false, error: 'not_found' });
      if (match && req.method === 'GET' && !match[2]) return json(res, 200, engine.viewOffer(match[1], agent.id));
      if (match && req.method === 'POST' && match[2] === 'drink') {
        const payload = await body(req);
        const pendingOffer = engine.offers.get(match[1]);
        if (pendingOffer?.cup) pendingOffer.cup.agentBeliefs = sanitizeAgentBeliefs(payload.beliefs);
        const result = engine.drinkOffer(match[1], agent.id, req.headers['idempotency-key'] || randomUUID(), Date.now());
        if (result.ok) {
          for (const cap of catalog.capabilities) {
            if (cap.offerId === match[1]) delete cap.token;
          }
          await persist();
        }
        if (!result.ok) return json(res, 409, result);
        return json(res, 200, {
          ok: true,
          idempotent: !!result.idempotent,
          projection: agentAfterDrinkProjection(result.projection, pendingOffer?.cup, result.eval),
          events: compactAgentEvents(result.events || []),
          states: compactAgentEvents(result.states || result.eval?.presentation?.states || []),
          framing: framingForDrink(pendingOffer?.cup?.claimedName, result.events || [], pendingOffer?.cup?.agentBeliefs || [], result.eval)
        });
      }
      if (match && req.method === 'POST' && match[2] === 'reject') {
        const result = engine.rejectOffer(match[1], agent.id, Date.now());
        if (result.ok) {
          for (const cap of catalog.capabilities) {
            if (cap.offerId === match[1]) delete cap.token;
          }
          await persist();
        }
        return json(res, result.ok ? 200 : 409, result);
      }
      match = /^\/agent\/proposals\/([^/]+)\/(accept|reject)$/.exec(url.pathname);
      if (match && req.method === 'POST') {
        const proposal = catalog.proposals.find((p) => p.id === match[1] && p.targetId === agent.id && p.status === 'pending');
        if (!proposal) return json(res, 404, { ok: false, error: 'not_found' });
        proposal.status = match[2] === 'accept' ? 'accepted' : 'rejected'; proposal.decidedAt = Date.now();
        if (proposal.status === 'accepted') { const item = customItem(proposal.drinkId); if (item) { Object.assign(item.cup, proposal.patch); if (proposal.patch.effects) { item.cup.kind = 'menu'; item.cup.listed = true; item.cup.characterEffects = { ...proposal.patch.effects, 精度: 0 }; item.cup.characterIdentity = item.cup.claimedName; item.cup.baseVector = { ...proposal.patch.effects, 精度: 0 }; item.cup.claimedEffects = { ...proposal.patch.effects, 精度: 0 }; } item.updatedAt = Date.now(); } }
        await persist(); return json(res, 200, { ok: true, status: proposal.status });
      }
      if (req.method === 'POST' && url.pathname === '/agent/reset') { const result = await resetAgent(agent.id, (await body(req)).mode, agent.id); return json(res, result.status, result.body); }
    }
    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, error: error.message === 'invalid_json' ? error.message : (error.status ? error.message : 'internal_error') });
  }
});

if (process.env.PROOF_NO_LISTEN !== '1') {
  server.listen(PORT, HOST, () => process.stdout.write(`proof-service listening on ${HOST}:${PORT}\n`));
}
export { server };

async function shutdown() {
  server.close(async () => { await writeQueue; process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
