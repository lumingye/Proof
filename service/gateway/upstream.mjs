// 上游配置解析（里程碑 3）。
//
// V1 不接收客户端指定的任何 base_url。每个协议固定一个服务端环境变量作为唯一上游：
//   PROOF_OPENAI_BASE_URL / PROOF_ANTHROPIC_BASE_URL
// 校验：仅 http/https；无 userinfo；host 不得是局域网/回环/保留地址；路径必须是指定前缀。
// 重定向一律不跟随（redirect:'manual'），因此不会绕过 allowlist。
//
// 测试专用逃生门：PROOF_GATEWAY_TEST_ALLOW_LOCAL=1 才允许 http 本地假上游，
// 生产默认关闭；它不是客户端可控的，只是服务端测试环境变量。

import { isIP } from 'node:net';

export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
export const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

export function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host)) {
    const ip = isIP(host);
    if (ip === 4) {
      const parts = host.split('.').map(Number);
      const [a, b] = parts;
      return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 169 && parts[1] === 254)
        || (a === 172 && b >= 16 && b <= 31) || a === 0;
    }
    if (ip === 6) return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8');
  }
  return false;
}

export function assertUpstreamBase(raw, { allowLocal = false, expectedPrefix = '/v1' } = {}) {
  if (!raw || typeof raw !== 'string') throw new Error('upstream_base_required');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('upstream_base_invalid');
  }
  if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) {
    throw new Error('upstream_protocol_must_be_https');
  }
  if (url.username || url.password) throw new Error('upstream_userinfo_forbidden');
  if (!allowLocal && isPrivateHost(url.hostname)) throw new Error('upstream_host_must_be_public');
  if (expectedPrefix && !(url.pathname === expectedPrefix || url.pathname.startsWith(`${expectedPrefix}/`))) {
    throw new Error(`upstream_path_prefix_must_be_${expectedPrefix}`);
  }
  if (url.search || url.hash) throw new Error('upstream_query_forbidden');
  return {
    baseUrl: raw.replace(/\/+$/, ''),
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? '443' : '80'),
    pathname: url.pathname
  };
}

export function resolveUpstreamConfig(env = {}) {
  const testLocal = env.PROOF_GATEWAY_TEST_ALLOW_LOCAL === '1';
  const openai = env.PROOF_OPENAI_BASE_URL === undefined
    ? assertUpstreamBase(DEFAULT_OPENAI_BASE)
    : assertUpstreamBase(env.PROOF_OPENAI_BASE_URL, { allowLocal: testLocal });
  const anthropic = env.PROOF_ANTHROPIC_BASE_URL === undefined
    ? assertUpstreamBase(DEFAULT_ANTHROPIC_BASE)
    : assertUpstreamBase(env.PROOF_ANTHROPIC_BASE_URL, { allowLocal: testLocal });
  return {
    openai: {
      ...openai,
      apiKey: String(env.PROOF_OPENAI_API_KEY || ''),
      auth: { scheme: 'Bearer', header: 'authorization' }
    },
    anthropic: {
      ...anthropic,
      apiKey: String(env.PROOF_ANTHROPIC_API_KEY || ''),
      auth: { scheme: 'x-api-key', header: 'x-api-key' }
    },
    testLocal
  };
}

export default { resolveUpstreamConfig, assertUpstreamBase, isPrivateHost };
