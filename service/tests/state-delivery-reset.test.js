// 状态投递与 Reset 简化（接口约定）。
//
// 两条主张：
//   1. **Proof 永远维护状态**——能不能读到，与宿主会不会自动投递无关。
//   2. **普通 Reset 只清当前影响，不删历史。**
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function startServer({ seedEngines } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'proof-delivery-'));
  if (seedEngines) await writeFile(join(dir, 'engines.json'), JSON.stringify(seedEngines), { mode: 0o600 });
  const port = 24000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PROOF_HOST: '127.0.0.1', PROOF_PORT: String(port),
      PROOF_DATA_DIR: dir, PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
      // 注入确定性杯 id，关掉隐藏抽卡——不靠「这次应该抽不到」
      PROOF_TEST_FIXED_CUP_IDS: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('listen_timeout')), 8000);
    child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('error', reject);
  });
  const tokens = {};
  for (const id of ['charb', 'chara', 'charc']) tokens[id] = (await readFile(join(dir, `${id}.token`), 'utf8')).trim();
  return { dir, port, child, tokens, base: `http://127.0.0.1:${port}` };
}

async function stopServer(ctx) {
  ctx.child.kill('SIGTERM');
  await new Promise((r) => ctx.child.once('exit', r));
  await rm(ctx.dir, { recursive: true, force: true });
}

