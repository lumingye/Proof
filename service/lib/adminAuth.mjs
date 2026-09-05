import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'proof_admin';
// 管理会话有效期。原来是 12 小时——主人干一整天就要重输一次口令，
// 而这台机器是她自己的，威胁模型不是「别人坐到她电脑前」。
// 管理认证保持轻量，但仍要求首次设置、会话过期与安全比较。
// 拉到一年：登录一次基本不用再登，**但门仍然是关着的**——
// 页面在公网 URL 上，reset 与注入开关不能对任何拿到网址的人开放。
// cookie 仍是 HttpOnly + SameSite=Strict，口令不落页面也不落 localStorage。
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function signSession(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifySession(secret, token) {
  if (!token || !secret) return null;
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function mintSession(secret, actor = 'admin') {
  return signSession(secret, { actor, exp: Date.now() + MAX_AGE_MS, nonce: randomBytes(8).toString('hex') });
}

export function sessionCookie(token) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function adminFromRequest(req, { adminTokenHash, sessionSecret, hashToken }) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (bearer && adminTokenHash) {
    const candidate = Buffer.from(hashToken(bearer[1]));
    const expected = Buffer.from(adminTokenHash);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { type: 'admin', id: 'admin', via: 'bearer' };
    }
  }
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const session = verifySession(sessionSecret, token);
  if (session) return { type: 'admin', id: session.actor || 'admin', via: 'session' };
  return null;
}

export function writeAuthStatus(authenticated, configured = true) {
  return {
    adminConfigured: !!configured,
    setupRequired: !configured,
    authenticated: !!authenticated,
    actorType: authenticated ? 'admin' : 'anonymous',
    writes: {
      injection: 'admin',
      reset: 'admin',
      offers: 'open',
      menu: 'open',
      visibility: 'open',
      proposals: 'open'
    }
  };
}

export function auditRecord({ actorType, actorId, targetId, action, result }) {
  return {
    actorType,
    actorId: actorId || null,
    targetId,
    action,
    result,
    time: Date.now()
  };
}

export { COOKIE, MAX_AGE_MS };
