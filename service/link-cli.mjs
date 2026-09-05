const [link, action = 'view'] = process.argv.slice(2);
if (!link || !['view', 'drink', 'reject'].includes(action)) {
  console.error('usage: node link-cli.mjs LINK [view|drink|reject]');
  process.exit(2);
}

let parsed;
try { parsed = new URL(link); }
catch { console.error('invalid link'); process.exit(2); }
const token = parsed.hash.slice(1);
if (!token) { console.error('link has no capability'); process.exit(2); }

const api = `${parsed.origin}/proof-api/capability/offer`;
const response = await fetch(api, {
  method: action === 'view' ? 'GET' : 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    ...(action === 'view' ? {} : { 'content-type': 'application/json' })
  },
  ...(action === 'view' ? {} : { body: JSON.stringify({ action }) })
});
const result = await response.json();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!response.ok) process.exit(1);
