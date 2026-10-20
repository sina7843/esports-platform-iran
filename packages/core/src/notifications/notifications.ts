import { randomBytes } from 'node:crypto';
import { DomainError, type Role } from '@esp/contracts';
import type { Container } from '../container.js';
import type { NotificationChannel, NotificationDoc, OfficialMessageDoc } from '../db/collections-esp06.js';
import { newId } from '../ids.js';
import { maxDelaySeconds } from '../live/policy.js';
import { clean } from '../news/news.js';

const iso = () => new Date().toISOString();
export const NOTIFICATION_CATEGORIES = ['registration', 'payment', 'invitation', 'checkin', 'match', 'schedule', 'result', 'decision', 'official', 'honor', 'follow.start', 'follow.end', 'follow.time', 'promotional', 'system'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export interface NotificationPrefs {
  channels: { inApp: boolean; sms: boolean; email: boolean; push: boolean };
  quietHours: { from: string; to: string } | null; // HH:MM in Asia/Tehran
  promotional: boolean;
  digestFrequent: boolean;
  categories: Partial<Record<NotificationCategory, boolean>>;
  unsubscribeToken?: string;
}
const DEFAULT_PREFS: NotificationPrefs = { channels: { inApp: true, sms: true, email: false, push: false }, quietHours: null, promotional: false, digestFrequent: true, categories: {} };
const BACKOFF_S = [60, 300, 1800, 7200];
const MAX_ATTEMPTS = BACKOFF_S.length + 1;

function tehranMinutes(d: Date): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
}
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** Minutes until quiet hours end (0 when not quiet). Handles windows that cross midnight. */
export function quietWait(q: NotificationPrefs['quietHours'], now: Date): number {
  if (!q) return 0;
  const m = tehranMinutes(now);
  const from = hm(q.from);
  const to = hm(q.to);
  const inside = from <= to ? m >= from && m < to : m >= from || m < to;
  if (!inside) return 0;
  return (to - m + 1440) % 1440 || 1440;
}

export interface NotifyInput {
  principalIds: string[];
  category: NotificationCategory;
  title: string;
  body: string;
  link?: string | null | undefined;
  data?: Record<string, unknown> | undefined;
  essential?: boolean | undefined;
  groupKey?: string | null | undefined;
  /** stable per occurrence; one notification per (dedupeKey, principal) */
  dedupeKey?: string | null | undefined;
  deliverAt?: string | undefined;
  ackRequired?: boolean | undefined;
  officialMessageId?: string | null | undefined;
}

/**
 * COM-001..006: persistent in-site notification centre with channel preferences, quiet hours, promotional opt-out,
 * aggregation of frequent items and explicit essential exceptions. Each external channel records send, failure,
 * retry and (when the provider reports it) delivery separately from the user's read/acknowledgement — delivered is
 * never treated as read. Push has no Iranian provider selected, so it is reported as skipped and never blocks
 * the in-site notice. Audience notifications about results wait for the longest stream delay (CAST-007).
 */
