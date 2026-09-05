import { readFile } from 'node:fs/promises';

const [action = 'home', resourceId, option] = process.argv.slice(2);
const agentId = process.env.PROOF_AGENT_ID;
const tokenFile = process.env.PROOF_AGENT_TOKEN_FILE;
const base = process.env.PROOF_API_URL || 'http://127.0.0.1:8791';

if (!agentId || !tokenFile) {
  console.error('PROOF_AGENT_ID and PROOF_AGENT_TOKEN_FILE are required');
  process.exit(2);
}

const token = (await readFile(tokenFile, 'utf8')).trim();
const routes = {
  home: { method: 'GET', path: '/agent/home' },
  view: { method: 'GET', path: `/agent/offers/${resourceId || ''}` },
  drink: { method: 'POST', path: `/agent/offers/${resourceId || ''}/drink` },
  reject: { method: 'POST', path: `/agent/offers/${resourceId || ''}/reject` },
  claim: { method: 'POST', path: '/agent/offers/claim', body: () => ({ capabilityToken: resourceId }) },
  accept: { method: 'POST', path: `/agent/proposals/${resourceId || ''}/accept` },
  'reject-change': { method: 'POST', path: `/agent/proposals/${resourceId || ''}/reject` },
  // 无参数 reset = 完整清理（等价「连宿醉一起清」）。
  // 「醒酒」是高级模式，必须显式指定。
  reset: { method: 'POST', path: '/agent/reset', body: { mode: resourceId || '连宿醉一起清' } },
  injection: { method: 'POST', path: '/agent/injection', body: { enabled: resourceId === 'on' || resourceId === 'true' || resourceId === '1' } }
};
const route = routes[action];
const routeBody = typeof route?.body === 'function' ? route.body() : route?.body;
if (!route || (!['home', 'reset', 'injection'].includes(action) && !resourceId)) {
  console.error('usage: agent-cli.mjs home | view/drink/reject OFFER_ID | claim CAPABILITY_TOKEN | accept/reject-change PROPOSAL_ID | reset [连宿醉一起清(默认，清当前影响与注入)|醒酒(留宿醉)|这晚不算(连今晚记录一起撤)] | injection [on|off]');
  process.exit(2);
}

const response = await fetch(`${base}${route.path}`, {
  method: route.method,
  headers: {
    authorization: `Bearer ${token}`,
    ...(action === 'drink' ? { 'idempotency-key': `${agentId}-${resourceId}` } : {}),
    ...(routeBody ? { 'content-type': 'application/json' } : {})
  },
  ...(routeBody ? { body: JSON.stringify(routeBody) } : {})
});
const result = await response.json();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!response.ok) process.exit(1);
