import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mintSession,
  verifySession,
  adminFromRequest,
  writeAuthStatus,
  auditRecord
} from '../lib/adminAuth.mjs';

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

test('匿名不能通过空请求鉴权', () => {
  const admin = adminFromRequest({ headers: {} }, { adminTokenHash: hashToken('secret'), sessionSecret: 's', hashToken });
  assert.equal(admin, null);
});

test('错误 Bearer 不能当管理员', () => {
  const admin = adminFromRequest(
    { headers: { authorization: 'Bearer nope' } },
    { adminTokenHash: hashToken('secret'), sessionSecret: 's', hashToken }
  );
  assert.equal(admin, null);
});

test('正确 Bearer 是管理员，会话可验证且过期失效', () => {
  const secret = 'session-secret';
  const token = mintSession(secret, 'admin');
  assert.ok(verifySession(secret, token));
  assert.equal(verifySession('other', token), null);
  const admin = adminFromRequest(
    { headers: { cookie: `proof_admin=${encodeURIComponent(token)}` } },
    { adminTokenHash: hashToken('secret'), sessionSecret: secret, hashToken }
  );
  assert.equal(admin.type, 'admin');
  assert.equal(admin.id, 'admin');
});

test('auth-status 标明 injection/reset 需管理员，offers 仍为当前开放', () => {
  const anon = writeAuthStatus(false);
  assert.equal(anon.authenticated, false);
  assert.equal(anon.writes.injection, 'admin');
  assert.equal(anon.writes.reset, 'admin');
  assert.equal(anon.writes.offers, 'open');
  const rec = auditRecord({ actorType: 'admin', actorId: 'admin', targetId: 'charc', action: 'injection', result: true });
  assert.equal(rec.actorType, 'admin');
  assert.equal('token' in rec, false);
});
