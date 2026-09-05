import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function startServer(dir, agents) {
  const port = 25000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PROOF_HOST: '127.0.0.1',
      PROOF_PORT: String(port),
      PROOF_DATA_DIR: dir,
      PROOF_ALLOW_INSECURE_ADMIN_SETUP: 'true',
      PROOF_TEST_FIXED_CUP_IDS: 'true',
      ...(agents ? { PROOF_AGENTS: agents } : {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('listen_timeout')), 8000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => {
      if (code && code !== 0) { clearTimeout(timer); reject(new Error(`server_exit_${code}`)); }
    });
    child.on('error', reject);
  });
  return { child, port, base: `http://127.0.0.1:${port}` };
}

async function stopServer(ctx) {
  ctx.child.kill('SIGTERM');
  await new Promise((resolve) => ctx.child.once('exit', resolve));
}

test('N+1 Agent 只改 PROOF_AGENTS 即自动获得独立 token，既有身份不重置', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-agent-registry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const first = await startServer(dir);
  await stopServer(first);
  const before = JSON.parse(await readFile(join(dir, 'agents.json'), 'utf8'));
  const charbHash = before.charb.tokenHash;

  const agents = 'charb:CharB,chara:CharA,charc:CharC,chard:测试 Agent';
  const second = await startServer(dir, agents);
  t.after(() => stopServer(second));

  const after = JSON.parse(await readFile(join(dir, 'agents.json'), 'utf8'));
  assert.equal(after.charb.tokenHash, charbHash, '加入 N+1 Agent 不得重置既有 token');
  assert.ok(after['chard']?.tokenHash, '新 Agent 必须自动持久化 token hash');

  const tokenPath = join(dir, 'chard.token');
  const token = (await readFile(tokenPath, 'utf8')).trim();
  assert.ok(token.length >= 32, '新 Agent 必须生成独立 bearer token');
  assert.equal((await stat(tokenPath)).mode & 0o777, 0o600, 'token 文件必须是 0600');

  const response = await fetch(`${second.base}/agent/home`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  const home = await response.json();
  assert.equal(home.agent.id, 'chard');
  assert.equal(home.agent.name, '测试 Agent');
});
