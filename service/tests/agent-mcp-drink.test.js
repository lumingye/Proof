// Agent MCP 饮酒通道（接口约定）。
//
// 统一语义：**Link 决定「是哪杯酒」，Agent 身份决定「记到谁的账」。**
// Link 不预绑定 Agent；一次性；匿名与 Agent 抢同一个 capability，先成功者获胜。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_FRAME_NOTE, BELIEF_EFFECT_FRAME_NOTE } from '../../engine/src/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// seedEngines：在服务启动前预置 engines.json。
// 用来造「当前喝不下」——_hasOpenCup() 只看 currentCup 存在且未 closed。
async function startServer({ seedEngines } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'proof-agent-mcp-'));
  if (seedEngines) await writeFile(join(dir, 'engines.json'), JSON.stringify(seedEngines), { mode: 0o600 });
  const port = 23000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PROOF_HOST: '127.0.0.1',
      PROOF_PORT: String(port),
      PROOF_DATA_DIR: dir,
      PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
      // 注入确定性杯 id，关掉隐藏抽卡——不靠「这次应该抽不到」
      PROOF_TEST_FIXED_CUP_IDS: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('listen_timeout')), 8000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.on('error', reject);
  });
  const tokens = {};
  for (const id of ['charb', 'chara', 'charc']) {
    tokens[id] = (await readFile(join(dir, `${id}.token`), 'utf8')).trim();
  }
  return { dir, port, child, tokens, base: `http://127.0.0.1:${port}` };
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
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status, json };
}

async function makeLink(ctx, extra = {}) {
  const made = await req(ctx, '/human/offers', {
    method: 'POST',
    body: { name: '公开杯', parts: [{ id: '威士忌', volume: 45 }], ...extra }
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const link = made.json.link;
  return { offerId: made.json.offerId, link, token: link.slice(link.indexOf('#') + 1) };
}

async function readEngines(ctx) {
  return JSON.parse(await readFile(join(ctx.dir, 'engines.json'), 'utf8'));
}

function ledgerSize(state, agentId) {
  const s = state?.[agentId] || {};
  return {
    records: (s.records || []).length,
    delivered: (s.tonightDelivered || []).length,
    cupsDrunk: s.cupsDrunk || 0
  };
}

// ---------------------------------------------------------------- A

test('A Agent 自主点酒：从菜单直接喝，只记自己的账', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  const home = await req(ctx, '/agent/home', { token: ctx.tokens.charb });
  assert.equal(home.status, 200);
  assert.equal(home.json.agent.id, 'charb');
  assert.ok(Array.isArray(home.json.menu) && home.json.menu.length > 0, '菜单不该是空的');
  const target = home.json.menu.find((d) => d.id && d.name === '威士忌') || home.json.menu[0];
  assert.ok(target.id, '菜单项必须带 id，否则 proof_drink 无从下手');

  const drunk = await req(ctx, `/agent/menu/${encodeURIComponent(target.id)}/drink`, {
    method: 'POST', token: ctx.tokens.charb, body: {}
  });
  assert.equal(drunk.status, 200, JSON.stringify(drunk.json));
  assert.equal(drunk.json.ok, true);
  assert.ok(drunk.json.projection, '要返回饮用 projection');

  const state = await readEngines(ctx);
  assert.equal(ledgerSize(state, 'charb').cupsDrunk, 1, 'CharB 应记一杯');
  assert.equal(ledgerSize(state, 'chara').cupsDrunk, 0, 'CharA 不该受影响');
  assert.equal(ledgerSize(state, 'charc').cupsDrunk, 0, 'CharC 不该受影响');

  const turn = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(turn.status, 200);
});

test('A2 不得跨 Agent 写状态：请求体里的 agentId 与 bearer 不符即 403', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const home = await req(ctx, '/agent/home', { token: ctx.tokens.charb });
  const target = home.json.menu[0];
  const bad = await req(ctx, `/agent/menu/${encodeURIComponent(target.id)}/drink`, {
    method: 'POST', token: ctx.tokens.charb, body: { agentId: 'chara' }
  });
  assert.equal(bad.status, 403);
  assert.equal(bad.json.error, 'forbidden');
  const state = await readEngines(ctx).catch(() => ({}));
  assert.equal(ledgerSize(state, 'chara').cupsDrunk, 0);
});

test('A3 点不到菜单上没有的东西（隐藏酒不可点）', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const miss = await req(ctx, '/agent/menu/cup-heaven/drink', {
    method: 'POST', token: ctx.tokens.charb, body: {}
  });
  assert.equal(miss.status, 404);
  assert.equal(miss.json.error, 'drink_not_found');
});