async function req(ctx, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(`${ctx.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status, json };
}

async function drinkFromMenu(ctx, who) {
  const home = await req(ctx, '/agent/home', { token: ctx.tokens[who] });
  const target = home.json.menu.find((d) => d.name === '威士忌') || home.json.menu[0];
  const drunk = await req(ctx, `/agent/menu/${encodeURIComponent(target.id)}/drink`, {
    method: 'POST', token: ctx.tokens[who], body: {}
  });
  assert.equal(drunk.status, 200, JSON.stringify(drunk.json));
  return drunk.json;
}

async function engines(ctx) {
  return JSON.parse(await readFile(join(ctx.dir, 'engines.json'), 'utf8'));
}

// ---------------------------------------------------------------- A

test('A 状态读取不依赖 injection 开关：关着也读得到', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  // 默认就是关的——先确认这一点，免得测了个假前提
  const home0 = await req(ctx, '/agent/home', { token: ctx.tokens.charb });
  assert.equal(home0.json.stateInjectionEnabled, false, '默认应为关');

  const empty = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(empty.json.hasState, false, '没喝之前不该有状态');
  assert.equal(empty.json.context, null);

  await drinkFromMenu(ctx, 'charb');

  const ctxAfter = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(ctxAfter.status, 200);
  assert.equal(ctxAfter.json.hasState, true, '喝过了就该有状态，与开关无关');
  assert.equal(ctxAfter.json.active, true);
  assert.ok(ctxAfter.json.context?.text, '要给得出可读的状态文案');
  // 自动投递仍然是关的——这两件事必须分开报
  assert.equal(ctxAfter.json.autoDeliver, false);
  assert.equal(ctxAfter.json.injected, false, '兼容字段语义不变：没开就不算已投递');
  assert.equal(ctxAfter.json.block, null);
});

test('A2 打开开关只改投递，不改状态', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  await drinkFromMenu(ctx, 'charb');
  const before = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });

  const on = await req(ctx, '/agent/injection', { method: 'POST', token: ctx.tokens.charb, body: { enabled: true } });
  assert.equal(on.status, 200);

  const after = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(after.json.hasState, before.json.hasState, '状态存在性不该被开关改变');
  assert.equal(after.json.context.text, before.json.context.text, '状态文案不该被开关改变');
  assert.equal(after.json.autoDeliver, true);
  assert.equal(after.json.injected, true);
  assert.equal(after.json.block.text, after.json.context.text, 'block 只是 context 的兼容别名');
});

// ---------------------------------------------------------------- B

test('B 唯一状态源：重复读取不累计，/agent/home 与 turn-context 同源', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  await drinkFromMenu(ctx, 'charb');
  await req(ctx, '/agent/injection', { method: 'POST', token: ctx.tokens.charb, body: { enabled: true } });

  const a = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  const b = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(a.json.context.text, b.json.context.text, '读两次不得变化（读取不能推进状态）');
  assert.equal(a.json.revision, b.json.revision, '读取不得改 revision');

  const home = await req(ctx, '/agent/home', { token: ctx.tokens.charb });
  assert.equal(home.json.stateInjection.text, a.json.context.text, '/agent/home 与 turn-context 必须同一份');
});

// ---------------------------------------------------------------- C

test('C 无 hook 也能用：饮酒当轮直接拿到内部状态语义', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  // 自动投递全关的情况下喝
  const home0 = await req(ctx, '/agent/home', { token: ctx.tokens.charb });
  assert.equal(home0.json.stateInjectionEnabled, false);

  const drunk = await drinkFromMenu(ctx, 'charb');
  const p = drunk.projection || {};
  assert.ok(p.flavorDescription, '当轮要给味道');
  assert.ok(Array.isArray(p.stateHints) && p.stateHints.length > 0, '当轮要给内部状态语义');
  assert.equal('internalExperience' in p, false, 'Agent 不再拿文学效果正文');
  assert.equal('actualEffectDescription' in p, false, 'Agent 结果不再用可复述的公开效果字段');
  assert.equal(JSON.stringify(p).includes('守门'), false, 'Agent 饮用结果不暴露六轴标签');
});

// ---------------------------------------------------------------- D

test('D Reset：清当前影响，保留历史，之后还能接着喝', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  await drinkFromMenu(ctx, 'charb');
  const before = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(before.json.hasState, true);

  const stateBefore = (await engines(ctx)).charb;
  const historyBefore = {
    records: stateBefore.records.length,
    delivered: stateBefore.tonightDelivered.length,
    cupsDrunk: stateBefore.cupsDrunk
  };
  assert.ok(historyBefore.records > 0);

  // proof_reset() 对应的底层调用：不带 mode
  const reset = await req(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });
  assert.equal(reset.status, 200, JSON.stringify(reset.json));

  const after = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  assert.equal(after.json.hasState, false, 'reset 后不该再有状态');
  assert.equal(after.json.active, false);
  assert.equal(after.json.context, null);

  const stateAfter = (await engines(ctx)).charb;
  assert.equal(stateAfter.c, 0, '酒精清零');
  assert.deepEqual(stateAfter.hangoverSnapshots, [], '宿醉清空');
  assert.deepEqual(stateAfter.drinkEvents, [], '账本事件清空');
  // 历史仍在
  assert.equal(stateAfter.records.length, historyBefore.records, '历史 records 必须保留');
  assert.equal(stateAfter.tonightDelivered.length, historyBefore.delivered, '递出历史必须保留');
  assert.equal(stateAfter.cupsDrunk, historyBefore.cupsDrunk, 'cupsDrunk 不得被抹成 0');

  // 下一杯照样能喝
  const again = await drinkFromMenu(ctx, 'charb');
  assert.ok(Array.isArray(again.projection?.stateHints) && again.projection.stateHints.length > 0);
});

// ---------------------------------------------------------------- E

test('E Agent 隔离：CharB reset 不动 CharA / CharC', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  await drinkFromMenu(ctx, 'charb');
  await drinkFromMenu(ctx, 'chara');
  const charaBefore = await req(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
  assert.equal(charaBefore.json.hasState, true);

  await req(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });

  const charbAfter = await req(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
  const charaAfter = await req(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
  assert.equal(charbAfter.json.hasState, false, 'CharB 该被清');
  assert.equal(charaAfter.json.hasState, true, 'CharA 不该被牵连');
  assert.equal(charaAfter.json.context.text, charaBefore.json.context.text, 'CharA 的状态文案一字不变');

  const state = await engines(ctx);
  assert.equal(state.charb.c, 0);
  assert.ok(state.chara.c > 0, 'CharA 体内还有东西');
  assert.equal(state.charc.cupsDrunk || 0, 0);
});

// ---------------------------------------------------------------- F（行为约定 ③④）

test('F 普通 reset 能放弃没喝完的杯：不再 409，且历史一条不少', async (t) => {
  // 预置一只卡住的杯——正常路径产生不了（sipAll 一次喝完），
  // 但一旦产生，改动前三种模式一律 409，从 HTTP 出不去。
  const ctx = await startServer({
    seedEngines: {
      charb: {
        currentCup: { id: 'stuck-cup', closed: false },
        records: [{ id: 'old-1', time: 1 }],
        tonightDelivered: [{ id: 'old-1', time: 1 }],
        cupsDrunk: 3
      }
    }
  });
  t.after(() => stopServer(ctx));

  const reset = await req(ctx, '/agent/reset', { method: 'POST', token: ctx.tokens.charb, body: {} });
  assert.equal(reset.status, 200, `普通 reset 不该再 409：${JSON.stringify(reset.json)}`);

  const state = (await engines(ctx)).charb;
  assert.equal(state.currentCup, null, '没喝完的杯该被放弃');
  assert.equal(state.c, 0);
  // 历史一条不少
  assert.equal(state.records.length, 1, 'records 必须保留');
  assert.equal(state.tonightDelivered.length, 1, '递出历史必须保留');
  assert.equal(state.cupsDrunk, 3, 'cupsDrunk 不得被抹');

  // 放弃之后能接着喝
  const again = await drinkFromMenu(ctx, 'charb');
  assert.ok(Array.isArray(again.projection?.stateHints) && again.projection.stateHints.length > 0);
});

test('F2 管理员模式不受影响：明确指定「这晚不算」时仍拒绝未结算的杯', async (t) => {
  const ctx = await startServer({
    seedEngines: { charb: { currentCup: { id: 'stuck-cup', closed: false }, cupsDrunk: 1 } }
  });
  t.after(() => stopServer(ctx));
  const blocked = await req(ctx, '/agent/reset', {
    method: 'POST', token: ctx.tokens.charb, body: { mode: '这晚不算' }
  });
  assert.equal(blocked.status, 409, '既有管理员语义一个字不动');
  assert.equal(blocked.json.error, '当前杯尚未结算');
});
