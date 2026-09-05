#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createTurnBridge, hookAdditionalContext } from '../../engine/src/index.js';

const agentId = process.env.PROOF_AGENT_ID;
const tokenFile = process.env.PROOF_AGENT_TOKEN_FILE;
const base = process.env.PROOF_API_URL || 'http://127.0.0.1:8791';

async function stdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function main() {
  await stdinJson();
  if (!agentId || !tokenFile) process.exit(0);
  const token = (await readFile(tokenFile, 'utf8')).trim();
  const response = await fetch(`${base}/agent/turn-context`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) process.exit(0);
  const body = await response.json();
  if (!body?.injected || !body?.block) process.exit(0);
  const event = process.env.PROOF_HOOK_EVENT || '';
  const payload = hookAdditionalContext(body);
  if (!payload) process.exit(0);
  if (event.includes('pre_tool') || process.argv.includes('--pretool')) {
    payload.hookSpecificOutput.hookEventName = 'PreToolUse';
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main().catch(() => process.exit(0));
