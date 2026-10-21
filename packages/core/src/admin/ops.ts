import { statfs } from 'node:fs/promises';
import { type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import { adaptersHealth } from '../adapters/registry.js';

const iso = () => new Date().toISOString();
const SITE: Scope = { type: 'site', id: 'site' };
const OPEN_CASE = ['filed', 'assigned', 'defense_received', 'under_review', 'first_decision', 'appeal'];
const DELAY_MIN = 15;

/** ADM-005 event operations dashboard: registration, check-in, live, delays, cases, resources and alerts in one view. */
export class OpsDashboardService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async event(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'event.read_private', { type: 'event', id: eventId }, requestId);
    const now = iso();
    const late = new Date(Date.now() - DELAY_MIN * 60_000).toISOString();
    const group = async <T extends string>(col: 'registrations' | 'matches', key: string): Promise<Record<T, number>> =>
      Object.fromEntries((await (this.c[col] as unknown as { aggregate: (p: unknown[]) => { toArray(): Promise<Array<{ _id: T; n: number }>> } }).aggregate([{ $match: { eventId } }, { $group: { _id: `$${key}`, n: { $sum: 1 } } }]).toArray()).map((r) => [r._id, r.n])) as Record<T, number>;
    const [registrations, matches] = await Promise.all([group('registrations', 'state'), group('matches', 'state')]);
    const regIds = (await this.c.registrations.find({ eventId }, { projection: { _id: 1 } }).toArray()).map((r) => r._id);
    const checkins = Object.fromEntries((await this.c.checkins.aggregate<{ _id: string; n: number }>([{ $match: { registrationId: { $in: regIds } } }, { $group: { _id: '$state', n: { $sum: 1 } } }]).toArray()).map((r) => [r._id, r.n]));
    const delayed = await this.c.matches.find({ eventId, scheduledAt: { $ne: null, $lt: late }, state: { $in: ['scheduled', 'awaiting_readiness', 'ready', 'pre_game_selection'] } }, { projection: { slot: 1, scheduledAt: 1, state: 1 } }).limit(100).toArray();
    const live = await this.c.matches.find({ eventId, state: { $in: ['live', 'paused'] } }, { projection: { slot: 1, state: 1, sides: 1 } }).limit(100).toArray();
    const cases = await this.c.disputes.countDocuments({ eventId, state: { $in: OPEN_CASE as never } });
    const stations = Object.fromEntries((await this.c.stations.aggregate<{ _id: string; n: number }>([{ $match: { eventId } }, { $group: { _id: '$state', n: { $sum: 1 } } }]).toArray()).map((r) => [r._id, r.n]));
    const servers = await this.c.gameServers.find({ $or: [{ eventId }, { eventId: null }], enabled: true }, { projection: { name: 1, health: 1, capacity: 1, inUse: 1 } }).toArray();
    const incidents = await this.c.incidents.countDocuments({ eventId, state: 'active' });
    const tickets = await this.c.supportTickets.countDocuments({ 'links.eventId': eventId, state: { $in: ['open', 'pending'] } });
    const overdueTickets = await this.c.supportTickets.countDocuments({ 'links.eventId': eventId, state: { $in: ['open', 'pending'] }, slaDueAt: { $lt: now } });
    const corrections = await this.c.corrections.countDocuments({ eventId, state: { $in: ['failed', 'blocked_dependency'] } });
    const alerts: Array<{ level: 'warn' | 'critical'; kind: string; detail: string }> = [];
    if (delayed.length) alerts.push({ level: 'warn', kind: 'delayed_matches', detail: `${delayed.length} matches more than ${DELAY_MIN} minutes late` });
    if (cases) alerts.push({ level: 'warn', kind: 'open_cases', detail: `${cases} open cases` });
    if (incidents) alerts.push({ level: 'critical', kind: 'incidents', detail: `${incidents} active incidents` });
    if (overdueTickets) alerts.push({ level: 'warn', kind: 'tickets_overdue', detail: `${overdueTickets} tickets past their SLA` });
    if (corrections) alerts.push({ level: 'critical', kind: 'corrections', detail: `${corrections} corrections failed or blocked` });
    const down = servers.filter((s) => s.health === 'down');
    if (down.length) alerts.push({ level: 'critical', kind: 'servers_down', detail: down.map((s) => s.name).join(', ') });
    const freeServers = servers.reduce((t, s) => t + Math.max(0, s.capacity - s.inUse), 0);
    if (servers.length && freeServers === 0) alerts.push({ level: 'warn', kind: 'server_capacity', detail: 'no free game-server capacity' });
    if ((stations['faulty'] ?? 0) > 0) alerts.push({ level: 'warn', kind: 'stations_faulty', detail: `${stations['faulty']} faulty stations` });
    return { at: now, registrations, checkins, matches, live: live.map((m) => ({ id: m._id, slot: m.slot?.key ?? null, state: m.state, sides: m.sides.map((s) => s.displayName) })), delayed: delayed.map((m) => ({ id: m._id, slot: m.slot?.key ?? null, scheduledAt: m.scheduledAt, state: m.state })), cases, incidents, tickets, resources: { stations, servers: servers.map((s) => ({ name: s.name, health: s.health, free: Math.max(0, s.capacity - s.inUse) })) }, alerts };
  }
}

