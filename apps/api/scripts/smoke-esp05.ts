/* eslint-disable @typescript-eslint/no-explicit-any -- manual smoke client reading untyped JSON responses */
/**
 * ESP-05 live smoke (manual, local only), against a running API + worker with AUTH_DEV_LOGIN_ENABLED:
 *   pnpm --filter @esp/api exec tsx scripts/smoke-esp05.ts <apiBase> <devCode> <mongoUrl>
 * TEST ONLY setup through the fixture (published rated event, 4 confirmed players, single elimination) and two extra
 * principals for head referee / appeal authority. Then real HTTP: officials → draw → readiness (presence) → results
 * confirmed by the opponent → a contested result decided in a case with appeal → finish → close with approval →
 * honors, certificates, verify, share card → rating system build visible on the leaderboard (worker job).
 */
import { createContainer, seedIds } from '@esp/core';
import { clause, competition } from '@esp/core/testing';

const [base = 'http://127.0.0.1:3000/api/v1', devCode = '', mongo = ''] = process.argv.slice(2);
const jar = new Map<string, string>();
const step = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
};
async function call(who: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string; type: string }> {
  const headers: Record<string, string> = { 'x-requested-with': 'fetch' };
  if (who) headers['cookie'] = jar.get(who)!;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, text, type: res.headers.get('content-type') ?? '' };
}
async function login(who: string) {
  const res = await fetch(`${base}/auth/dev-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principalId: who, devCode }) });
  jar.set(who, res.headers.getSetCookie().find((x) => x.startsWith('esp_session='))!.split(';')[0]!);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const win = (side: 0 | 1) => ({ kind: 'win', winnerSide: side, scores: null, maps: null });

const suffix = Date.now().toString(36);
const head = `usr_smoke5_head_${suffix}`;
const appeal = `usr_smoke5_appeal_${suffix}`;
const ct = await createContainer({ serviceName: 'esp05-smoke', env: { ...process.env, MONGO_URL: mongo, LOG_LEVEL: 'silent' } });
const fx = await competition(ct, { clauses: [clause('elim.third_place', false), clause('dispute.appeal_minutes', 1), clause('result.decision', 'TEST ONLY: referee decides on evidence')], stages: [{ name: 'حذفی (TEST ONLY)', format: 'single_elim' }], n: 4 });
await ct.c.events.updateOne({ _id: fx.eventId }, { $set: { 'config.rated': true } });
const now = new Date().toISOString();
for (const id of [head, appeal]) await ct.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
await ct.close();
for (const p of [seedIds.organizer, seedIds.referee, seedIds.admin, head, appeal, ...fx.principals]) await login(p);
const org = seedIds.organizer;
const stageId = fx.stageIds[0]!;

// officials
step('appoint head referee', (await call(org, 'POST', `/events/${fx.eventId}/officials`, { principalId: head, role: 'head_referee' })).status === 200);
step('appoint appeal authority', (await call(org, 'POST', `/events/${fx.eventId}/officials`, { principalId: appeal, role: 'appeal_authority' })).status === 200);

// rated system published before the close (worker builds it)
const sys = await call(seedIds.admin, 'POST', '/ratings/systems', { gameId: 'game_seed_synthetic', mode: '5v5', platform: 'pc', subject: 'player', model: 'glicko2', params: { initialRating: 1500, initialRd: 350, initialVolatility: 0.06, tau: 0.5, periodDays: 7 }, carry: { kind: 'reset', factor: null }, inactivityDays: 365, tiebreak: ['games'], regionBasis: 'TEST ONLY profile region at result time', eventWeights: { standard: 1 }, eligibility: 'TEST ONLY rated events' });
step('rating system created (draft)', sys.status === 200, sys.json?.state);
step('rating system published', (await call(seedIds.admin, 'POST', `/ratings/systems/${sys.json.id}/publish`)).status === 200);

// event to active, draw and structure
for (const tr of ['close_registration', 'start_preparation']) {
  const ev = await call(org, 'GET', `/events/${fx.eventId}/manage`);
  await call(org, 'POST', `/events/${fx.eventId}/transitions`, { transition: tr, expectedVersion: ev.json.event.version });
}
const d = await call(org, 'POST', `/stages/${stageId}/draws`, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
for (const s of ['confirm', 'lock', 'publish']) await call(org, 'POST', `/draws/${d.json._id}/${s}`);
step('structure generated', (await call(org, 'POST', `/stages/${stageId}/structure`)).status === 201);
{
  const ev = await call(org, 'GET', `/events/${fx.eventId}/manage`);
  const act = await call(org, 'POST', `/events/${fx.eventId}/transitions`, { transition: 'activate', expectedVersion: ev.json.event.version });
  step('event active', act.status === 200, act.json?.state);
}
step('generic finalize refused', (await call(seedIds.referee, 'POST', `/matches/x/transitions`, { transition: 'finalize', expectedVersion: 0 })).status !== 200);

async function toLive(m: any) {
  await call(org, 'POST', `/matches/${m.id}/readiness/open`);
  const room = await call(seedIds.referee, 'GET', `/matches/${m.id}/room`);
  const lineup = room.json?.private?.lineup ?? [];
  for (const roster of lineup) if (roster) await call(roster[0].principalId, 'POST', `/matches/${m.id}/ready`);
  return call(org, 'POST', `/matches/${m.id}/run/start`);
}
async function principalsOf(matchId: string) {
  const room = await call(seedIds.referee, 'GET', `/matches/${matchId}/room`);
  return (room.json?.private?.lineup ?? []).map((r: any) => r?.[0]?.principalId as string);
}
const sched = async () => (await call(null, 'GET', `/events/${fx.eventId}/schedule?limit=50`)).json.items as any[];

// semi 1: confirmed by the opponent
const semis = (await sched()).filter((m) => m.state === 'scheduled');
const [s1, s2] = semis;
const live1 = await toLive(s1);
step('semi 1 live', live1.json?.state === 'live', live1.json?.state);
const [a1, b1] = await principalsOf(s1.id);
step('submitted provisional', (await call(a1!, 'POST', `/matches/${s1.id}/results`, { outcome: win(0) })).json?.state === 'provisional');
step('own confirmation refused', (await call(a1!, 'POST', `/matches/${s1.id}/results/confirm`)).status === 412);
const c1 = await call(b1!, 'POST', `/matches/${s1.id}/results/confirm`);
step('opponent confirmation finalises', c1.json?.state === 'final', c1.json?.state);

// semi 2: contested → case → decision → appeal → independent decision
await toLive(s2);
const [a2, b2] = await principalsOf(s2.id);
await call(a2!, 'POST', `/matches/${s2.id}/results`, { outcome: win(0) });
const kase = await call(b2!, 'POST', `/matches/${s2.id}/results/contest`, { claim: 'TEST ONLY: side one recorded the wrong winner' });
step('contest opened a case', kase.status === 200 && kase.json.role === 'party', kase.json?.state);
step('finalize blocked by open case', (await call(seedIds.referee, 'POST', `/matches/${s2.id}/finalize`, { outcome: win(0) })).status === 412);
const caseId = kase.json._id;
step('case assigned by head referee', (await call(head, 'POST', `/cases/${caseId}/assign`, { assignee: seedIds.referee })).status === 200);
await call(a2!, 'POST', `/cases/${caseId}/defense`, { text: 'TEST ONLY: our screenshot shows we won' });
await call(seedIds.referee, 'POST', `/cases/${caseId}/review`);
const dec = await call(seedIds.referee, 'POST', `/cases/${caseId}/decision`, { clauseKey: 'result.decision', publicSummary: 'Side one result confirmed on evidence', reasoning: 'PRIVATE: screenshot timestamps verified', effect: { kind: 'result_change', outcome: win(0) } });
step('first decision cites clause and finalises', dec.status === 200 && dec.json.decisions?.[0]?.rulesRef?.clauseKey === 'result.decision', dec.json?.state);
const pv = await call(b2!, 'GET', `/cases/${caseId}`);
step('party view hides reasoning', pv.status === 200 && !pv.text.includes('PRIVATE'));
const pub = await call(null, 'GET', `/events/${fx.eventId}/decisions`);
step('public decision has no private data', pub.status === 200 && !pub.text.includes('PRIVATE') && !pub.text.includes(b2!));
const ap = await call(b2!, 'POST', `/cases/${caseId}/appeal`, { text: 'TEST ONLY: please review the evidence again' });
step('appeal routed to independent authority', ap.status === 200);
step('first decider cannot decide appeal', (await call(seedIds.referee, 'POST', `/cases/${caseId}/appeal-decision`, { clauseKey: 'result.decision', publicSummary: 'Upheld on appeal review', reasoning: 'Evidence re-checked', effect: { kind: 'none' } })).status === 403);
const fin = await call(appeal, 'POST', `/cases/${caseId}/appeal-decision`, { clauseKey: 'result.decision', publicSummary: 'Upheld on appeal review', reasoning: 'Evidence re-checked', effect: { kind: 'none' } });
step('appeal decided, case closed', fin.json?.state === 'closed', fin.json?.state);

// final
await wait(1500); // consumer advances
const final = (await sched()).find((m) => m.state === 'scheduled');
step('final sided from the results', !!final);
if (final) {
  await toLive(final);
  const [fa, fb] = await principalsOf(final.id);
  await call(fa!, 'POST', `/matches/${final.id}/results`, { outcome: win(0) });
  step('final confirmed', (await call(fb!, 'POST', `/matches/${final.id}/results/confirm`)).json?.state === 'final');
}
await wait(1500);
const bl = await call(org, 'GET', `/events/${fx.eventId}/close-blockers`);
step('close blockers clear', bl.json?.canFinish === true && bl.json?.canClose === true, bl.json);
let ev = (await call(org, 'GET', `/events/${fx.eventId}/manage`)).json.event;
step('finish', (await call(org, 'POST', `/events/${fx.eventId}/finish`, { expectedVersion: ev.version })).status === 200);
ev = (await call(org, 'GET', `/events/${fx.eventId}/manage`)).json.event;
step('close without approval refused', (await call(org, 'POST', `/events/${fx.eventId}/close`, { expectedVersion: ev.version, approvalId: null })).status === 412);
const apr = await call(org, 'POST', '/approvals', { action: 'event.close', scope: { type: 'event', id: fx.eventId }, payload: {}, reason: 'TEST ONLY close' });
await call(seedIds.admin, 'POST', `/approvals/${apr.json.id}/decision`, { decision: 'approve', reason: 'TEST ONLY ok', expectedVersion: apr.json.version });
const closed = await call(org, 'POST', `/events/${fx.eventId}/close`, { expectedVersion: ev.version, approvalId: apr.json.id });
step('close applies honors once', closed.status === 200 && closed.json.effects?.honors?.issued >= 2, closed.json?.effects?.honors);
const again = await call(org, 'POST', `/events/${fx.eventId}/close`, { expectedVersion: ev.version + 1, approvalId: null });
step('close replay issues nothing new', again.status === 200 && again.json.effects?.honors?.issued === 0, again.json?.effects?.honors);
const honors = await call(null, 'GET', `/events/${fx.eventId}/honors`);
const champ = (honors.json.items ?? []).find((h: any) => h.label === 'champion');
step('champion honor public', !!champ && honors.json.items.filter((h: any) => h.label === 'champion').length === 1);
if (champ) {
  const v = await call(null, 'GET', `/verify/${champ.verifyCode}`);
  step('verify code valid', v.json?.valid === true);
  const card = await call(null, 'GET', `/honors/${champ.id}/card.svg`);
  step('share card is SVG with code', card.type.startsWith('image/svg+xml') && card.text.includes(champ.verifyCode));
  const certs = await call(champ.recipients[0].principalId, 'GET', '/me/certificates');
  step('certificates issued', (certs.json.items ?? []).length >= 1, (certs.json.items ?? []).map((c: any) => c.kind));
}
// rating build by the worker job (runs every 15 s)
let lb: any = null;
for (let i = 0; i < 8; i++) {
  lb = await call(null, 'GET', `/ratings/systems/${sys.json.id}/leaderboard`);
  if (lb.json?.rows?.length) break;
  await wait(5000);
}
step('leaderboard built by worker, labelled unapproved', (lb?.json?.rows?.length ?? 0) >= 2 && lb.json.label.text === 'internal_unapproved', { rows: lb?.json?.rows?.length, label: lb?.json?.label?.text });
const career = await call(null, 'GET', `/careers/players/${fx.principals[0]}`);
step('career from final results', career.json?.played >= 1, career.json?.played);
