/**
 * AC-21 / NFR load generator and synthetic dataset (manual, test environment only).
 *   MONGO_URL=<db the API uses> pnpm --filter @esp/api exec tsx scripts/loadgen.ts <apiBase> \
 *     [--sessions 10000] [--matches 300] [--operators 100] [--rps 500] [--duration 3600] [--write 0.2] [--out file.json]
 * 1. Builds a synthetic dataset directly in the database the API serves: TEST ONLY users with real sessions,
 *    one published event with a stream, and N live matches cloned from a played fixture (no real personal data).
 * 2. Drives an OPEN-LOOP request schedule at the target rate (80 % reads / 20 % writes by default) so latency under
 *    overload is not hidden by slowing the client, with `sessions` distinct bearer sessions and a slice of operators
 *    hitting the admin/ops views. Reports throughput, error rate and p50/p95/p99 per route family.
 * It measures HTTP request handling only; 10k simultaneous SSE connections are a separate soak (see docs/release).
 */
import { writeFileSync } from 'node:fs';
import { createContainer, runMigrations, seedDatabase, seedIds } from '@esp/core';
import { clause, competition, drawAndGenerate } from '@esp/core/testing';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:3000/api/v1';
const opt = (name: string, d: number) => Number(args[args.indexOf(`--${name}`) + 1]) || d;
const sessionsN = opt('sessions', 10000);
const matchesN = opt('matches', 300);
const operatorsN = opt('operators', 100);
const rps = opt('rps', 500);
const durationS = opt('duration', 3600);
const writeRatio = args.includes('--write') ? Number(args[args.indexOf('--write') + 1]) : 0.2;
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

const ct = await createContainer({ serviceName: 'loadgen' });
if (ct.config.isProduction) throw new Error('loadgen creates synthetic data; never run it against production');
await runMigrations(ct.dbh.db);
await seedDatabase(ct.c, ct.acl);
const t0 = Date.now();
console.log(`seeding ${sessionsN} sessions, ${matchesN} live matches ...`);
const fx = await competition(ct, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
await drawAndGenerate(ct, fx.stageIds[0]!);
const eventId = fx.eventId;
await ct.c.broadcastStreams.insertOne({ _id: `str_load_${Date.now()}`, eventId, role: 'primary', label: 'load', delaySeconds: 30 } as never).catch(() => undefined);
const proto = (await ct.c.matches.findOne({ eventId }))!;
const now = new Date().toISOString();
const matchDocs = Array.from({ length: Math.max(0, matchesN - 1) }, (_, i) => ({ ...proto, _id: `mch_load_${Date.now().toString(36)}_${i}`, state: 'live' as const, scheduledAt: now, slot: { ...proto.slot!, key: `load-${i}` }, version: 0 }));
for (let i = 0; i < matchDocs.length; i += 500) await ct.c.matches.insertMany(matchDocs.slice(i, i + 500) as never, { ordered: false });

const tokens: string[] = [];
const principals = Array.from({ length: sessionsN }, (_, i) => ({ _id: `usr_load_${Date.now().toString(36)}_${i}`, kind: 'user' as const, displayName: `بار ${i}`, locale: 'fa' as const, timeZone: 'Asia/Tehran', status: 'active' as const, aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 }));
for (let i = 0; i < principals.length; i += 1000) await ct.c.principals.insertMany(principals.slice(i, i + 1000) as never, { ordered: false });
for (const p of principals) tokens.push((await ct.sessions.create(p._id, { userAgent: 'loadgen' })).token);
// operators: staff roles on the load event so the admin/ops views are exercised
const operatorTokens: string[] = [];
for (let i = 0; i < operatorsN; i++) {
  const id = principals[i]?._id;
  if (!id) break;
  await ct.acl.grant({ principalId: id, role: 'organizer', scope: { type: 'organization', id: seedIds.orgA }, expiresAt: null, reason: 'loadgen' }, { principalId: 'system', requestId: 'loadgen' });
  operatorTokens.push(tokens[i]!);
}
await ct.close();
console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

type Sample = { family: string; ms: number; status: number };
const samples: Sample[] = [];
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
const reads: Array<[string, () => string]> = [
  ['live', () => `/live/events/${eventId}`],
  ['live-tab', () => `/live/events/${eventId}/tabs/${pick(['schedule', 'results', 'bracket', 'timeline'])}`],
  ['news', () => '/news'],
  ['home', () => '/home'],
];
async function one(): Promise<void> {
  const isWrite = Math.random() < writeRatio;
  const operator = !isWrite && operatorTokens.length > 0 && Math.random() < 0.05;
  const token = operator ? pick(operatorTokens) : pick(tokens);
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let family: string;
  let url: string;
  let init: RequestInit = { headers };
  if (isWrite) {
    family = 'write:chat';
    url = `/events/${eventId}/spectator-chat`;
    init = { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ text: `load ${Math.random().toString(36).slice(2, 8)}` }) };
  } else if (operator) {
    family = 'operator';
    url = `/admin/events/${eventId}/ops`;
  } else {
    const [f, u] = pick(reads);
    family = f;
    url = u();
  }
  const s = performance.now();
  let status: number;
  try {
    const res = await fetch(base + url, init);
    status = res.status;
    await res.arrayBuffer();
  } catch {
    status = 0;
  }
  samples.push({ family, ms: performance.now() - s, status });
}

console.log(`running ${rps} rps for ${durationS} s (${Math.round(writeRatio * 100)} % writes) ...`);
const start = performance.now();
const inflight = new Set<Promise<void>>();
let sent = 0;
let maxInflight = 0;
while ((performance.now() - start) / 1000 < durationS) {
  const due = Math.floor(((performance.now() - start) / 1000) * rps);
  while (sent < due) {
    const p = one().finally(() => inflight.delete(p));
    inflight.add(p);
    sent++;
  }
  maxInflight = Math.max(maxInflight, inflight.size);
  await new Promise((r) => setTimeout(r, 5));
}
await Promise.all(inflight);
const wall = (performance.now() - start) / 1000;

const pct = (a: number[], q: number) => (a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))]! : 0);
const families = [...new Set(samples.map((s) => s.family))];
const ok = (s: Sample) => s.status >= 200 && s.status < 400;
const report = {
  at: new Date().toISOString(),
  target: { sessions: 10000, liveMatches: 300, operators: 100, rps: 500, writeRatio: 0.2, durationSeconds: 3600 },
  run: { sessions: sessionsN, liveMatches: matchesN, operators: operatorTokens.length, rps, writeRatio, durationSeconds: durationS, wallSeconds: Math.round(wall), requests: samples.length, achievedRps: Math.round((samples.length / wall) * 10) / 10, maxInflight },
  errorRate: Math.round((samples.filter((s) => !ok(s) && s.status !== 429).length / Math.max(1, samples.length)) * 10000) / 100,
  rateLimited: samples.filter((s) => s.status === 429).length,
  statuses: Object.fromEntries([...new Set(samples.map((s) => s.status))].map((c) => [c, samples.filter((s) => s.status === c).length])),
  families: Object.fromEntries(families.map((f) => { const m = samples.filter((s) => s.family === f).map((s) => s.ms); return [f, { n: m.length, p50: Math.round(pct([...m], 0.5)), p95: Math.round(pct([...m], 0.95)), p99: Math.round(pct([...m], 0.99)) }]; })),
  host: { platform: process.platform, node: process.version },
};
console.log(JSON.stringify(report, null, 2));
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
