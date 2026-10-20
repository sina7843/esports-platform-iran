/* eslint-disable @typescript-eslint/no-explicit-any -- manual smoke client reading untyped JSON responses */
/**
 * ESP-04 live smoke (manual, local only), against a running API + worker with AUTH_DEV_LOGIN_ENABLED:
 *   pnpm --filter @esp/api exec tsx scripts/smoke-esp04.ts <apiBase> <devCode> <mongoUrl>
 * TEST ONLY setup through the fixture (published event, 8 confirmed players, an online mixed stage and an offline
 * final), then real HTTP: draw → structure → schedule → room/ready → results → next phase → transfer → LAN final
 * with venue, credential QR admission (replay refused), hall display safety and an emergency import.
 */
import { createContainer, seedIds } from '@esp/core';
import { clause, competition } from '@esp/core/testing';

const [base = 'http://127.0.0.1:3000/api/v1', devCode = '', mongo = ''] = process.argv.slice(2);
const jar = new Map<string, string>();
const step = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
};
async function call(who: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
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
  return { status: res.status, json };
}
async function login(who: string) {
  const res = await fetch(`${base}/auth/dev-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principalId: who, devCode }) });
  jar.set(who, res.headers.getSetCookie().find((x) => x.startsWith('esp_session='))!.split(';')[0]!);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ct = await createContainer({ serviceName: 'esp04-smoke', env: { ...process.env, MONGO_URL: mongo, LOG_LEVEL: 'silent' } });
const fx = await competition(ct, {
  clauses: [clause('points.win', 3), clause('points.draw', 1), clause('points.loss', 0), clause('tiebreak.order', ['head_to_head', 'score_diff']), clause('rr.legs', 1), clause('groups.count', 2), clause('groups.advance_per_group', 2), clause('elim.third_place', false), clause('match.bo', 1)],
  stages: [
    { name: 'مقدماتی آنلاین (TEST ONLY)', format: 'mixed', presence: 'online', phases: [{ key: 'groups', format: 'groups', advance: { perGroup: 2 } }, { key: 'playoff', format: 'single_elim', advance: null }] },
    { name: 'فینال حضوری (TEST ONLY)', format: 'single_elim', presence: 'offline', links: [{ fromStageId: 'PREV', kind: 'qualifier', slots: 2, points: 'reset', factor: null }] },
  ],
  n: 8,
});
await ct.close();
for (const p of [seedIds.organizer, seedIds.referee, ...fx.principals]) await login(p);
const org = seedIds.organizer;
const [online, lan] = fx.stageIds as [string, string];
const seeds = Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }]));

async function drawAndBuild(stageId: string, input: object) {
  const d = await call(org, 'POST', `/stages/${stageId}/draws`, input);
  for (const s of ['confirm', 'lock', 'publish']) await call(org, 'POST', `/draws/${d.json._id}/${s}`);
  const v = await call(null, 'GET', `/draws/${d.json._id}/verify`);
  const g = await call(org, 'POST', `/stages/${stageId}/structure`);
  return { ok: d.status === 201 && v.json?.reproducible === true && g.status === 201, slots: g.json?.slots };
}
/** plays every sided match of a stage via HTTP: open readiness, both ready, start, side 0 reports (better seed wins), referee finalises */
async function play(stageId: string) {
  let played = 0;
  for (let loop = 0; loop < 40; loop++) {
    const sched = await call(null, 'GET', `/events/${fx.eventId}/schedule?stageId=${stageId}&limit=200`);
    const open = (sched.json.items as any[]).filter((m) => m.state === 'scheduled');
    if (!open.length) break;
    const rounds = Math.min(...open.map((m) => m.slot.round));
    for (const m of open.filter((x) => x.slot.round === rounds)) {
      const room = await call(org, 'GET', `/matches/${m.id}/room`);
      void room;
      await call(org, 'POST', `/matches/${m.id}/readiness/open`);
      const ms = await ct2.c.matches.findOne({ _id: m.id });
      const [a, b] = ms!.sides.map((s: any) => s.roster[0].principalId);
      await call(a, 'POST', `/matches/${m.id}/ready`);
      await call(b, 'POST', `/matches/${m.id}/ready`);
      await call(org, 'POST', `/matches/${m.id}/run/start`);
      const winner = fx.participants.indexOf(ms!.participantIds![0]!) < fx.participants.indexOf(ms!.participantIds![1]!) ? 0 : 1;
      const r = await call(a, 'POST', `/matches/${m.id}/results`, { outcome: { kind: 'win', winnerSide: winner, maps: winner === 0 ? [1, 0] : [0, 1] } });
      const f = await call(seedIds.referee, 'POST', `/matches/${m.id}/finalize`, {});
      if (r.status !== 200 || f.json?.state !== 'final') step(`match ${m.id} played`, false, { r: r.status, f: f.json });
      played++;
    }
    await wait(1500); // the worker advances the bracket
  }
  return played;
}
const ct2 = await createContainer({ serviceName: 'esp04-smoke-read', env: { ...process.env, MONGO_URL: mongo, LOG_LEVEL: 'silent' } });

const built = await drawAndBuild(online, { method: 'manual', attributes: seeds });
step('online stage: draw reproducible, groups structure generated', built.ok, { slots: built.slots });
const pubBracket = await call(null, 'GET', `/stages/${online}/bracket?limit=50`);
step('public bracket readable without login', pubBracket.status === 200 && pubBracket.json.brackets.includes('G-A'), pubBracket.json.brackets);
const cfg = await call(org, 'PUT', `/events/${fx.eventId}/schedule-config`, { windows: [{ from: '2027-06-01T05:30:00.000Z', to: '2027-06-01T19:30:00.000Z' }], defaultDurationMinutes: 30, bufferMinutes: 5, minRestMinutes: 10, broadcastWindows: [], unavailable: [] });
const pr = await call(org, 'POST', `/events/${fx.eventId}/schedule/auto`, { stageId: online, from: '2027-06-01T05:30:00.000Z', reason: 'smoke plan' });
const hard = (pr.json.conflicts as any[]).filter((c) => c.hard).length;
const ap = await call(org, 'POST', `/schedule-proposals/${pr.json._id}/apply`, { confirm: true });
step('auto schedule proposal without hard conflicts, applied', cfg.status === 200 && pr.status === 201 && hard === 0 && ap.status === 200, { changes: pr.json.changes?.length, hard });
const groupsPlayed = await play(online);
step('group phase played through the room (12 matches)', groupsPlayed === 12, groupsPlayed);
const ph = await call(org, 'POST', `/stages/${online}/next-phase`);
step('next phase seeds 4 distinct qualifiers', ph.status === 200 && new Set(ph.json.entrants).size === 4, ph.json);
const playoffPlayed = await play(online);
step('playoff phase played (3 matches)', playoffPlayed === 3, playoffPlayed);
const st = await call(null, 'GET', `/stages/${online}/standings?limit=10`);
step('online stage complete with final standings', st.json.provisional === false, { provisional: st.json.provisional, top: st.json.rows?.[0]?.displayName });
const tr1 = await call(org, 'POST', `/stages/${lan}/transfer`, { fromStageId: online });
const tr2 = await call(org, 'POST', `/stages/${lan}/transfer`, { fromStageId: online });
step('transfer to the LAN final is idempotent', tr1.json.created === 2 && tr2.json.existing === 2, [tr1.json, tr2.json]);
const entries = await ct2.c.stageEntries.find({ stageId: lan }).toArray();
const builtLan = await drawAndBuild(lan, { method: 'qualifier', attributes: Object.fromEntries(entries.map((e) => [e.participationId, { qualifierRank: e.origin.rank }])) });
step('LAN final drawn by qualifier rank', builtLan.ok);

// LAN operations
const venue = await call(org, 'POST', `/events/${fx.eventId}/venues`, { name: 'سالن آزمون (TEST ONLY)', addressText: 'تهران، خیابان آزمون، پلاک ۱', parking: 'طبقه منفی یک', areas: [{ key: 'hall', name: 'سالن', kind: 'hall', capacity: 100 }, { key: 'aud', name: 'تماشاگران', kind: 'audience', capacity: 100 }] });
const stn = await call(org, 'POST', `/venues/${venue.json._id}/stations`, { areaKey: 'hall', label: 'A1' });
const ck = await call(org, 'PUT', `/stations/${stn.json._id}/checklist`, { items: [{ item: 'network', ok: true }, { item: 'monitor', ok: true }] });
const final = await ct2.c.matches.findOne({ stageId: lan, 'slot.key': 'W1-1' });
const asg = await call(org, 'POST', `/matches/${final!._id}/station`, { stationId: stn.json._id, reason: 'final on main stage' });
step('venue, station checklist → ready, station assigned', venue.status === 201 && ck.json.state === 'ready' && asg.status === 200);
const player = final!.sides[0]!.roster[0]!.principalId;
await call(org, 'POST', `/events/${fx.eventId}/credentials`, { principalId: player, role: 'player' });
const qr = (await call(player, 'GET', `/events/${fx.eventId}/my-qr`)).json.items[0].qr;
const in1 = await call(org, 'POST', `/events/${fx.eventId}/admissions`, { qr, gate: 'G1', area: 'hall' });
const in2 = await call(org, 'POST', `/events/${fx.eventId}/admissions`, { qr, gate: 'G2', area: 'hall' });
step('QR admits once; the replay is refused', in1.json?.admitted === true && in2.status === 403, [in1.status, in2.status]);
await call(org, 'PUT', `/matches/${final!._id}/lobby`, { host: 'lan-host-final', password: 'final-secret-77' });
await call(org, 'POST', `/matches/${final!._id}/callup`);
const hall = await call(null, 'GET', `/events/${fx.eventId}/hall`);
step('hall display public and free of lobby secrets', hall.status === 200 && !JSON.stringify(hall.json).includes('final-secret-77') && hall.json.called.length >= 1);
const lanPlayed = await play(lan);
step('LAN final played and the event path is complete', lanPlayed === 1 && (await call(null, 'GET', `/stages/${lan}/standings`)).json.provisional === false);
const freed = await ct2.c.stations.findOne({ _id: stn.json._id });
step('station released after the final', freed?.state === 'ready' && freed.matchId === null, freed?.state);
const integ = await call(null, 'GET', `/games/game_seed_synthetic/integration`);
step('integration disabled without a real adapter; manual path used (AC-18)', integ.json.enabled === false, integ.json.detail);
await ct2.close();
console.log(`event ${fx.eventId}; operations at http://localhost:5173/organizer/events/${fx.eventId}/operations`);
