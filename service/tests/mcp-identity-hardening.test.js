import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function tokenFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'proof-mcp-hardening-'));
  const path = join(dir, 'agent.token');
  await writeFile(path, 'fake-token\n', { mode: 0o600 });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path;
}

async function fakeProof(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function spawnMcp({ agentId, tokenPath, base }) {
  return spawn(process.execPath, ['mcp.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PROOF_AGENT_ID: agentId,
      PROOF_AGENT_TOKEN_FILE: tokenPath,
      PROOF_API_URL: base
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

async function collectExit(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (b) => { stdout += String(b); });
  child.stderr.on('data', (b) => { stderr += String(b); });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return { code, stdout, stderr };
}

function readJsonLine(stream) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('json_line_timeout')), 3000);
    function onData(chunk) {
      buf += String(chunk);
      const idx = buf.indexOf('\n');
      if (idx < 0) return;
      clearTimeout(timer);
      stream.off('data', onData);
      try { resolve(JSON.parse(buf.slice(0, idx))); }
      catch (error) { reject(error); }
    }
    stream.on('data', onData);
  });
}

test('MCP 启动身份错配时 fail closed：声称 chara、token 实际 charb', async (t) => {
  const tokenPath = await tokenFile(t);
  const base = await fakeProof(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/agent/home') {
      res.end(JSON.stringify({ agent: { id: 'charb', name: 'CharB' } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });

  const child = spawnMcp({ agentId: 'chara', tokenPath, base });
  child.stdin.end();
  const result = await collectExit(child);
  assert.equal(result.code, 78);
  assert.match(result.stderr, /身份错配/);
  assert.match(result.stderr, /PROOF_AGENT_ID=chara/);
  assert.match(result.stderr, /实际属于 charb/);
  assert.equal(result.stdout, '', '错配身份不得启动 JSON-RPC 服务');
});

test('proof_turn_context 读取失败必须显式报错，不能伪装 hasState=false', async (t) => {
  const tokenPath = await tokenFile(t);
  const base = await fakeProof(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/agent/home') {
      res.end(JSON.stringify({ agent: { id: 'charb', name: 'CharB' } }));
      return;
    }
    if (req.url === '/agent/turn-context') {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, error: 'synthetic_unavailable' }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });

  const child = spawnMcp({ agentId: 'charb', tokenPath, base });
  t.after(() => child.kill('SIGTERM'));

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  const init = await readJsonLine(child.stdout);
  assert.equal(init.result.serverInfo.name, 'proof-charb');

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'proof_turn_context', arguments: {} } })}\n`);
  const called = await readJsonLine(child.stdout);
  const payload = JSON.parse(called.result.content[0].text);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'synthetic_unavailable');
  assert.equal(payload.status, 503);
  assert.equal('hasState' in payload, false, '读取失败不得伪装成无状态');

  child.stdin.end();
});

test('MCP menu drink stays belief-free; link drink exposes structured pre-drink beliefs; turn-context returns framing metadata', async (t) => {
  const tokenPath = await tokenFile(t);
  const base = await fakeProof(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/agent/home') {
      res.end(JSON.stringify({ agent: { id: 'charb', name: 'CharB' } }));
      return;
    }
    if (req.url === '/agent/turn-context') {
      res.end(JSON.stringify({
        hasState: true,
        active: true,
        injected: true,
        context: { label: '[Proof 状态]', text: '[Proof 状态]\n测试' },
        framing: { push: 'PUSH_FRAME', belief: 'BELIEF_FRAME', objective: null }
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });

  const child = spawnMcp({ agentId: 'charb', tokenPath, base });
  t.after(() => child.kill('SIGTERM'));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  await readJsonLine(child.stdout);

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  const listed = await readJsonLine(child.stdout);
  const drink = listed.result.tools.find((tool) => tool.name === 'proof_drink');
  const link = listed.result.tools.find((tool) => tool.name === 'proof_drink_link');
  assert.equal('beliefs' in drink.inputSchema.properties, false, '自主点菜单不该让模型预测 belief');
  assert.equal(link.inputSchema.properties.beliefs.type, 'array');
  assert.equal(link.inputSchema.properties.beliefs.items.properties.confidence.maximum, 1);
  assert.ok(link.inputSchema.properties.beliefs.items.properties.effects.properties['愉悦']);
  assert.equal('精度' in link.inputSchema.properties.beliefs.items.properties.effects.properties, false);
  assert.equal(link.inputSchema.properties.beliefs.items.properties.subjectiveDescription.maxLength, 120);

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'proof_turn_context', arguments: {} } })}\n`);
  const called = await readJsonLine(child.stdout);
  const payload = JSON.parse(called.result.content[0].text);
  assert.equal(payload.framing.push, 'PUSH_FRAME');
  assert.equal(payload.framing.belief, 'BELIEF_FRAME');
  assert.match(payload.internalUse, /自然改变你的注意、选择、反应和表达方式/);
  assert.match(payload.internalUse, /\{\{user\}\}/);
  assert.match(payload.internalUse, /一两点/);
  child.stdin.end();
});