test('A4 自主点啤酒：登记性格与真实酒精都结算，不让模型顺手预测 belief', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const home = await req(ctx, '/agent/home', { token: ctx.tokens.charb });
  const beer = home.json.menu.find((d) => d.name === '啤酒');
  assert.ok(beer);

  const drunk = await req(ctx, `/agent/menu/${encodeURIComponent(beer.id)}/drink`, {
    method: 'POST', token: ctx.tokens.charb, body: {}
  });
  assert.equal(drunk.status, 200, JSON.stringify(drunk.json));
  assert.equal(drunk.json.framing.effect, STATE_FRAME_NOTE);
  assert.equal('belief' in drunk.json.framing, false);

  const state = (await readEngines(ctx)).charb;
  assert.ok(state.c > 0, '菜单固定酒也必须累计真实酒精');
  const char = state.characterResiduals?.[0]?.cumulative || {};
  assert.ok(Math.abs(char.愉悦 - 1) < 1e-9);
  assert.ok(Math.abs(char.唤醒 + 1) < 1e-9);
  assert.equal((state.beliefResiduals || []).length, 0);
  assert.equal((state.directBeliefResiduals || []).length, 0);
});

test('A5 自主点菜单显式携带 beliefs 会被拒绝，防止旧客户端继续预测 placebo', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const home = await req(ctx, '/agent/home', { token: ctx.tokens.charb });
  const beer = home.json.menu.find((d) => d.name === '啤酒');
  assert.ok(beer);

  const bad = await req(ctx, `/agent/menu/${encodeURIComponent(beer.id)}/drink`, {
    method: 'POST', token: ctx.tokens.charb,
    body: { beliefs: [{ about: '啤酒', confidence: 0.9 }] }
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.json));
  assert.equal(bad.json.error, 'beliefs_not_allowed_for_menu_order');
  const state = await readEngines(ctx).catch(() => ({}));
  assert.equal(ledgerSize(state, 'charb').cupsDrunk, 0);
});

test('A6 被递来的白水仍可携带纯效果信念，并且精度不能被 belief 改写', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const link = await makeLink(ctx, {
    name: '施过魔法的水',
    parts: [{ id: '水', volume: 200 }]
  });

  const claimed = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.charb,
    body: {
      capabilityToken: link.token,
      beliefs: [{
        effects: { 愉悦: 3, 精度: -3 },
        subjectiveDescription: '反应好像慢了一拍',
        confidence: 0.8
      }]
    }
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  assert.equal(claimed.json.framing.belief, BELIEF_EFFECT_FRAME_NOTE);

  const state = (await readEngines(ctx)).charb;
  assert.equal(state.c, 0, '白水不能凭信念生成真实酒精');
  const direct = state.directBeliefResiduals?.[0];
  assert.ok(direct);
  assert.ok(Math.abs(direct.cumulative.愉悦 - 2.4) < 1e-9);
  assert.equal(direct.cumulative.精度, 0);
  assert.equal(direct.subjective?.[0]?.text, '反应好像慢了一拍');
});

// ---------------------------------------------------------------- B

test('B Link → CharB：CharB 喝成功后 Link 即用尽，匿名与 CharA 都再喝不到', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const link = await makeLink(ctx);

  const claimed = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.charb, body: { capabilityToken: link.token }
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  assert.equal(claimed.json.claimed, true);

  // Agent 喝掉公开 Link 后，调酒方历史必须拿到同一杯的真实喝后味道/效果，
  // 不能因为 publicEngine 本身没有执行 drinkOffer 而回退成“没有明显味道”。
  const history = await req(ctx, '/human/offers');
  assert.equal(history.status, 200);
  const row = history.json.offers.find((offer) => offer.id === link.offerId);
  assert.ok(row, '公开 offer 应该仍能在调酒方历史里找到');
  assert.equal(row.status, 'consumed');
  assert.ok(row.projection.flavorDescription);
  assert.notEqual(row.projection.flavorDescription, '没有明显味道。');
  assert.ok(row.projection.actualEffectDescription?.text);
  assert.notEqual(row.projection.actualEffectDescription.text, '没有什么额外的东西被推动。');
  for (const banned of ['claimedEffects', 'effects', 'beliefDelta', 'physiology', 'reaction']) {
    assert.equal(banned in row.projection, false, `调酒方历史不得泄露 ${banned}`);
  }

  const state = await readEngines(ctx);
  assert.equal(ledgerSize(state, 'charb').cupsDrunk, 1);
  assert.equal(ledgerSize(state, 'chara').cupsDrunk, 0);
  assert.equal(ledgerSize(state, 'charc').cupsDrunk, 0);

  // 匿名网页再消费
  const anon = await req(ctx, '/capability/offer', { token: link.token });
  assert.ok(anon.status === 409 || anon.status === 410, `匿名应失败，实际 ${anon.status}`);

  // 另一个 Agent 再消费
  const other = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.chara, body: { capabilityToken: link.token }
  });
  assert.equal(other.status, 409);
  assert.equal(other.json.error, 'capability_spent');
});

