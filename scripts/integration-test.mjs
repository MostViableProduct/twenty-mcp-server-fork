#!/usr/bin/env node
// Integration test harness for the Twenty MCP server.
//
// Drives the bundled stdio server against a live Twenty instance via the
// MCP client SDK. Exercises every registered tool with synthetic data,
// reports a pass/fail row per test, and exits 1 if any required test
// failed (so CI can gate on it).
//
// Pre-req: scripts/.twenty.env from scripts/spin-up-twenty.sh, with
// TWENTY_BASE_URL + TWENTY_API_KEY (+ TWENTY_TAG echoed for the report).
//
// Usage:
//   bash scripts/spin-up-twenty.sh
//   node scripts/integration-test.mjs [--json]

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const envFile = join(here, '.twenty.env');

if (!existsSync(envFile)) {
  console.error(`[integration] missing ${envFile} — run scripts/spin-up-twenty.sh first.`);
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const wantJson = process.argv.includes('--json');
const distEntry = join(repoRoot, 'dist', 'index.js');
if (!existsSync(distEntry)) {
  console.error(`[integration] dist/index.js not built; run "npm run build" first.`);
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: [distEntry],
  env: {
    ...process.env,
    TWENTY_BASE_URL: env.TWENTY_BASE_URL,
    TWENTY_API_KEY: env.TWENTY_API_KEY,
  },
  stderr: 'pipe',
});

const client = new Client({ name: 'integration', version: '0.1.0' }, { capabilities: {} });
const stderrChunks = [];
transport.stderr?.on('data', b => stderrChunks.push(b));

await client.connect(transport);
const { tools } = await client.listTools();
const toolNames = new Set(tools.map(t => t.name));

const results = [];
async function check(name, args, validate, opts = {}) {
  const required = opts.required ?? true;
  const aliases = opts.aliases ?? [];
  // Resolve to the first available alias so we tolerate minor renames in
  // upstream (e.g., search_contacts vs search_people).
  const resolved = [name, ...aliases].find(n => toolNames.has(n));
  if (!resolved) {
    results.push({ name, status: 'SKIP', detail: 'not registered', required });
    return null;
  }
  try {
    const r = await client.callTool({ name: resolved, arguments: args });
    const text = (r.content ?? [])
      .map(c => (c.type === 'text' ? c.text : `[${c.type}]`))
      .join('\n');
    if (r.isError) {
      results.push({ name, status: 'FAIL', detail: text.slice(0, 200), required });
      return null;
    }
    // The server returns errors as text in non-isError responses too — check.
    if (/^Error /i.test(text) || /\bDid you mean\b/.test(text) || /Cannot query field/.test(text)) {
      results.push({ name, status: 'FAIL', detail: text.slice(0, 200), required });
      return null;
    }
    const v = validate ? validate(text, r) : null;
    if (v && v.fail) {
      results.push({ name, status: 'FAIL', detail: v.fail.slice(0, 200), required });
      return null;
    }
    results.push({ name, status: 'PASS', detail: (v?.note ?? text.slice(0, 80)).replace(/\s+/g, ' '), required });
    return { text, raw: r };
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: String(e.message ?? e).slice(0, 200), required });
    return null;
  }
}

const stamp = Date.now();
const probeFirst = `Synthetic`;
const probeLast = `Probe-${stamp}`;
let createdContactId = null;
let createdCompanyId = null;
let createdNoteId = null;
let createdTaskId = null;

// ---- Metadata tools ----
await check('list_all_objects', { activeOnly: true }, t => {
  if (!/Standard Objects/i.test(t) && !/standard/i.test(t)) return { fail: 'no Standard Objects section' };
  if (!/Person|person/.test(t)) return { fail: 'expected Person in object list' };
  return { note: 'standard objects surfaced' };
});

await check('get_object_schema', { objectName: 'person' }, t => {
  if (!/Fields/i.test(t)) return { fail: 'no Fields section' };
  if (!/firstName/i.test(t) && !/name/i.test(t)) return { fail: 'no name field surfaced' };
  return { note: 'person schema returned' };
});

await check('get_object_schema', { objectName: 'opportunity' }, t => {
  if (!/Fields/i.test(t)) return { fail: 'no Fields section' };
  return { note: 'opportunity schema returned' };
});

await check('get_field_metadata', { objectName: 'person', activeOnly: true }, null, { required: false });

// ---- Contacts (Person) ----
await check('search_contacts', { query: 'Ivan', limit: 5 }, t => {
  if (!/Ivan/.test(t)) return { fail: 'seeded "Ivan Zhao" not found' };
  return { note: 'search hit seeded contact' };
});

