// 特调自定义效果半衰期：调酒台存酒 → 酒单可见 → Agent 喝到的杯子带着它。

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



import { readdir } from 'node:fs/promises';

const RECIPE = [{ id: '伏特加', volume: 45 }, { id: '水', volume: 45 }];

test('存特调时填效果半衰期：存进去、酒单里看得到、Agent 喝到的杯子带着它', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    const saved = await api(ctx, '/human/menu', { method: 'POST', body: { name: '慢慢散', parts: RECIPE, effectHalfLifeMin: 45 } });
    assert.equal(saved.status, 201, saved.text);
    assert.equal(saved.json.drink.effectHalfLifeMin, 45);
    const row = (await api(ctx, '/human/menu')).json.drinks.find((d) => d.id === saved.json.drink.id);
    assert.equal(row.effectHalfLifeMin, 45);

    const drank = await api(ctx, `/agent/menu/${encodeURIComponent(saved.json.drink.id)}/drink`, { method: 'POST', token: ctx.tokens.chara, body: {} });
    assert.equal(drank.status, 200, drank.text);
    const files = (await readdir(ctx.dataDir)).filter((f) => f.endsWith('.json'));
    let found = false;
    for (const f of files) if ((await readFile(join(ctx.dataDir, f), 'utf8')).includes('"effectHalfLifeMin":45')) found = true;
    assert.ok(found, '喝下的杯子在存档里带着 effectHalfLifeMin');
  } finally { await stop(ctx); }
});

test('不填就是默认，旧接口不变；填了不合法直接报错，不悄悄改成默认', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    const plain = await api(ctx, '/human/menu', { method: 'POST', body: { name: '普通', parts: RECIPE } });
    assert.equal(plain.status, 201, plain.text);
    assert.equal(plain.json.drink.effectHalfLifeMin, null);
    for (const bad of [5, 181, 12.5, 'abc']) {
      const r = await api(ctx, '/human/menu', { method: 'POST', body: { name: `坏${bad}`, parts: RECIPE, effectHalfLifeMin: bad } });
      assert.equal(r.status, 400, `${bad}: ${r.text}`);
      assert.equal(r.json.error, 'invalid_effect_half_life');
    }
    // 效果时长只给存进酒单的酒；临时递一杯不收这个字段，也不因为它报错。
    const offer = await api(ctx, '/human/offers', { method: 'POST', body: { name: '递一杯', parts: RECIPE, effectHalfLifeMin: 999 } });
    assert.equal(offer.status, 201, offer.text);
  } finally { await stop(ctx); }
});