// ---------------------------------------------------------------- C

test('C Link → CharA：同一张单子换个人喝，就只记那个人', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const link = await makeLink(ctx);

  const claimed = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.chara, body: { capabilityToken: link.token }
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));

  const state = await readEngines(ctx);
  assert.equal(ledgerSize(state, 'chara').cupsDrunk, 1, 'CharA 应记一杯');
  assert.equal(ledgerSize(state, 'charb').cupsDrunk, 0, 'CharB 不该被写');
  assert.equal(ledgerSize(state, 'charc').cupsDrunk, 0, 'CharC 不该被写');
});

// ---------------------------------------------------------------- D

test('D 喝不下的时候不许吞 Link：链接保持 open、账上不留痕、恢复后仍可喝', async (t) => {
  // 预置一个没关上的杯，让 _hasOpenCup() 为真 → drinkOffer 走「一杯未结束」那道闸。
  // 这条路从 HTTP 走不到（sipAll 一次喝完），只能用预置状态造。
  const ctx = await startServer({
    seedEngines: { charb: { currentCup: { id: 'stuck-cup', closed: false }, cupsDrunk: 0 } }
  });
  t.after(() => stopServer(ctx));

  const link = await makeLink(ctx);
  const before = ledgerSize(await readEngines(ctx), 'charb');

  const blocked = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.charb, body: { capabilityToken: link.token }
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.equal(blocked.json.ok, false);
  assert.ok(blocked.json.error, '要给出明确错误');
  assert.equal('offerId' in blocked.json, false, '不该留下「已领取待饮用」的中间归属');

  // 账上不留痕
  const after = ledgerSize(await readEngines(ctx), 'charb');
  assert.deepEqual(after, before, 'CharB ledger 不得有新增');

  // Link 仍然可用：匿名读得到，且状态是 open
  const stillThere = await req(ctx, '/capability/offer', { token: link.token });
  assert.equal(stillThere.status, 200, 'Link 必须还开着');
  assert.equal(stillThere.json.status, 'open');

  // 这张 Link 没被吞掉，所以仍可被别的合法消费者喝掉。
  // 这里用匿名网页验（接口约定）。
  // 注：写这条时那只未结算的杯在 API 上没有出路；行为约定后
  // 已由 discardCurrentCup() 补上出口，见 state-delivery-reset.test.js 的 F。
  const byAnon = await req(ctx, '/capability/offer', {
    method: 'POST', token: link.token, body: { action: 'drink' }
  });
  assert.equal(byAnon.status, 200, JSON.stringify(byAnon.json));
  assert.ok(byAnon.json.portableResult?.copyText);

  // 而且匿名喝掉之后，仍然不写任何 Agent 账
  const afterAnon = await readEngines(ctx);
  assert.deepEqual(ledgerSize(afterAnon, 'charb'), before, '匿名饮用不得写 CharB 账');

  // 换个 Agent 也照样能喝——另起一张 Link 验证「不能喝的是 CharB，不是这张单子」
  const link2 = await makeLink(ctx);
  const byCharA = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.chara, body: { capabilityToken: link2.token }
  });
  assert.equal(byCharA.status, 200, JSON.stringify(byCharA.json));
});

test('D2 菜单饮用失败同样不留痕', async (t) => {
  const ctx = await startServer({
    seedEngines: { charc: { currentCup: { id: 'stuck-cup', closed: false }, cupsDrunk: 0 } }
  });
  t.after(() => stopServer(ctx));

  const home = await req(ctx, '/agent/home', { token: ctx.tokens.charc });
  const target = home.json.menu[0];
  const before = ledgerSize(await readEngines(ctx), 'charc');

  const blocked = await req(ctx, `/agent/menu/${encodeURIComponent(target.id)}/drink`, {
    method: 'POST', token: ctx.tokens.charc, body: {}
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.ok, false);

  const after = ledgerSize(await readEngines(ctx), 'charc');
  assert.deepEqual(after, before, 'CharC ledger 不得有新增');
});

// ---------------------------------------------------------------- E

test('E 匿名回归：GET → drink → portableResult → 再 GET 即用尽，且不写任何 Agent 账', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const link = await makeLink(ctx);

  const first = await req(ctx, '/capability/offer', { token: link.token });
  assert.equal(first.status, 200);
  assert.equal(first.json.status, 'open');
  assert.ok(first.json.projection.claimedName);

  const drunk = await req(ctx, '/capability/offer', {
    method: 'POST', token: link.token, body: { action: 'drink' }
  });
  assert.equal(drunk.status, 200, JSON.stringify(drunk.json));
  assert.ok(drunk.json.portableResult?.copyText, 'portable result 必须还在');

  const second = await req(ctx, '/capability/offer', { token: link.token });
  assert.ok(second.status === 409 || second.status === 410, `再取应失败，实际 ${second.status}`);

  const state = await readEngines(ctx);
  for (const id of ['charb', 'chara', 'charc']) {
    assert.equal(ledgerSize(state, id).cupsDrunk, 0, `${id} 不该被匿名饮用写到`);
  }
});