const create = await check(
  'create_contact',
  { firstName: probeFirst, lastName: probeLast, email: `probe-${stamp}@twenty-mcp.test`, jobTitle: 'IT Subject' },
  t => {
    const m = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    if (!m) return { fail: 'no UUID returned for created contact' };
    createdContactId = m[0];
    return { note: `id=${m[0].slice(0, 8)}` };
  },
);

if (createdContactId) {
  await check('get_contact', { id: createdContactId }, t => {
    if (!t.includes(probeLast)) return { fail: 'created contact lastName not in get_contact response' };
    return { note: 'round-tripped' };
  });
  await check(
    'update_contact',
    { id: createdContactId, jobTitle: 'IT Subject (updated)' },
    null,
  );
  await check('search_contacts', { query: probeLast, limit: 5 }, t => {
    if (!t.includes(probeLast)) return { fail: 'created contact not findable post-create' };
    return { note: 'searchable post-create' };
  });
}

// ---- Companies ----
await check(
  'create_company',
  { name: `IT Co ${stamp}`, domainName: `it-${stamp}.example.com`, employees: 10 },
  t => {
    const m = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    if (!m) return { fail: 'no UUID returned for created company' };
    createdCompanyId = m[0];
    return { note: `id=${m[0].slice(0, 8)}` };
  },
);
if (createdCompanyId) {
  await check('get_company', { id: createdCompanyId }, t => {
    if (!t.includes(`IT Co ${stamp}`)) return { fail: 'company name missing' };
    return { note: 'round-tripped' };
  });
  await check('search_companies', { query: `IT Co ${stamp}`, limit: 5 }, t => {
    if (!t.includes(`IT Co ${stamp}`)) return { fail: 'company not findable post-create' };
    return { note: 'searchable post-create' };
  });
}

// ---- Notes & Tasks (the body→bodyV2 path) ----
if (createdContactId) {
  await check(
    'create_note',
    { title: 'IT exercise note', body: `Synthetic ${stamp}`, targetIds: [createdContactId] },
    t => {
      const m = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      if (m) createdNoteId = m[0];
      return { note: createdNoteId ? `id=${m[0].slice(0, 8)}` : 'created' };
    },
  );
  await check(
    'create_task',
    { title: `IT exercise task ${stamp}`, body: 'Synthetic', targetIds: [createdContactId], status: 'TODO' },
    t => {
      const m = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      if (m) createdTaskId = m[0];
      return { note: createdTaskId ? `id=${m[0].slice(0, 8)}` : 'created' };
    },
  );
  await check('get_tasks', { limit: 10 }, t => {
    if (!t.includes(`IT exercise task ${stamp}`)) return { fail: 'task not surfaced by get_tasks' };
    return { note: 'task visible after create' };
  });
}

// ---- Opportunities ----
const oppCreate = await check(
  'create_opportunity',
  // amount is { value, currency } per the tool's zod schema.
  { name: `IT opp ${stamp}`, amount: { value: 100, currency: 'USD' }, stage: 'NEW' },
  null,
  { required: false },
);
if (oppCreate) {
  const m = oppCreate.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  if (m) await check('get_opportunity', { id: m[0] }, null, { required: false });
  await check('list_opportunities_by_stage', { stage: 'NEW', limit: 5 }, null, { required: false });
}

// ---- Activities (read-only probes) ----
await check('get_activities', { limit: 5 }, null, { required: false });
if (createdContactId) {
  await check('get_entity_activities', { entityId: createdContactId, entityType: 'person', limit: 5 }, null, { required: false });
}

await client.close();

// ---- Report ----
const required = results.filter(r => r.required);
const passed = required.filter(r => r.status === 'PASS').length;
const failed = required.filter(r => r.status === 'FAIL').length;
const skipped = required.filter(r => r.status === 'SKIP').length;
const optionalFailed = results.filter(r => !r.required && r.status === 'FAIL').length;

if (wantJson) {
  console.log(JSON.stringify({
    twenty_tag: env.TWENTY_TAG,
    summary: { passed, failed, skipped, optionalFailed },
    results,
  }, null, 2));
} else {
  const w = (s, n) => String(s).padEnd(n);
  console.log(`\nTwenty MCP integration test — Twenty ${env.TWENTY_TAG}\n`);
  console.log(w('TOOL', 36), w('STATUS', 8), 'DETAIL');
  console.log('-'.repeat(120));
  for (const r of results) {
    const line = `${w(r.name, 36)} ${w(r.status, 8)} ${r.detail ?? ''}`;
    console.log(r.required ? line : `${line}  (optional)`);
  }
  console.log(`\nrequired: ${passed} passed / ${failed} failed / ${skipped} skipped`);
  if (optionalFailed) console.log(`optional: ${optionalFailed} failed (not gating)`);
  if (stderrChunks.length) {
    const tail = Buffer.concat(stderrChunks).toString().split('\n').slice(-5).join('\n');
    if (tail.trim()) console.log(`\nserver stderr (tail):\n${tail}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
