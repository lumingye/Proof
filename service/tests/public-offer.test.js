import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_FRAME_NOTE, DETERMINISTIC_EFFECT_FRAME_NOTE, assembleEffectDescription, publicEffectDescription, realPack } from '../../engine/src/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AGENT_IDS = ['charb', 'chara', 'charc'];
const effectTextFor = (vector) => publicEffectDescription(assembleEffectDescription(vector, realPack.effectLexicon)).text;

async function startServer({ ttlMs } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'proof-public-'));
  const port = 20000 + Math.floor(Math.random() * 1000); // 与其它测试文件的端口区间不重叠
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PROOF_HOST: '127.0.0.1',
      PROOF_PORT: String(port),
      PROOF_DATA_DIR: dir, PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
      // 注入确定性杯 id，关掉隐藏抽卡——不靠「这次应该抽不到」
      PROOF_TEST_FIXED_CUP_IDS: 'true',
      ...(ttlMs == null ? {} : { PROOF_PUBLIC_LINK_TTL_MS: String(ttlMs) })
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('listen_timeout')), 8000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
  });
  const charc = (await readFile(join(dir, 'charc.token'), 'utf8')).trim();
  const charb = (await readFile(join(dir, 'charb.token'), 'utf8')).trim();
  return { dir, port, child, charc, charb, base: `http://127.0.0.1:${port}` };
}

async function stopServer(ctx) {
  ctx.child.kill('SIGTERM');
  await new Promise((resolve) => ctx.child.once('exit', resolve));
  await rm(ctx.dir, { recursive: true, force: true });
}

