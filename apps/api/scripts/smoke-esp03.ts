/**
 * ESP-03 live smoke (manual, local only): run against an API started with AUTH_DEV_LOGIN_ENABLED and the dev gateway.
 *   pnpm --filter @esp/api exec tsx scripts/smoke-esp03.ts <apiBase> <devCode> <mongoUrl>
 * Prepares TEST ONLY readiness/rules data through the fixture, then drives the real HTTP flow:
 * create → discipline → publish → open → register → pay → simulated PSP → callback → receipt → reconciliation → CSV.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- manual smoke client reading untyped JSON responses */
import { createContainer, seedIds } from '@esp/core';
import { clause, preparePublishable } from '@esp/core/testing';

const [base = 'http://127.0.0.1:3000/api/v1', devCode = '', mongo = ''] = process.argv.slice(2);
const jar = new Map<string, string>();
const step = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
};
async function call(who: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, any>; headers: Headers; text: string }> {
  const headers: Record<string, string> = { 'x-requested-with': 'fetch' };
  if (who) headers['cookie'] = jar.get(who)!;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, redirect: 'manual', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* html or csv */
  }
  return { status: res.status, json, headers: res.headers, text };
}
async function login(who: string) {
  const res = await fetch(`${base}/auth/dev-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principalId: who, devCode }) });
  const c = res.headers.getSetCookie().find((x) => x.startsWith('esp_session='));
  step(`dev session ${who}`, res.status === 200 && !!c, res.status);
  jar.set(who, c!.split(';')[0]!);
}

const ct = await createContainer({ serviceName: 'esp03-smoke', env: { ...process.env, MONGO_URL: mongo, LOG_LEVEL: 'silent' } });
const pkg = await preparePublishable(ct, [clause('roster.min', 1)]);
await ct.close();

for (const p of [seedIds.organizer, seedIds.player, seedIds.finance]) await login(p);
const org = seedIds.organizer;
const slug = `smoke-${Date.now().toString(36)}`;
const ev = await call(org, 'POST', '/events', { organizerOrgId: seedIds.orgA, name: 'جام آزمایشی دود (TEST ONLY)', slug, startsAt: new Date(Date.now() + 4 * 3600_000).toISOString(), refundPolicy: { beforeDeadlinePercent: 100, afterDeadlinePercent: 50, onEventCancelPercent: 100, onDisqualificationPercent: 0, text: 'TEST ONLY policy' }, cancellationTerms: 'TEST ONLY', disputeTerms: 'TEST ONLY', prizes: [{ key: 'first', title: 'قهرمان', kind: 'cash', amountRial: 10_000_000, responsible: 'organizer' }] });
step('create event', ev.status === 201, ev.status);
const eventId = ev.json['id'];
const d = await call(org, 'POST', `/events/${eventId}/disciplines`, { name: 'انفرادی', gameId: 'game_seed_synthetic', gameVersion: 'test', platform: 'pc', mode: '5v5', rulesPackageId: pkg, participantKind: 'player', capacity: 1, feeRial: 3_000_000, registrationClosesAt: new Date(Date.now() + 3 * 3600_000).toISOString(), autoApprove: true });
step('add discipline (capacity 1)', d.status === 201, d.status);
const check = await call(org, 'GET', `/events/${eventId}/publish-check`);
step('publish-check ok', check.json['ok'] === true, check.json['problems']);
const pub = await call(org, 'POST', `/events/${eventId}/publish`);
step('publish', pub.status === 200, pub.status);
const open = await call(org, 'POST', `/events/${eventId}/transitions`, { transition: 'open_registration', expectedVersion: pub.json['version'] });
step('open registration', open.status === 200, open.status);

const detail = await call(null, 'GET', `/events/${eventId}`);
const dd = detail.json['disciplines']?.[0];
step('public detail: remaining 1, prize not guaranteed', dd?.remaining === 1 && detail.json['prizes']?.[0]?.guaranteed === false);
const reg = await call(seedIds.player, 'POST', `/disciplines/${d.json['id']}/registrations`, { acceptRulesHash: dd.rules.hash });
step('register → awaiting_payment', reg.status === 201 && reg.json['state'] === 'awaiting_payment', reg.json['state'] ?? reg.json);
const after = await call(null, 'GET', `/events/${eventId}`);
step('last place is held (remaining 0)', after.json['disciplines'][0].remaining === 0);
const pay = await call(seedIds.player, 'POST', `/orders/${reg.json['orderId']}/pay`, { returnUrl: 'http://localhost:5173/payments/return' });
step('pay → redirect to gateway', pay.status === 200 && !!pay.json['redirectUrl'], pay.json['redirectUrl']);
const ref = new URL(pay.json['redirectUrl']).pathname.split('/').pop()!;
const page = await call(null, 'GET', `/dev/gateway/${ref}`);
step('simulated PSP page labelled TEST ONLY', page.text.includes('TEST ONLY'));
const settle = await call(null, 'GET', `/dev/gateway/${ref}/settle?outcome=success`);
step('PSP settles and redirects to web origin', settle.status === 303 && (settle.headers.get('location') ?? '').startsWith('http://localhost:5173/payments/return?order='), settle.headers.get('location'));
// browser "drops" here: no verify call. The callback alone must settle the order; fulfilment runs in the outbox consumer.
let order = await call(seedIds.player, 'GET', `/orders/${reg.json['orderId']}`);
step('order paid with receipt', order.json['state'] === 'paid' && /^RC-/.test(order.json['receiptNo'] ?? ''), { state: order.json['state'], receiptNo: order.json['receiptNo'] });
let state = '';
for (let i = 0; i < 20 && state !== 'confirmed'; i++) {
  state = (await call(seedIds.player, 'GET', `/registrations/${reg.json['id']}`)).json['state'];
  if (state !== 'confirmed') await new Promise((r) => setTimeout(r, 500));
}
step('registration confirmed by the consumer (no browser)', state === 'confirmed', state);
const verify = await call(seedIds.player, 'POST', `/payments/${pay.json['paymentId']}/verify`);
step('late browser verify is idempotent', verify.json['state'] === 'verified', verify.json['state']);
order = await call(seedIds.player, 'GET', `/orders/${reg.json['orderId']}`);
step('one verified payment only', order.json['payments'].filter((p: { state: string }) => p.state === 'verified').length === 1);
const recon = await call(seedIds.finance, 'GET', '/finance/reconciliation');
step('finance reconciliation readable', recon.status === 200, Object.fromEntries(Object.entries(recon.json).map(([k, v]) => [k, (v as unknown[]).length])));
step('player cannot read reconciliation', (await call(seedIds.player, 'GET', '/finance/reconciliation')).status === 403);
const fin = await call(org, 'GET', `/events/${eventId}/financials`);
step('event financials show the entry', fin.json['ordersByKind']?.entry?.grossRial === 3_000_000, fin.json['ordersByKind']);
// Response.text() strips a BOM while decoding, so check the raw bytes
const csvRes = await fetch(`${base}/finance/ledger.csv`, { headers: { cookie: jar.get(seedIds.finance)! } });
const bytes = new Uint8Array(await csvRes.arrayBuffer());
step('ledger CSV starts with a UTF-8 BOM', csvRes.status === 200 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, csvRes.status);
console.log(`event ${eventId} (${slug}); manage at http://localhost:5173/organizer/events/${eventId}`);
