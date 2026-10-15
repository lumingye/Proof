// 调酒台的搅拌 / 摇和要一路带到服务端存酒和递酒（2026-10-09）。

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


test('调制方式：存酒单时服务端记住摇和/搅拌，乱填返回 400', async () => {
  const ctx = await startServer();
  try {
    assert.ok(ctx.started);
    const parts = [{ id: '金酒', volume: 45 }, { id: '青柠汁', volume: 20 }];
    const saved = await api(ctx, '/human/menu', { method: 'POST', body: { name: '摇过的金酒', parts, method: 'shake' } });
    assert.equal(saved.status, 201, saved.text);
    assert.equal(saved.json.drink.method, 'shake');
    const listed = (await api(ctx, '/human/menu')).json.drinks.find((d) => d.name === '摇过的金酒');
    assert.equal(listed.method, 'shake');
    const plain = await api(ctx, '/human/menu', { method: 'POST', body: { name: '直接倒的金酒', parts } });
    assert.equal(plain.json.drink.method, null);
    const bad = await api(ctx, '/human/menu', { method: 'POST', body: { name: '乱摇', parts, method: 'blend' } });
    assert.equal(bad.status, 400);
    const badOffer = await api(ctx, '/human/offers', { method: 'POST', body: { name: '乱摇', parts, method: 'blend' } });
    assert.equal(badOffer.status, 400);
    const offer = await api(ctx, '/human/offers', { method: 'POST', body: { name: '摇过的特调', parts, method: 'stir' } });
    assert.ok(offer.status < 300, offer.text);
  } finally { await stop(ctx); }
});