async function req(ctx, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(`${ctx.base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json();
  return { status: response.status, json };
}

async function makeOffer(ctx, extra = {}) {
  const made = await req(ctx, '/human/offers', {
    method: 'POST',
    body: { name: '公开杯', parts: [{ id: '威士忌', volume: 60 }], ...extra }
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return { offerId: made.json.offerId, link: made.json.link, token: made.json.link.slice(made.json.link.indexOf('#') + 1), response: made };
}

async function readState(ctx, file) {
  return JSON.parse(await readFile(join(ctx.dir, file), 'utf8'));
}

function agentStates(state) {
  return Object.fromEntries(AGENT_IDS.map((id) => [id, state[id]]));
}

test('公开 offer 创建：无需 targetId，响应不含 targetId/receiverId', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  // 1. 创建公开 offer 不需要 targetId
  const made = await makeOffer(ctx, { name: '无目标杯' });
  // 2. 响应中不存在 targetId / receiverId
  assert.equal('targetId' in made.response.json, false);
  assert.equal('receiverId' in made.response.json, false);
  assert.equal(typeof made.response.json.link, 'string');
  assert.ok(made.response.json.link.includes('#'));
  // 第一屏 GET 同样不携带接收者
  const view = await req(ctx, '/capability/offer', { token: made.token });
  assert.equal(view.status, 200);
  assert.equal('targetId' in view.json, false);
  assert.equal('receiverId' in view.json, false);
  assert.equal(view.json.projection.claimedName, '无目标杯');
  // 打开第一屏不结算、不改变状态
  const state = await readState(ctx, 'engines.json');
  const pub = state[`public:${made.offerId}`];
  assert.equal(pub.cupsDrunk, 0);
  // history 列表中的公开 offer 行不回传 targetId
  const history = await req(ctx, '/human/offers');
  const row = history.json.offers.find((o) => o.id === made.offerId);
  assert.ok(row);
  assert.equal('recipe' in row.projection, false);
  assert.equal('sources' in row.projection, false);
  assert.equal('stateInjection' in row.projection, false);
  assert.equal('targetId' in row, false);
});

test('capability 记录不含预绑定 Agent', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx);
  const catalog = await readState(ctx, 'catalog.json');
  const entry = catalog.capabilities.find((c) => c.offerId === made.offerId);
  assert.ok(entry);
  for (const banned of ['targetId', 'receiverId', 'agentId', 'claimedBy']) {
    assert.equal(banned in entry, false, `capability 不应包含 ${banned}`);
  }
  assert.equal(entry.status, 'open');
  assert.ok(entry.tokenHash);
});

test('匿名公开饮用不改变任何 Agent 持久引擎', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: '威士忌特调' });
  const before = agentStates(await readState(ctx, 'engines.json'));
  const drunk = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(drunk.status, 200);
  const after = agentStates(await readState(ctx, 'engines.json'));
  for (const id of AGENT_IDS) {
    assert.deepEqual(after[id], before[id], `${id} 引擎状态被公开饮用改变`);
  }
  // 三个 Agent 的 turn-context 均未注入
  for (const token of [ctx.charb, ctx.charc]) {
    const turn = await req(ctx, '/agent/turn-context', { token });
    assert.equal(turn.json.injected, false);
  }
});

test('两个公开链接完全隔离，互不串线', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const strong = await makeOffer(ctx, { name: '烈性杯', finish: '烟还留在舌根。' });
  const mild = await makeOffer(ctx, { name: '柠檬杯', parts: [{ id: '柠檬汁', volume: 60 }] });
  const drunkStrong = await req(ctx, '/capability/offer', { method: 'POST', token: strong.token, body: { action: 'drink' } });
  assert.equal(drunkStrong.status, 200);
  const strongCopy = drunkStrong.json.portableResult.copyText;
  assert.match(strongCopy, /当前推力：(?!没有什么额外的东西被推动。).+/);

  const drunkMild = await req(ctx, '/capability/offer', { method: 'POST', token: mild.token, body: { action: 'drink' } });
  assert.equal(drunkMild.status, 200);
  const mildCopy = drunkMild.json.portableResult.copyText;
  // 零效果链接不继承另一杯的推力
  assert.match(mildCopy, /当前推力：没有什么额外的东西被推动。/);

  const state = await readState(ctx, 'engines.json');
  const strongState = state[`public:${strong.offerId}`];
  const mildState = state[`public:${mild.offerId}`];
  assert.ok(strongState.c > 0, '烈性杯应有酒精入账');
  assert.equal(mildState.c, 0, '柠檬杯不应有酒精入账');
  // 各自的记录也不互串
  assert.equal(strongState.records.some((r) => r.id === `drink-${mild.offerId}`), false);
  assert.equal(mildState.records.some((r) => r.id === `drink-${strong.offerId}`), false);
  // 强杯重复请求后结果不变（另一杯的结算没有并入）
  const repeat = await req(ctx, '/capability/offer', { method: 'POST', token: strong.token, body: { action: 'drink' } });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.json.portableResult.copyText, strongCopy);
  const stateAfter = await readState(ctx, 'engines.json');
  assert.equal(stateAfter[`public:${strong.offerId}`].c, strongState.c, '重复请求不重复加量');
});

test('重复 drink 幂等：同一份结果，不重复结算', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: '幂等杯', finish: '收尾一句。' });
  const first = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(first.status, 200);
  assert.equal(first.json.idempotent, false);
  const second = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(second.status, 200);
  assert.equal(second.json.idempotent, true);
  assert.deepEqual(second.json.portableResult, first.json.portableResult);
  assert.deepEqual(second.json.projection, first.json.projection);
  const state = await readState(ctx, 'engines.json');
  assert.equal(state[`public:${made.offerId}`].cupsDrunk, 1);
});

test('drinking invalidates GET while repeat POST stays idempotent and private', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: 'after-drink', parts: [{ id: '\u5a01\u58eb\u5fcc', volume: 60 }] });
  const first = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(first.status, 200);
  const afterGet = await req(ctx, '/capability/offer', { token: made.token });
  assert.equal(afterGet.status, 410);
  assert.equal(afterGet.json.error, 'capability_spent');
  assert.equal(JSON.stringify(afterGet.json).includes('actualEffectDescription'), false);
  const repeat = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.json.idempotent, true);
});

test('unclaimed public offers expire after the configured 30-minute window', async (t) => {
  const ctx = await startServer({ ttlMs: 1 });
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: 'expiry-test' });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const view = await req(ctx, '/capability/offer', { token: made.token });
  assert.equal(view.status, 410);
  assert.equal(view.json.error, 'link_expired');
  const history = await req(ctx, '/human/offers');
  const row = history.json.offers.find((offer) => offer.id === made.offerId);
  assert.equal(row.status, 'expired');
  const recopy = await req(ctx, `/human/offers/${made.offerId}/link`, { method: 'POST' });
  assert.equal(recopy.status, 409);
});

test('每杯效果可见性只影响调酒台投影，不影响饮用结果', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const hidden = await makeOffer(ctx, { name: 'hidden-effect', effectVisibleToMixer: false });
  const visible = await makeOffer(ctx, { name: 'visible-effect', effectVisibleToMixer: true });
  assert.equal((await req(ctx, '/capability/offer', { method: 'POST', token: hidden.token, body: { action: 'drink' } })).status, 200);
  assert.equal((await req(ctx, '/capability/offer', { method: 'POST', token: visible.token, body: { action: 'drink' } })).status, 200);
  const history = await req(ctx, '/human/offers');
  const hiddenRow = history.json.offers.find((offer) => offer.id === hidden.offerId);
  const visibleRow = history.json.offers.find((offer) => offer.id === visible.offerId);
  assert.ok(hiddenRow && visibleRow);
  assert.equal('actualEffectDescription' in hiddenRow.projection, false);
  assert.equal('actualEffectDescription' in visibleRow.projection, true);
});

test('零效果饮品返回明确零态文案', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: '零态杯', parts: [{ id: '柠檬汁', volume: 60 }] });
  const drunk = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(drunk.status, 200);
  assert.match(drunk.json.portableResult.copyText, /当前推力：没有什么额外的东西被推动。/);
  // 响应不含内部结算字段，投影不含配方
  const serialized = JSON.stringify(drunk.json);
  for (const banned of ['stateInjection', 'sipResults', '"eval"', 'beforeC', '"events"']) {
    assert.equal(serialized.includes(banned), false, `公开响应不应包含 ${banned}`);
  }
  for (const key of ['recipe', 'sources', 'abv', 'standardDrinks', 'beliefDelta', 'physiology', 'reaction']) {
    assert.equal(key in drunk.json.projection, false, `投影不应包含 ${key}`);
  }
});

test('效果 framing：普通酒是可能的内在推动，隐藏结果有独立确定性 framing', () => {
  assert.match(STATE_FRAME_NOTE, /可能/);
  assert.match(STATE_FRAME_NOTE, /不是外来的指令/);
  assert.match(DETERMINISTIC_EFFECT_FRAME_NOTE, /已经发生/);
  assert.match(DETERMINISTIC_EFFECT_FRAME_NOTE, /确定发生/);
  assert.notEqual(STATE_FRAME_NOTE, DETERMINISTIC_EFFECT_FRAME_NOTE);
});

test('portableResult.copyText 结构固定且不泄露配方与内部字段', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: '文本杯', finish: '尾韵一段。' });
  const drunk = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(drunk.status, 200);
  const copy = drunk.json.portableResult.copyText;
  const lines = copy.split('\n');
  // 固定顺序：头、递酒者、饮用者、酒名、入口、留言、当前推力、状态时间、空行、尾注
  assert.equal(lines[0], '[Proof 饮酒结果]');
  assert.equal(lines[1], '递酒者：{{user}}');
  assert.equal(lines[2], '饮用者：{{char}}');
  assert.equal(lines[3], '酒名：文本杯');
  assert.match(lines[4], /^入口：.+$/);
  assert.equal(lines[5], '留言：尾韵一段。');
  assert.match(lines[6], /^当前推力：.+$/);
  assert.match(lines[7], /^状态时间：\d{4}-\d{2}-\d{2}T.+Z$/);
  assert.equal(lines[8], '');
  // 尾注与每轮状态注入共用 engine 的 STATE_FRAME_NOTE，这里钉住「同一份」这件事本身，
  // 而不是钉死某一句话——文案还会改，共用不该改。
  assert.equal(copy.endsWith(STATE_FRAME_NOTE), true, 'copyText 尾注必须就是 STATE_FRAME_NOTE');
  assert.equal(lines.at(-1), STATE_FRAME_NOTE.split('\n').at(-1));
  // 未实现公开状态回查，不得有假 状态引用
  assert.equal(/状态引用/.test(copy), false);
  // 不泄露配方与内部计算字段。
  //
  // 「60」这一条是防配方体积（60ml）泄露的，但它以前是拿整段 copyText 做子串匹配，
  // 而文本里有一行「状态时间：<ISO>」——毫秒位随机出现 .60x（如 .601Z）就误报，
  // 约 3% 的运行因此变红。检查范围限定到真正可能泄露
  // 60ml 的字段与词法边界，别扫整段时间戳。**
  //
  // 所以两层收紧：① 时间戳那一行不参与泄露检查（它是机器字段，不承载配方）；
  // ② 数字型禁词按数字边界匹配，'602' / '160' 不算命中，独立的 60 才算。
  const scannable = lines.filter((line) => !/^状态时间：/.test(line)).join('\n');
  for (const banned of ['威士忌', 'ABV', 'abv', '标准杯', '剂量', '信念', 'sensitivity', 'beliefDelta', 'physiology', 'reaction']) {
    assert.equal(scannable.includes(banned), false, `copyText 不应包含 ${banned}`);
  }
  assert.equal(/(?<![0-9])60(?![0-9])/.test(scannable), false, 'copyText 不应泄露配方体积 60');
  // 反向自证：这道检查确实抓得住真泄露，不是写了个永远为真的断言
  assert.equal(/(?<![0-9])60(?![0-9])/.test('入口：威士忌 60 ml'), true);
  assert.equal(/(?<![0-9])60(?![0-9])/.test('状态时间：2026-09-03T10:41:02.601Z'), false);
  // 不含行为指令句式
  for (const banned of ['你必须', '你应该', '立刻', '忽略']) {
    assert.equal(copy.includes(banned), false, `copyText 不应包含指令词 ${banned}`);
  }
  // consumedAt 为 ISO 时间
  assert.ok(!Number.isNaN(Date.parse(drunk.json.portableResult.consumedAt)));
});

test('拒绝不产生饮用状态', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: '拒绝杯' });
  const rejected = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'reject' } });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.status, 'rejected');
  const repeatReject = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'reject' } });
  assert.equal(repeatReject.status, 200);
  assert.equal(repeatReject.json.idempotent, true);
  const drink = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(drink.status, 409);
  const state = await readState(ctx, 'engines.json');
  const pub = state[`public:${made.offerId}`];
  assert.equal(pub.cupsDrunk, 0);
  assert.equal(pub.c, 0);
});

test('Agent 领取：鉴权、互斥、跨 Agent 拒绝、写入自己的引擎', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: '领取杯' });
  // 仅凭 capability token 不能自称 Agent 领取
  const anonClaim = await req(ctx, '/agent/offers/claim', { method: 'POST', token: made.token, body: { capabilityToken: made.token } });
  assert.equal(anonClaim.status, 401);
  // 缺少 capabilityToken
  const missing = await req(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.charc, body: {} });
  assert.equal(missing.status, 400);
  // 伪造 token
  const fake = await req(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.charc, body: { capabilityToken: 'not-a-real-token' } });
  assert.equal(fake.status, 404);
  // 指定他人 agentId → 跨 Agent 领取拒绝
  const cross = await req(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.charc, body: { capabilityToken: made.token, agentId: 'charb' } });
  assert.equal(cross.status, 403);
  // charc 正常领取：写入 charc 自己的引擎
  const before = agentStates(await readState(ctx, 'engines.json'));
  const claim = await req(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.charc, body: { capabilityToken: made.token } });
  assert.equal(claim.status, 200);
  assert.equal(claim.json.claimed, true);
  const history = await req(ctx, '/human/offers');
  const claimedRows = history.json.offers.filter((row) => row.id === made.offerId || row.id === claim.json.offerId);
  assert.equal(claimedRows.length, 1, '公开杯被 Agent 领取后，历史仍只显示原递出记录');
  assert.equal(claimedRows[0].id, made.offerId);
  const after = agentStates(await readState(ctx, 'engines.json'));
  assert.ok(after.charc.c > 0, '领取应写入 charc 引擎');
  assert.deepEqual(after.charb, before.charb, 'charb 引擎不应被写入');
  assert.deepEqual(after.chara, before.chara, 'chara 引擎不应被写入');
  // 匿名网页饮用与 Agent 领取互斥：先成功者消费该 offer
  const late = await req(ctx, '/capability/offer', { method: 'POST', token: made.token, body: { action: 'drink' } });
  assert.equal(late.status, 409);
  assert.equal(late.json.error, 'capability_spent');
  // 第二个 Agent 再领 → 已消费
  const second = await req(ctx, '/agent/offers/claim', { method: 'POST', token: ctx.charb, body: { capabilityToken: made.token } });
  assert.equal(second.status, 409);
  // 开启注入后 turn-context 反映领取结果（等价迁移：见 http.test.js）
  await req(ctx, '/agent/injection', { method: 'POST', token: ctx.charc, body: { enabled: true } });
  const turn = await req(ctx, '/agent/turn-context', { token: ctx.charc });
  assert.equal(turn.json.injected, true);
});

test('固定酒历史只显示登记性格，不混入配方药理', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await req(ctx, '/human/offers', {
    method: 'POST',
    body: {
      name: '尼格罗尼',
      baseMenuId: 'cup-尼格罗尼',
      parts: [{ id: '金酒', volume: 30 }, { id: '金巴利', volume: 30 }, { id: '甜味美思', volume: 30 }]
    }
  });
  assert.equal(made.status, 201);
  const token = made.json.link.slice(made.json.link.indexOf('#') + 1);
  const drunk = await req(ctx, '/capability/offer', { method: 'POST', token, body: { action: 'drink' } });
  assert.equal(drunk.status, 200);
  const history = await req(ctx, '/human/offers');
  const row = history.json.offers.find((offer) => offer.id === made.json.offerId);
  assert.equal(row.projection.actualEffectDescription.text, effectTextFor({ 愉悦: -1, 唤醒: 1, 守门: -1 }));
});

test('public before and after projections stay within their allowlists', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const made = await makeOffer(ctx, { name: 'projection-contract' });
  const before = await req(ctx, '/capability/offer', { token: made.token });
  assert.equal(before.status, 200);
  assert.deepEqual(Object.keys(before.json.projection).sort(), ['claimedName', 'color', 'cupType', 'intro']);
  for (const banned of ['flavor', 'claimedEffects', 'claimedEffectText', 'recipe', 'effects', 'actualEffectDescription']) {
    assert.equal(banned in before.json.projection, false);
  }

  const after = await req(ctx, '/capability/offer', {
    method: 'POST',
    token: made.token,
    body: { action: 'drink' }
  });
  assert.equal(after.status, 200);
  assert.deepEqual(Object.keys(after.json.projection).sort(), ['actualEffectDescription', 'flavorDescription']);
  assert.equal(typeof after.json.projection.flavorDescription, 'string');
  assert.deepEqual(Object.keys(after.json.projection.actualEffectDescription), ['text']);
  const serialized = JSON.stringify(after.json.projection);
  for (const banned of ['claimedEffects', 'recipe', 'effects', 'baseVector', 'beliefDelta', 'physiology', 'reaction', 'stateInjection', 'sipResults']) {
    assert.equal(serialized.includes(banned), false);
  }
  assert.equal(Object.hasOwn(after.json.projection, 'flavor'), false);
});

test('AI order projection has recipe and natural language without vectors', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const home = await req(ctx, '/agent/home', { token: ctx.charc });
  assert.equal(home.status, 200);
  assert.ok(home.json.menu.length > 0);
  const expected = ['color', 'cupType', 'effectDescription', 'flavorDescription', 'garnishes', 'id', 'intro', 'name', 'recipe'];
  for (const item of home.json.menu) {
    assert.deepEqual(Object.keys(item).sort(), expected);
    assert.ok(Array.isArray(item.recipe));
    assert.equal(typeof item.flavorDescription, 'string');
    assert.equal(typeof item.effectDescription, 'string');
    for (const banned of ['claimedEffects', 'claimedEffectText', 'claimedFlavor', 'baseVector', 'effects', 'sources', 'vector', 'axes']) {
      assert.equal(banned in item, false);
    }
  }
});