/** ADM-011 performance, satisfaction, finance, media and resource reports; sponsor export as CSV. */
export class ReportService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async platform(range: { from: string; to: string }, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'admin.reports', SITE, requestId);
    const r = { $gte: range.from, $lt: range.to };
    const sum = async (kind: string) => (await this.c.ledger.aggregate<{ t: number }>([{ $match: { kind, createdAt: r, account: { $regex: '^cash:' } } }, { $group: { _id: null, t: { $sum: '$amountRial' } } }]).toArray())[0]?.t ?? 0;
    const fb = await this.c.feedback.aggregate<{ n: number; avg: number }>([{ $match: { createdAt: r } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$score' } } }]).toArray();
    const openPrizes = await this.c.prizes.aggregate<{ t: number; n: number }>([{ $match: { state: { $nin: ['paid', 'cancelled'] } } }, { $group: { _id: null, t: { $sum: '$amountRial' }, n: { $sum: 1 } } }]).toArray();
    return {
      range,
      performance: { eventsCreated: await this.c.events.countDocuments({ createdAt: r }), eventsClosed: await this.c.eventArchives.countDocuments({ closedAt: r }), matchesFinal: await this.c.resultVersions.countDocuments({ targetType: 'match', calcVersion: 'official', createdAt: r }), registrationsConfirmed: await this.c.registrations.countDocuments({ state: 'confirmed', updatedAt: r }) },
      satisfaction: { responses: fb[0]?.n ?? 0, average: fb[0] ? Math.round(fb[0].avg * 10) / 10 : null },
      finance: { collectedRial: await sum('payment'), refundedRial: Math.abs(await sum('refund')), openPrizeObligationsRial: openPrizes[0]?.t ?? 0, openPrizeObligations: openPrizes[0]?.n ?? 0 },
      media: { postsPublished: await this.c.newsPosts.countDocuments({ publishedAt: r }), automaticPosts: await this.c.newsPosts.countDocuments({ publishedAt: r, source: 'automatic' }), videos: await this.c.mediaItems.countDocuments({ createdAt: r }) },
      resources: { stations: await this.c.stations.countDocuments({}), servers: await this.c.gameServers.countDocuments({ enabled: true }), incidents: await this.c.incidents.countDocuments({ createdAt: r }) },
      support: { ticketsOpened: await this.c.supportTickets.countDocuments({ createdAt: r }), ticketsOpen: await this.c.supportTickets.countDocuments({ state: { $in: ['open', 'pending'] } }) },
    };
  }
  /** Sponsor-ready CSV for one event (facts recorded by the platform only). */
  async sponsorCsv(eventId: string, actor: string, requestId: string): Promise<string> {
    await this.ct.acl.require(actor, 'admin.reports', { type: 'event', id: eventId }, requestId);
    const { EventCloseService } = await import('../honors/close.js');
    const rep = await new EventCloseService(this.ct).report(eventId, actor, requestId);
    const posts = await this.c.newsPosts.countDocuments({ eventId, state: { $in: ['published', 'corrected'] } });
    const videos = await this.c.mediaItems.countDocuments({ eventId });
    const rows: Array<[string, string | number]> = [
      ['event', rep.event.name], ['state', rep.event.state], ['participants', rep.participants], ['matches', rep.matches], ['final_matches', rep.finalMatches],
      ['feedback_responses', rep.feedback.count], ['feedback_average', rep.feedback.average ?? ''], ['prizes_total_rial', rep.prizes.totalRial], ['prizes_paid_rial', rep.prizes.paidRial], ['prizes_open_rial', rep.prizes.openRial],
      ['news_posts', posts], ['videos', videos], ['sanctions', rep.sanctions],
    ];
    const cell = (v: string | number) => {
      const s = String(v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no spreadsheet formula injection
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return '﻿metric,value\n' + rows.map(([k, v]) => `${k},${cell(v)}`).join('\n') + '\n';
  }
}

/** ADM-013 / OPS-007 service health: providers, queues, live latency, jobs, backups and disk capacity. */
export class ServiceHealthService {
  constructor(private readonly ct: Container) {}
  async snapshot(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'outbox.read', SITE, requestId);
    const c = this.ct.c;
    const outbox = await this.ct.consumer.stats();
    const oldestPending = await c.outbox.find({ status: 'pending' }).sort({ occurredAt: 1 }).limit(1).next();
    const lastRt = await c.realtime.find({}).sort({ seq: -1 }).limit(1).next();
    const lastBackup = await c.backups.find({ ok: true }).sort({ startedAt: -1 }).limit(1).next();
    let disk: { totalBytes: number; freeBytes: number; usedPct: number } | null;
    try {
      const s = await statfs(this.ct.config.DATA_DIR);
      disk = { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize, usedPct: Math.round((1 - s.bavail / s.blocks) * 1000) / 10 };
    } catch {
      disk = null;
    }
    const providers = await adaptersHealth(this.ct.adapters);
    const alerts: Array<{ level: 'warn' | 'critical'; kind: string; detail: string }> = [];
    if ((outbox['dead_letter'] ?? 0) > 0) alerts.push({ level: 'critical', kind: 'outbox_dead_letter', detail: `${outbox['dead_letter']} dead-lettered events` });
    if (oldestPending && Date.now() - Date.parse(oldestPending.occurredAt) > 60_000) alerts.push({ level: 'warn', kind: 'outbox_lag', detail: `oldest pending event is ${Math.round((Date.now() - Date.parse(oldestPending.occurredAt)) / 1000)} s old` });
    if (!lastBackup || Date.now() - Date.parse(lastBackup.startedAt) > 15 * 60_000) alerts.push({ level: 'critical', kind: 'backup_rpo', detail: lastBackup ? `last good backup ${lastBackup.startedAt} (RPO target 15 min)` : 'no successful backup recorded' });
    if (disk && disk.usedPct > 85) alerts.push({ level: disk.usedPct > 95 ? 'critical' : 'warn', kind: 'disk', detail: `${disk.usedPct}% used` });
    for (const p of providers) if (p.status !== 'ok') alerts.push({ level: p.mode === 'production' ? 'critical' : 'warn', kind: `provider_${p.kind}`, detail: `${p.adapter}:${p.status}${p.detail ? ` — ${p.detail}` : ''}` });
    const notif = { pending: await c.notifications.countDocuments({ 'channels.status': 'pending' }), failed: await c.notifications.countDocuments({ 'channels.status': 'failed' }) };
    const webhooks = { pending: await c.webhookDeliveries.countDocuments({ state: 'pending' }), dead: await c.webhookDeliveries.countDocuments({ state: 'dead' }) };
    if (webhooks.dead) alerts.push({ level: 'warn', kind: 'webhook_dead', detail: `${webhooks.dead} webhook deliveries gave up` });
    return {
      at: iso(), providers, outbox, outboxLagSeconds: oldestPending ? Math.round((Date.now() - Date.parse(oldestPending.occurredAt)) / 1000) : 0,
      realtime: { lastSeq: lastRt?.seq ?? 0, lastAt: lastRt?.createdAt ?? null, floor: await this.ct.realtime.floor() },
      notifications: notif, webhooks, ratingJobsFailed: await c.ratingJobs.countDocuments({ state: 'failed', error: { $ne: 'superseded by a newer build' } }),
      lastBackup: lastBackup ? { at: lastBackup.startedAt, sizeBytes: lastBackup.sizeBytes, target: lastBackup.target } : null, disk, alerts,
    };
  }
}
