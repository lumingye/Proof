// Gateway 身份映射（提交 4 契约）：token↔agentId、互不可见、匿名拒绝、无穿越。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createIdentity, hashToken, newGatewayToken, assertValidAgentId } from '../gateway/identity.mjs';
import { makeTempDir, removeTempDir } from './lib/gatewayEnv.mjs';

async function withIdentity(fn) {
  const dir = await makeTempDir('gw-id-');
  const identity = createIdentity({ dataDir: dir });
  try {
    return await fn({ identity, dir });
  } finally {
    await removeTempDir(dir);
  }
}

test('ID1 ensure 幂等：同一 Agent 两次取到同一 token', async () => {
  await withIdentity(async ({ identity }) => {
    const a = await identity.ensure('charb');
    const b = await identity.ensure('charb');
    assert.equal(a.token, b.token);
    assert.equal(a.agentId, 'charb');
  });
});

test('ID2 token→agentId 正确；错误/未知/空 token 返回 null', async () => {
  await withIdentity(async ({ identity }) => {
    const { token } = await identity.ensure('charc');
    assert.equal(await identity.agentIdForToken(token), 'charc');
    assert.equal(await identity.agentIdForToken('wrong-token'), null);
    assert.equal(await identity.agentIdForToken(null), null);
    assert.equal(await identity.agentIdForToken(''), null);
  });
});

test('ID3 重启后映射仍有效（同一文件目录重建实例）', async () => {
  await withIdentity(async ({ identity, dir }) => {
    const { token } = await identity.ensure('chara');
    const restarted = createIdentity({ dataDir: dir });
    assert.equal(await restarted.agentIdForToken(token), 'chara');
  });
});

test('ID4 Agent 隔离：A 的 token 不会命中 B；list 只含实际发放者', async () => {
  await withIdentity(async ({ identity }) => {
    const { token: a } = await identity.ensure('charb');
    await identity.ensure('charc');
    assert.equal(await identity.agentIdForToken(a), 'charb');
    assert.deepEqual((await identity.list()).sort(), ['charc', 'charb']);
  });
});

test('ID5 映射文件不落原文 token，原文在 0600 单独文件', async () => {
  await withIdentity(async ({ identity, dir }) => {
    const { token } = await identity.ensure('charb');
    const fileText = await readFile(identity.file, 'utf8');
    assert.ok(!fileText.includes(token), 'identity.json 不得含 token 原文');
    assert.ok(fileText.includes(hashToken(token)), 'identity.json 只存哈希');
    const raw = (await readFile(join(dir, 'charb.gateway-token'), 'utf8')).trim();
    assert.equal(raw, token);
  });
});

test('ID6 rotate 换 token 后旧 token 失效，新 token 生效', async () => {
  await withIdentity(async ({ identity }) => {
    const first = await identity.ensure('charb');
    const rotated = await identity.rotate('charb');
    assert.notEqual(rotated.token, first.token);
    assert.equal(await identity.agentIdForToken(first.token), null);
    assert.equal(await identity.agentIdForToken(rotated.token), 'charb');
  });
});

test('ID7 非法 agentId（穿越/斜杠/点目录）一律拒绝', async () => {
  await withIdentity(async ({ identity }) => {
    for (const bad of ['../charb', 'a/b', 'a\\b', '..', 'charb..x']) {
      await assert.rejects(() => identity.ensure(bad), /invalid_agent_id/);
    }
    assert.equal(assertValidAgentId('charb_1'), 'charb_1');
    assert.equal(newGatewayToken().length > 40, true);
  });
});