test('A7 Agent 能看见装饰：菜单投影与 Link 饮用结果都保留 garnishes', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  const madeMenu = await req(ctx, '/human/menu', {
    method: 'POST', body: { name: '带橙皮的水', parts: [{ id: '水', volume: 120 }], garnishes: ['橙皮卷'] }
  });
  assert.equal(madeMenu.status, 201, JSON.stringify(madeMenu.json));
  const home = await req(ctx, '/agent/home', { token: ctx.tokens.charb });
  const menuItem = home.json.menu.find((d) => d.id === madeMenu.json.drink.id);
  assert.deepEqual(menuItem.garnishes, ['橙皮卷']);

  const link = await makeLink(ctx, { name: '带盐边的水', parts: [{ id: '水', volume: 120 }], garnishes: ['盐口'] });
  const claimed = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.charb, body: { capabilityToken: link.token }
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  assert.deepEqual(claimed.json.projection.garnishes, ['盐口']);
});

test('A8 belief 同一对象可同时带 about + effects + subjectiveDescription，不存在字段互斥', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const link = await makeLink(ctx, { name: '测试水', parts: [{ id: '水', volume: 120 }] });
  const claimed = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.charb,
    body: { capabilityToken: link.token, beliefs: [{ about: '酒精', effects: { 愉悦: 1 }, subjectiveDescription: '应该会稍微放松一点，反应慢半拍', confidence: 0.8 }] }
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  assert.ok(Array.isArray(claimed.json.projection.stateHints) && claimed.json.projection.stateHints.length > 0);
  assert.equal('internalExperience' in claimed.json.projection, false);
  assert.equal(JSON.stringify(claimed.json.projection).includes('愉悦'), false, 'Agent 结果不暴露轴标签');
  const state = (await readEngines(ctx)).charb;
  const offer = Object.values(state.offers || {}).find((o) => o.oneTimeId === claimed.json.offerId) || Object.values(state.offers || {}).find((o) => o.cup?.claimedName === '测试水');
  const belief = offer?.cup?.agentBeliefs?.[0];
  assert.equal(belief.about, '酒精');
  assert.ok(belief.effects?.愉悦 > 0);
  assert.equal(belief.subjectiveDescription, '稍微放松一点,反应慢半拍');
});

test('A9 MCP 饮酒出口保留多口杯中途的吐/断片，并同时返回持续客观状态', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const link = await makeLink(ctx, {
    name: '跨阈值测试杯',
    parts: [{ id: '伏特加', volume: 400 }]
  });
  const drunk = await req(ctx, '/agent/offers/claim', {
    method: 'POST', token: ctx.tokens.charb, body: { capabilityToken: link.token }
  });
  assert.equal(drunk.status, 200, JSON.stringify(drunk.json));
  const events = (drunk.json.events || []).map((event) => event.type);
  const states = (drunk.json.states || []).map((state) => state.type);
  assert.ok(events.includes('吐'), `MCP/HTTP 当轮必须收到吐，实际：${events}`);
  assert.ok(events.includes('断片'), `MCP/HTTP 当轮必须收到首次断片，实际：${events}`);
  assert.ok(states.includes('断片'), `持续状态必须包含断片，实际：${states}`);
  assert.ok(states.includes('塌'), `高剂量持续状态必须包含塌，实际：${states}`);
  const vomit = drunk.json.events.find((event) => event.type === '吐');
  assert.match(vomit.text, /确实吐了|已经发生/, '不能只给模型一个容易被忽略的事件标签');
  const collapse = drunk.json.states.find((state) => state.type === '塌');
  assert.match(collapse.text, /确实|已经/, '持续客观状态也必须有 Agent-facing 事实文本');
});