export class NotificationService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  async prefs(principalId: string): Promise<NotificationPrefs> {
    const p = await this.c.profiles.findOne({ _id: principalId }, { projection: { notificationPrefs: 1 } });
    const raw = (p?.notificationPrefs ?? {}) as Partial<NotificationPrefs>;
    return { ...DEFAULT_PREFS, ...raw, channels: { ...DEFAULT_PREFS.channels, ...(raw.channels ?? {}) }, categories: { ...(raw.categories ?? {}) } };
  }
  async updatePrefs(principalId: string, input: Partial<Omit<NotificationPrefs, 'unsubscribeToken'>>): Promise<NotificationPrefs> {
    const cur = await this.prefs(principalId);
    if (input.quietHours && (!/^\d{2}:\d{2}$/.test(input.quietHours.from) || !/^\d{2}:\d{2}$/.test(input.quietHours.to))) throw new DomainError('VALIDATION_FAILED', 'quiet hours are HH:MM');
    for (const k of Object.keys(input.categories ?? {})) if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(k)) throw new DomainError('VALIDATION_FAILED', `unknown category ${k}`);
    const next: NotificationPrefs = { ...cur, ...input, channels: { ...cur.channels, ...(input.channels ?? {}), inApp: true }, categories: { ...cur.categories, ...(input.categories ?? {}) } };
    await this.c.profiles.updateOne({ _id: principalId }, { $set: { notificationPrefs: next as unknown as Record<string, unknown> }, $inc: { version: 1 } });
    return next;
  }
  /** One-click promotional unsubscribe link token (random, stored; no signed state). */
  async unsubscribeToken(principalId: string): Promise<string> {
    const cur = await this.prefs(principalId);
    if (cur.unsubscribeToken) return cur.unsubscribeToken;
    const token = randomBytes(18).toString('base64url');
    await this.c.profiles.updateOne({ _id: principalId }, { $set: { 'notificationPrefs.unsubscribeToken': token } });
    return token;
  }
  async unsubscribePromotional(token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw new DomainError('VALIDATION_FAILED', 'invalid link');
    const r = await this.c.profiles.updateOne({ 'notificationPrefs.unsubscribeToken': token }, { $set: { 'notificationPrefs.promotional': false } });
    if (!r.matchedCount) throw new DomainError('NOT_FOUND', 'link not found');
  }

  async notify(input: NotifyInput): Promise<number> {
    let created = 0;
    const now = new Date();
    for (const principalId of [...new Set(input.principalIds)].filter(Boolean)) {
      const prefs = await this.prefs(principalId);
      const promotional = input.category === 'promotional';
      if (promotional && !prefs.promotional) continue; // COM-003: promotional only by opt-in
      if (!input.essential && prefs.categories[input.category] === false) continue; // opted out (essential cannot be)
      // aggregation of frequent, non-essential items (COM-003)
      if (input.groupKey && prefs.digestFrequent && !input.essential) {
        const agg = await this.c.notifications.findOneAndUpdate(
          { principalId, groupKey: input.groupKey, readAt: null, createdAt: { $gt: new Date(now.getTime() - 30 * 60_000).toISOString() } },
          { $inc: { count: 1 }, $set: { title: clean(input.title, 200), body: clean(input.body, 1000) } },
          { returnDocument: 'after' },
        );
        if (agg) continue;
      }
      const wait = input.essential ? 0 : quietWait(prefs.quietHours, now);
      const external = new Date(Math.max(Date.parse(input.deliverAt ?? now.toISOString()), now.getTime() + wait * 60_000)).toISOString();
      const ch = (channel: NotificationChannel, on: boolean, reason: string | null): NotificationDoc['channels'][number] => ({ channel, status: on ? 'pending' : 'skipped', attempts: 0, nextAttemptAt: on ? external : null, lastError: null, providerRef: null, sentAt: null, deliveredAt: null, reason: on ? null : reason });
      const pushAvailable = false; // no Iranian push provider selected (COM-001); in-site notice is unaffected
      const doc: NotificationDoc = {
        _id: newId('ntf'), principalId, category: input.category, title: clean(input.title, 200), body: clean(input.body, 1000), link: input.link ?? null, data: input.data ?? {},
        essential: !!input.essential, promotional, groupKey: input.groupKey ?? null, count: 1, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${principalId}` : null, deliverAt: input.deliverAt ?? now.toISOString(),
        createdAt: now.toISOString(), readAt: null, ackRequired: !!input.ackRequired, ackAt: null, officialMessageId: input.officialMessageId ?? null,
        channels: [
          { channel: 'in_app', status: 'sent', attempts: 1, nextAttemptAt: null, lastError: null, providerRef: null, sentAt: now.toISOString(), deliveredAt: null, reason: null },
          ch('sms', prefs.channels.sms && (input.essential || !promotional), 'disabled in preferences'),
          ch('email', prefs.channels.email, 'disabled in preferences'),
          ch('push', prefs.channels.push && pushAvailable, prefs.channels.push ? 'no push provider available' : 'disabled in preferences'),
        ],
      };
      try {
        await this.c.notifications.insertOne(doc);
        created++;
      } catch (e) {
        if ((e as { code?: number }).code === 11000) continue; // replayed occurrence
        throw e;
      }
      if (Date.parse(doc.deliverAt) <= now.getTime()) await this.ct.realtime.publish({ channel: 'notifications', type: 'notification.new', audience: { kind: 'principals', principalIds: [principalId] }, payload: { id: doc._id, category: doc.category, title: doc.title } });
      else await this.ct.realtime.publish({ channel: 'notifications', type: 'notification.new', audience: { kind: 'principals', principalIds: [principalId] }, payload: { id: doc._id, category: doc.category, title: doc.title }, visibleAt: doc.deliverAt });
    }
    return created;
  }

  // ------------------------------------------------------------------ inbox
  async inbox(principalId: string, opts: { before?: string | undefined; unreadOnly?: boolean | undefined; limit: number }) {
    const now = iso();
    const q: Record<string, unknown> = { principalId, deliverAt: { $lte: opts.before && opts.before < now ? opts.before : now } };
    if (opts.before) q['deliverAt'] = { $lt: opts.before };
    if (opts.unreadOnly) q['readAt'] = null;
    const rows = await this.c.notifications.find({ ...q, $and: [{ deliverAt: { $lte: now } }] }).sort({ deliverAt: -1 }).limit(Math.min(opts.limit, 100)).toArray();
    return { items: rows.map((n) => this.pub(n)), unread: await this.c.notifications.countDocuments({ principalId, readAt: null, deliverAt: { $lte: now } }) };
  }
  pub(n: NotificationDoc) {
    return { id: n._id, category: n.category, title: n.title, body: n.body, link: n.link, essential: n.essential, count: n.count, deliverAt: n.deliverAt, readAt: n.readAt, ackRequired: n.ackRequired, ackAt: n.ackAt, channels: n.channels.map((c) => ({ channel: c.channel, status: c.status, attempts: c.attempts, deliveredAt: c.deliveredAt, reason: c.reason })) };
  }
  async markRead(principalId: string, ids: string[] | 'all'): Promise<number> {
    const r = await this.c.notifications.updateMany({ principalId, readAt: null, deliverAt: { $lte: iso() }, ...(ids === 'all' ? {} : { _id: { $in: ids } }) }, { $set: { readAt: iso() } });
    return r.modifiedCount;
  }
  /** COM-006: reading (seen) and acknowledging are separate, explicit acts. */
  async ack(principalId: string, id: string): Promise<void> {
    const r = await this.c.notifications.updateOne({ _id: id, principalId, ackRequired: true, ackAt: null, deliverAt: { $lte: iso() } }, { $set: { ackAt: iso(), readAt: iso() } });
    if (!r.matchedCount && !(await this.c.notifications.findOne({ _id: id, principalId, ackAt: { $ne: null } }))) throw new DomainError('NOT_FOUND', 'notification not found');
  }

  // ------------------------------------------------------------------ dispatch (COM-004)
  async dispatch(now = new Date()): Promise<{ sent: number; failed: number; retried: number }> {
    const nowIso = now.toISOString();
    const due = await this.c.notifications.find({ deliverAt: { $lte: nowIso }, channels: { $elemMatch: { status: 'pending', nextAttemptAt: { $lte: nowIso } } } }).limit(200).toArray();
    let sent = 0;
    let failed = 0;
    let retried = 0;
    for (const n of due) {
      const cred = await this.c.credentials.findOne({ _id: n.principalId }, { projection: { phone: 1, email: 1 } });
      for (const [i, ch] of n.channels.entries()) {
        if (ch.status !== 'pending' || !ch.nextAttemptAt || ch.nextAttemptAt > nowIso) continue;
        const set: Record<string, unknown> = {};
        try {
          let res: { status: 'queued' | 'sent' | 'failed'; providerRef: string | null };
          if (ch.channel === 'sms') {
            if (!cred?.phone) throw new Error('no verified phone');
            res = await this.ct.adapters.sms.send({ to: cred.phone, text: `${n.title}${n.link ? ` ${n.link}` : ''}`.slice(0, 300), kind: n.promotional ? 'promotional' : 'transactional', idempotencyKey: `${n._id}:sms` });
          } else if (ch.channel === 'email') {
            if (!cred?.email) throw new Error('no verified email');
            res = await this.ct.adapters.email.send({ to: cred.email, subject: n.title, text: `${n.body}${n.link ? `\n${n.link}` : ''}`, idempotencyKey: `${n._id}:email` });
          } else throw new Error('no provider for this channel');
          if (res.status === 'failed') throw new Error('provider reported failure');
          Object.assign(set, { [`channels.${i}.status`]: 'sent', [`channels.${i}.providerRef`]: res.providerRef, [`channels.${i}.sentAt`]: nowIso, [`channels.${i}.attempts`]: ch.attempts + 1, [`channels.${i}.nextAttemptAt`]: null, [`channels.${i}.lastError`]: null });
          sent++;
        } catch (e) {
          const attempts = ch.attempts + 1;
          const final = attempts >= MAX_ATTEMPTS || /no verified|no provider/.test((e as Error).message);
          Object.assign(set, { [`channels.${i}.attempts`]: attempts, [`channels.${i}.lastError`]: (e as Error).message.slice(0, 300), [`channels.${i}.status`]: final ? 'failed' : 'pending', [`channels.${i}.nextAttemptAt`]: final ? null : new Date(now.getTime() + BACKOFF_S[attempts - 1]! * 1000).toISOString() });
          if (final) failed++;
          else retried++;
        }
        await this.c.notifications.updateOne({ _id: n._id }, { $set: set });
      }
    }
    return { sent, failed, retried };
  }
  /** Delivery receipts where the provider supports them (sent ≠ delivered ≠ read). */
  async pollDelivery(): Promise<number> {
    const sms = this.ct.adapters.sms;
    if (!sms.deliveryStatus) return 0;
    const rows = await this.c.notifications.find({ channels: { $elemMatch: { channel: 'sms', status: 'sent', providerRef: { $ne: null } } } }).limit(200).toArray();
    let n = 0;
    for (const r of rows) {
      const i = r.channels.findIndex((c) => c.channel === 'sms');
      const st = await sms.deliveryStatus(r.channels[i]!.providerRef!).catch(() => 'unknown' as const);
      if (st === 'delivered') {
        await this.c.notifications.updateOne({ _id: r._id }, { $set: { [`channels.${i}.status`]: 'delivered', [`channels.${i}.deliveredAt`]: iso() } });
        n++;
      } else if (st === 'failed') await this.c.notifications.updateOne({ _id: r._id }, { $set: { [`channels.${i}.status`]: 'failed', [`channels.${i}.lastError`]: 'provider reported undelivered' } });
    }
    return n;
  }
  async queueHealth() {
    const [pending, failed] = await Promise.all([this.c.notifications.countDocuments({ 'channels.status': 'pending' }), this.c.notifications.countDocuments({ 'channels.status': 'failed' })]);
    return { pending, failed, sms: (await this.ct.adapters.sms.health()).status, email: (await this.ct.adapters.email.health()).status, push: 'unavailable' as const };
  }

  // ------------------------------------------------------------------ official group messages (COM-006)
  private async audience(eventId: string, audience: OfficialMessageDoc['audience']): Promise<string[]> {
    if (audience === 'staff') {
      const staffRoles: Role[] = ['organizer', 'event_operator', 'referee', 'head_referee', 'appeal_authority', 'reporter', 'photographer', 'editor', 'broadcast_crew'];
      return [...new Set((await this.c.grants.find({ 'scope.type': 'event', 'scope.id': eventId, role: { $in: staffRoles }, revokedAt: null }).toArray()).map((g) => g.principalId))];
    }
    const parts = await this.c.participations.find({ eventId, registrationState: 'confirmed' }).toArray();
    if (audience === 'participants') return [...new Set(parts.flatMap((p) => p.snapshot.roster.map((r) => r.principalId)))];
    return [...new Set(parts.flatMap((p) => p.snapshot.roster.filter((r) => ['captain', 'team_captain'].includes(r.role)).map((r) => r.principalId)).concat(parts.filter((p) => p.kind === 'player').flatMap((p) => p.snapshot.roster.map((r) => r.principalId))))];
  }
  async sendOfficial(eventId: string, input: { audience: OfficialMessageDoc['audience']; title: string; body: string; requiresAck: boolean }, actor: string, requestId: string): Promise<OfficialMessageDoc> {
    await this.ct.acl.require(actor, 'message.official', { type: 'event', id: eventId }, requestId);
    if (clean(input.title, 200).length < 3 || clean(input.body, 4000).length < 5) throw new DomainError('VALIDATION_FAILED', 'title and text are required');
    const recipients = await this.audience(eventId, input.audience);
    const doc: OfficialMessageDoc = { _id: newId('ofm'), eventId, audience: input.audience, title: clean(input.title, 200), body: clean(input.body, 4000), requiresAck: input.requiresAck, sentBy: actor, recipients: recipients.length, createdAt: iso() };
    await this.c.officialMessages.insertOne(doc);
    await this.notify({ principalIds: recipients, category: 'official', title: doc.title, body: doc.body, link: `/events/${eventId}`, essential: true, ackRequired: input.requiresAck, officialMessageId: doc._id, dedupeKey: `official:${doc._id}` });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'message.official.send', target: { type: 'official_message', id: doc._id }, scope: { type: 'event', id: eventId }, outcome: 'success', details: { audience: input.audience, recipients: recipients.length }, requestId });
    return doc;
  }
  /** Per-recipient status: in-site sent, external channel status, read, acknowledged — each separate. */
  async officialReport(messageId: string, actor: string, requestId: string) {
    const m = await this.c.officialMessages.findOne({ _id: messageId });
    if (!m) throw new DomainError('NOT_FOUND', 'message not found');
    await this.ct.acl.require(actor, 'message.official', { type: 'event', id: m.eventId }, requestId);
    const rows = await this.c.notifications.find({ officialMessageId: messageId }).toArray();
    return { message: m, totals: { recipients: rows.length, read: rows.filter((r) => r.readAt).length, acknowledged: rows.filter((r) => r.ackAt).length, smsSent: rows.filter((r) => r.channels.some((c) => c.channel === 'sms' && ['sent', 'delivered'].includes(c.status))).length, smsDelivered: rows.filter((r) => r.channels.some((c) => c.channel === 'sms' && c.status === 'delivered')).length }, recipients: rows.map((r) => ({ principalId: r.principalId, readAt: r.readAt, ackAt: r.ackAt, channels: r.channels.map((c) => ({ channel: c.channel, status: c.status })) })) };
  }
  async officialList(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'message.official', { type: 'event', id: eventId }, requestId);
    return this.c.officialMessages.find({ eventId }).sort({ createdAt: -1 }).limit(100).toArray();
  }

  // ------------------------------------------------------------------ COM-002 / AUD-001 mapping from official events
  private async followersOf(eventId: string, teamIds: string[], principalIds: string[]): Promise<string[]> {
    const or = [{ targetType: 'event', targetId: eventId }, ...(teamIds.length ? [{ targetType: 'team', targetId: { $in: teamIds } }] : []), ...(principalIds.length ? [{ targetType: 'player', targetId: { $in: principalIds } }] : [])];
    return [...new Set((await this.c.follows.find({ $or: or } as never, { projection: { followerId: 1 } }).toArray()).map((f) => f.followerId))];
  }
  async fromEvent(id: string, type: string, payload: Record<string, unknown>, occurredAt: string): Promise<void> {
    const key = `${type}:${id}`;
    const str = (k: string) => (typeof payload[k] === 'string' ? (payload[k] as string) : null);
    if (type.startsWith('registration.')) {
      const who = str('applicant');
      if (!who) return;
      const action = type.slice('registration.'.length);
      const label: Record<string, string> = { submitted: 'درخواست ثبت‌نام ثبت شد', confirmed: 'ثبت‌نام تأیید شد', reject: 'ثبت‌نام رد شد', mark_incomplete: 'مدارک ثبت‌نام ناقص است', remove: 'شرکت‌کننده از رویداد حذف شد', withdrawn: 'انصراف ثبت شد', promoted: 'از فهرست انتظار وارد ظرفیت شدید', 'checkin.no_show': 'عدم حضور در Check-in ثبت شد' };
      await this.notify({ principalIds: [who], category: action.startsWith('checkin') ? 'checkin' : 'registration', title: label[action] ?? `وضعیت ثبت‌نام: ${action}`, body: str('reason') ?? '', link: `/account/registrations`, essential: ['confirmed', 'reject', 'mark_incomplete', 'remove'].includes(action), dedupeKey: key });
      return;
    }
    if (type.startsWith('finance.')) {
      const order = str('orderId') ? await this.c.orders.findOne({ _id: str('orderId')! }, { projection: { payerPrincipalId: 1 } }) : null;
      const who = order?.payerPrincipalId ?? str('principalId');
      if (who) await this.notify({ principalIds: [who], category: 'payment', title: type === 'finance.order.paid' ? 'پرداخت تأیید شد' : type === 'finance.payment.failed' ? 'پرداخت ناموفق بود' : 'بازپرداخت انجام شد', body: '', link: '/account/registrations', essential: true, dedupeKey: key });
      return;
    }
    if (type === 'team.invitation.created') {
      const who = str('principalId');
      if (who) await this.notify({ principalIds: [who], category: 'invitation', title: 'دعوت به تیم', body: '', link: `/teams/${str('teamId') ?? ''}`, dedupeKey: key });
      return;
    }
    const principals = (payload['principals'] as string[] | undefined) ?? [];
    const eventId = str('eventId');
    const matchId = str('matchId');
    if (type === 'competition.match.readiness_open') {
      await this.notify({ principalIds: principals, category: 'checkin', title: 'اعلام آمادگی (Check-in) بازی باز شد', body: '', link: matchId ? `/matches/${matchId}` : null, essential: true, dedupeKey: key });
    } else if (type === 'competition.match.started' || type === 'competition.match.rescheduled' || type === 'competition.match.finalized') {
      if (!matchId || !eventId) return;
      const m = await this.c.matches.findOne({ _id: matchId });
      if (!m) return;
      const names = m.sides.map((s) => s.displayName).join(' — ');
      const parts = await this.c.participations.find({ _id: { $in: m.participantIds ?? [] } }, { projection: { snapshot: 1 } }).toArray();
      const followers = (await this.followersOf(eventId, parts.map((p) => p.snapshot.teamId).filter((x): x is string => !!x), m.principalIds ?? [])).filter((f) => !(m.principalIds ?? []).includes(f));
      if (type === 'competition.match.started') {
        await this.notify({ principalIds: followers, category: 'follow.start', title: `آغاز بازی ${names}`, body: '', link: `/events/${eventId}/live`, dedupeKey: key, groupKey: `start:${eventId}` });
      } else if (type === 'competition.match.rescheduled') {
        await this.notify({ principalIds: m.principalIds ?? [], category: 'schedule', title: `تغییر زمان بازی ${names}`, body: str('scheduledAt') ?? '', link: `/matches/${matchId}`, essential: true, dedupeKey: `${key}` });
        await this.notify({ principalIds: followers, category: 'follow.time', title: `تغییر زمان بازی ${names}`, body: str('scheduledAt') ?? '', link: `/events/${eventId}/live`, dedupeKey: `${key}:f`, groupKey: `time:${eventId}` });
      } else {
        // the sides know their result; the audience waits for the longest broadcast delay (no spoilers)
        await this.notify({ principalIds: m.principalIds ?? [], category: 'result', title: `نتیجه رسمی بازی ${names} ثبت شد`, body: '', link: `/matches/${matchId}`, dedupeKey: key });
        const delay = await maxDelaySeconds(this.c, eventId);
        await this.notify({ principalIds: followers, category: 'follow.end', title: `پایان بازی ${names}`, body: '', link: `/events/${eventId}/live`, dedupeKey: `${key}:f`, groupKey: `end:${eventId}`, deliverAt: new Date(Date.parse(occurredAt) + delay * 1000).toISOString() });
      }
    } else if (type.startsWith('integrity.dispute.') || type === 'integrity.sanction.issued') {
      await this.notify({ principalIds: principals, category: 'decision', title: type.endsWith('decided') ? 'رأی پرونده صادر شد' : type === 'integrity.sanction.issued' ? 'جریمه انضباطی صادر شد' : 'به‌روزرسانی پرونده', body: '', link: str('caseId') ? `/cases/${str('caseId')}` : null, essential: type.endsWith('decided') || type === 'integrity.sanction.issued', dedupeKey: key });
    } else if (type.startsWith('competition.result.') || type === 'competition.match.reopened') {
      await this.notify({ principalIds: principals, category: 'result', title: type === 'competition.result.corrected' ? 'نتیجه بازی اصلاح شد' : 'نتیجه نیازمند بررسی است', body: str('reason') ?? '', link: matchId ? `/matches/${matchId}` : null, essential: type === 'competition.result.corrected', dedupeKey: key });
    } else if (type === 'honors.issued' || type === 'honors.revoked') {
      await this.notify({ principalIds: principals, category: 'honor', title: type === 'honors.issued' ? 'افتخار جدید برای شما ثبت شد' : 'یک افتخار باطل شد', body: '', link: '/account/certificates', essential: type === 'honors.revoked', dedupeKey: key });
    }
  }
}
