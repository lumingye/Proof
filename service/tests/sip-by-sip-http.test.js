// 分口喝：Agent 一次喝几口，手里那杯挂着，用 /agent/sip 接着喝。

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
async function whiskyId(ctx) { return ((await api(ctx, '/agent/home', { token: ctx.tokens.chara })).json.menu || []).find((d) => d.name === WHISKY).id; }

test('分口喝：先喝 1 口，酒吧页看得到手里那杯，再用 sip 接着喝完', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    const id = await whiskyId(ctx);
    const first = await api(ctx, `/agent/menu/${encodeURIComponent(id)}/drink`, { method: 'POST', token: ctx.tokens.chara, body: { mouths: 1 } });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.partial, true);
    assert.ok(first.json.remainingMouths >= 1);
    const total = first.json.totalMouths;

    const home = await api(ctx, '/agent/home', { token: ctx.tokens.chara });
    assert.equal(home.json.cupInHand.offerId, first.json.offerId);
    assert.equal(home.json.cupInHand.remainingMouths, total - 1);
    assert.equal(home.json.cupInHand.expiresInMin, 70);
    // 别的 Agent 手里没有
    assert.equal((await api(ctx, '/agent/home', { token: ctx.tokens.charb })).json.cupInHand, null);

    const sip = await api(ctx, '/agent/sip', { method: 'POST', token: ctx.tokens.chara, body: {} });
    assert.equal(sip.status, 200, sip.text);
    if (total - 1 > 1) assert.equal(sip.json.remainingMouths, total - 2);
    const rest = await api(ctx, '/agent/sip', { method: 'POST', token: ctx.tokens.chara, body: { mouths: 50 } });
    if (sip.json.partial) {
      assert.equal(rest.status, 200, rest.text);
      assert.equal(rest.json.partial, false);
    }
    assert.equal((await api(ctx, '/agent/home', { token: ctx.tokens.chara })).json.cupInHand, null);
    const none = await api(ctx, '/agent/sip', { method: 'POST', token: ctx.tokens.chara, body: {} });
    assert.equal(none.status, 404);
    assert.equal(none.json.error, 'no_cup_in_hand');
  } finally { await stop(ctx); }
});

test('分口喝：不传口数就是整杯；口数乱填报错', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    const id = await whiskyId(ctx);
    for (const bad of [0, -1, 1.5, 51, 'x']) {
      const r = await api(ctx, `/agent/menu/${encodeURIComponent(id)}/drink`, { method: 'POST', token: ctx.tokens.charc, body: { mouths: bad } });
      assert.equal(r.status, 400, `${bad}: ${r.text}`);
      assert.equal(r.json.error, 'invalid_mouths');
    }
    const whole = await api(ctx, `/agent/menu/${encodeURIComponent(id)}/drink`, { method: 'POST', token: ctx.tokens.charc, body: {} });
    assert.equal(whole.status, 200, whole.text);
    assert.equal(whole.json.partial, false);
    assert.equal((await api(ctx, '/agent/home', { token: ctx.tokens.charc })).json.cupInHand, null);
  } finally { await stop(ctx); }
});

test('吧台版：手里有半杯时点新的一杯，旧杯搁上吧台；带 offerId 能端回来，手里那杯换上去', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    const id = await whiskyId(ctx);
    const first = await api(ctx, `/agent/menu/${encodeURIComponent(id)}/drink`, { method: 'POST', token: ctx.tokens.chara, body: { mouths: 1 } });
    assert.equal(first.status, 200, first.text);
    const total = first.json.totalMouths;
    const second = await api(ctx, `/agent/menu/${encodeURIComponent(id)}/drink`, { method: 'POST', token: ctx.tokens.chara, body: { mouths: 1 } });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.putDown.offerId, first.json.offerId);
    assert.equal(second.json.putDown.shelved, true);
    assert.equal(second.json.putDown.remainingMouths, total - 1);
    assert.ok(second.json.putDown.hint);
    const home = await api(ctx, '/agent/home', { token: ctx.tokens.chara });
    assert.deepEqual(home.json.cupsOnBar.map((x) => x.offerId), [first.json.offerId]);
    if (second.json.partial) assert.equal(home.json.cupInHand.offerId, second.json.offerId);
    // 端回第一杯
    const back = await api(ctx, '/agent/sip', { method: 'POST', token: ctx.tokens.chara, body: { offerId: first.json.offerId, mouths: 1 } });
    assert.equal(back.status, 200, back.text);
    assert.equal(back.json.offerId, first.json.offerId);
    assert.equal(back.json.pickedUp.offerId, first.json.offerId);
    if (second.json.partial) assert.equal(back.json.putDown.offerId, second.json.offerId);
    const home2 = await api(ctx, '/agent/home', { token: ctx.tokens.chara });
    if (back.json.partial) assert.equal(home2.json.cupInHand.offerId, first.json.offerId);
    // 别人的杯 / 不在吧台上的杯
    const bogus = await api(ctx, '/agent/sip', { method: 'POST', token: ctx.tokens.chara, body: { offerId: 'nope' } });
    assert.equal(bogus.status, 404);
    assert.equal(bogus.json.error, 'cup_not_on_bar');
    const other = await api(ctx, '/agent/sip', { method: 'POST', token: ctx.tokens.charc, body: { offerId: first.json.offerId } });
    assert.equal(other.status, 404);
  } finally { await stop(ctx); }
});
