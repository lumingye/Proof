// 消息时间账本（提交 5 契约）：指纹/occurrence、幂等重试、会话隔离、不存正文、重启可匹配。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLedger, contentHashOf, fingerprintOf } from '../gateway/ledger.mjs';
import { makeTempDir, removeTempDir, createClock } from './lib/gatewayEnv.mjs';

const T0 = Date.UTC(2026, 8, 2, 12, 0, 0);

async function withLedger(fn) {
  const dir = await makeTempDir('gw-ld-');
  const clock = createClock(T0);
  const ledger = createLedger({ dataDir: dir, now: clock.now });
  try {
    return await fn({ ledger, clock, dir });
  } finally {
    await removeTempDir(dir);
  }
}

test('LD1 登记返回指纹；同文重复出现用 occurrenceIndex 区分（规则 33）', async () => {
  await withLedger(async ({ ledger }) => {
    const a = await ledger.register('charb', 'c1', { role: 'user', content: '再说一次？', at: T0 });
    const b = await ledger.register('charb', 'c1', { role: 'user', content: '再说一次？', at: T0 + 1000 });
    assert.equal(a.occurrenceIndex, 0);
    assert.equal(b.occurrenceIndex, 1);
    assert.notEqual(a.entry.fp, b.entry.fp);
    // 不同角色同文也算不同 fingerprint
    const c = await ledger.register('charb', 'c1', { role: 'assistant', content: '再说一次？', at: T0 + 2000 });
    assert.equal(c.occurrenceIndex, 0);
  });
});

test('LD2 重试同一 requestId 不重复登记（幂等）', async () => {
  await withLedger(async ({ ledger }) => {
    const first = await ledger.register('charb', 'c1', { role: 'user', content: 'hi', at: T0, requestId: 'req-1' });
    const again = await ledger.register('charb', 'c1', { role: 'user', content: 'hi', at: T0, requestId: 'req-1' });
    assert.equal(again.duplicate, true);
    assert.equal(again.entry.fp, first.entry.fp);
    const msgs = await ledger.messages('charb', 'c1');
    assert.equal(msgs.length, 1);
  });
});

test('LD3 不同 conversation 不串线（规则 32）', async () => {
  await withLedger(async ({ ledger }) => {
    await ledger.register('charb', 'c1', { role: 'user', content: '甲', at: T0 });
    await ledger.register('charb', 'c2', { role: 'user', content: '乙', at: T0 });
    await ledger.register('charc', 'c1', { role: 'user', content: '丙', at: T0 });
    assert.equal((await ledger.messages('charb', 'c1')).length, 1);
    assert.equal((await ledger.messages('charb', 'c2')).length, 1);
    assert.equal((await ledger.messages('charc', 'c1')).length, 1);
    assert.equal((await ledger.conversationCount('charb')), 2);
  });
});

test('LD4 正文默认不落盘：文件里搜不到原文（规则 36）', async () => {
  await withLedger(async ({ ledger, dir }) => {
    const secret = '这段原文不应出现在账本文件里';
    await ledger.register('charb', 'c1', { role: 'user', content: secret, at: T0 });
    const fileText = await readFile(ledger.file, 'utf8');
    assert.ok(!fileText.includes(secret), '正文不得落盘');
    assert.ok(fileText.includes(contentHashOf(secret)), '只存正文摘要');
  });
});

test('LD5 重启后账本仍能匹配（firstSeenAt 保留，规则 37）', async () => {
  await withLedger(async ({ ledger, dir }) => {
    await ledger.register('charb', 'c1', { role: 'user', content: '记得这条', at: T0 });
    const restarted = createLedger({ dataDir: dir, now: () => T0 + 60000 });
    const hit = await restarted.lookup('charb', 'c1', { role: 'user', contentHash: contentHashOf('记得这条'), occurrenceIndex: 0 });
    assert.ok(hit);
    assert.equal(hit.firstSeenAt, T0);
  });
});

test('LD6 fingerprint 由 role+摘要+occurrence 决定；规范化 role', async () => {
  assert.equal(fingerprintOf({ role: 'developer', contentHash: 'x', occurrenceIndex: 0 }), fingerprintOf({ role: 'system', contentHash: 'x', occurrenceIndex: 0 }));
  assert.notEqual(fingerprintOf({ role: 'user', contentHash: 'x', occurrenceIndex: 0 }), fingerprintOf({ role: 'user', contentHash: 'x', occurrenceIndex: 1 }));
  assert.notEqual(fingerprintOf({ role: 'user', contentHash: 'x', occurrenceIndex: 0 }), fingerprintOf({ role: 'assistant', contentHash: 'x', occurrenceIndex: 0 }));
});

test('LD7 会话 id 校验：拒绝穿越与非法字符；null 落到 default', async () => {
  await withLedger(async ({ ledger }) => {
    await ledger.register('charb', null, { role: 'user', content: 'x', at: T0 });
    assert.equal((await ledger.messages('charb', 'default')).length, 1);
    await assert.rejects(() => ledger.register('charb', '../etc', { role: 'user', content: 'x', at: T0 }), /invalid_conversation_id/);
    await assert.rejects(() => ledger.register('charb', 'a/b', { role: 'user', content: 'x', at: T0 }), /invalid_conversation_id/);
  });
});

test('LD8 只给消息保存 Proof 快照，不保存用户正文', async () => {
  await withLedger(async ({ ledger, dir }) => {
    const requestId = 'proof-1';
    await ledger.register('charb', 'c1', { role: 'user', content: '用户秘密正文', at: T0, requestId });
    await ledger.setProofContext('charb', 'c1', requestId, '[Proof 状态]\n微醺');
    const latest = await ledger.latestProofContext('charb', 'c1');
    assert.equal(latest.proofContext, '[Proof 状态]\n微醺');
    const disk = await readFile(ledger.file, 'utf8');
    assert.equal(disk.includes('用户秘密正文'), false);
  });
});
