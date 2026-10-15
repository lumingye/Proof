// 今日酒单：详细介绍给 Agent 看的全局开关 + 快捷酒单推送（2026-10-09）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REGISTRY = 'charb:CharB,chara:CharA,charc:CharC,ark:阿克';
const AGENT_IDS = ['charb', 'chara', 'charc', 'ark'];

async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function startServer(extraEnv = {}) {
  const dir = extraEnv.PROOF_DATA_DIR ? null : await mkdtemp(join(tmpdir(), 'proof-dyn-'));
  const dataDir = dir || extraEnv.PROOF_DATA_DIR;
  const port = 27000 + Math.floor(Math.random() * 800);
  const env = {
    ...process.env,
    PROOF_HOST: '127.0.0.1',
    PROOF_PORT: String(port),
    PROOF_DATA_DIR: dataDir,
    PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
    PROOF_AGENTS: REGISTRY,
    ...extraEnv
  };
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 12_000);
    child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(true); } });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  const ctx = { dir, child, base: `http://127.0.0.1:${port}`, started };
  if (!started) return ctx;
  await fetch(`${ctx.base}/human/admin/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-owner-admin-password' }) });
  ctx.dataDir = dataDir;
  ctx.tokens = {};
  for (const id of AGENT_IDS) {
    ctx.tokens[id] = (await readFile(join(dataDir, `${id}.token`), 'utf8')).trim();
  }
  return ctx;
}

async function stop(ctx) { await killChild(ctx.child); if (ctx.dir) await rm(ctx.dir, { recursive: true, force: true }); }

async function api(ctx, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`${ctx.base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: r.status, json, text };
}


const WHISKY = '威士忌';
const whisky = async (ctx) => ((await api(ctx, '/agent/home', { token: ctx.tokens.chara })).json.menu || []).find((d) => d.name === WHISKY);

test('详细介绍：全局开关，默认不给 Agent，打开后今日酒单带详细介绍，关上又没了', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    assert.equal((await api(ctx, '/human/menu')).json.detailForAgent, false);
    assert.equal((await whisky(ctx)).detail, undefined);
    const on = await api(ctx, '/human/detail-for-agent', { method: 'PATCH', body: { visible: true } });
    assert.equal(on.status, 200, on.text);
    assert.match((await whisky(ctx)).detail, /入口先是热/);
    assert.equal((await whisky(ctx)).intro, '一口一停的泥煤。');
    assert.equal((await api(ctx, '/human/menu')).json.detailForAgent, true);
    await api(ctx, '/human/detail-for-agent', { method: 'PATCH', body: { visible: false } });
    assert.equal((await whisky(ctx)).detail, undefined);
  } finally { await stop(ctx); }
});

test('快捷酒单：推给某个 Agent，它下一次 turn-context 收到一次，之后不再带；别的 Agent 不受影响', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    const before = await api(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
    assert.notEqual(before.json.menuPushed, true);
    assert.equal((await api(ctx, '/human/menu-push', { method: 'POST', body: { targetId: 'nobody' } })).status, 404);
    assert.equal((await api(ctx, '/human/menu-push', { method: 'POST', body: { targetId: 'chara' } })).status, 200);
    const other = await api(ctx, '/agent/turn-context', { token: ctx.tokens.charb });
    assert.notEqual(other.json.menuPushed, true);
    const first = await api(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
    assert.equal(first.json.menuPushed, true);
    assert.equal(first.json.injected, true);
    assert.match(first.json.block.text, /\[Proof 今日酒单\]/);
    assert.match(first.json.block.text, /威士忌（cup-威士忌）：一口一停的泥煤。/);
    const second = await api(ctx, '/agent/turn-context', { token: ctx.tokens.chara });
    assert.notEqual(second.json.menuPushed, true);
  } finally { await stop(ctx); }
});

test('特调详细介绍：经 Agent 确认后写入；开关打开后点单可见；超长报错', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    const saved = await api(ctx, '/human/menu', { method: 'POST', body: { name: '迷情剂', parts: [{ id: '伏特加', volume: 30 }, { id: '糖浆', volume: 15 }] } });
    assert.equal(saved.status, 201, saved.text);
    const id = saved.json.drink.id;
    const longDetail = '长'.repeat(301);
    assert.equal((await api(ctx, `/human/menu/${encodeURIComponent(id)}/proposals`, { method: 'POST', body: { targetId: 'chara', patch: { description: longDetail } } })).status, 400);
    assert.equal((await api(ctx, `/human/menu/${encodeURIComponent(id)}/proposals`, { method: 'POST', body: { targetId: 'chara', patch: { intro: '短'.repeat(61) } } })).status, 400);
    const prop = await api(ctx, `/human/menu/${encodeURIComponent(id)}/proposals`, { method: 'POST', body: { targetId: 'chara', patch: { intro: '一杯会让人心软的酒。', description: '入口是甜的，伏特加藏在糖浆后面。喝完会想多待一会儿。' } } });
    assert.equal(prop.status, 201, prop.text);
    const acc = await api(ctx, `/agent/proposals/${prop.json.proposalId}/accept`, { method: 'POST', token: ctx.tokens.chara, body: {} });
    assert.equal(acc.status, 200, acc.text);
    const listed = (await api(ctx, '/human/menu')).json.drinks.find((d) => d.id === id);
    assert.match(listed.description, /糖浆后面/);
    const find = async () => ((await api(ctx, '/agent/home', { token: ctx.tokens.chara })).json.menu || []).find((d) => d.id === id);
    assert.equal((await find()).intro, '一杯会让人心软的酒。');
    assert.equal((await find()).detail, undefined);
    await api(ctx, '/human/detail-for-agent', { method: 'PATCH', body: { visible: true } });
    assert.match((await find()).detail, /糖浆后面/);
  } finally { await stop(ctx); }
});
