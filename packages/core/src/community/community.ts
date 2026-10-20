import { DomainError } from '@esp/contracts';
import type { Container } from '../container.js';
import type { ChatMessageDoc, ChatRoomDoc, CommentDoc, ContentReportDoc } from '../db/collections-esp06.js';
import { newId } from '../ids.js';
import { clean } from '../news/news.js';
import { canMessage, isBlockedEither } from '../social/social.js';

const iso = () => new Date().toISOString();
export const REACTIONS = ['👍', '🔥', '👏', '😮', '😢'] as const;
const LIMIT_PER_MINUTE = { comment: 5, chat: 10 };

/**
 * AUD-001/002, COM-005: audience reactions and comments (separate from the official timeline), spectator chat per
 * event, private threads, team groups — all with report, rate limit, block and membership checks. A team room is
 * readable only by current members and only from their join date; a former member keeps no access to private
 * history (policy recorded in DECISIONS). Moderation hides content with a reason; nothing is silently deleted.
 */
export class CommunityService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  private async publicPost(postId: string) {
    const p = await this.c.newsPosts.findOne({ _id: postId, state: { $in: ['published', 'corrected'] } }, { projection: { eventId: 1 } });
    if (!p) throw new DomainError('NOT_FOUND', 'post not found');
    if (p.eventId) {
      const e = await this.c.events.findOne({ _id: p.eventId }, { projection: { visibility: 1 } });
      if (e?.visibility !== 'public') throw new DomainError('NOT_FOUND', 'post not found');
    }
    return p;
  }
  private async rate(kind: 'comment' | 'chat', actor: string) {
    const since = new Date(Date.now() - 60_000).toISOString();
    const n = kind === 'comment' ? await this.c.comments.countDocuments({ principalId: actor, createdAt: { $gt: since } }) : await this.c.chatMessages.countDocuments({ principalId: actor, createdAt: { $gt: since } });
    if (n >= LIMIT_PER_MINUTE[kind]) throw new DomainError('RATE_LIMITED', 'too many messages; wait a minute');
  }

  // ------------------------------------------------------------------ reactions and comments
  async react(postId: string, emoji: string | null, actor: string): Promise<Record<string, number>> {
    await this.publicPost(postId);
    if (emoji === null) await this.c.reactions.deleteOne({ _id: `${postId}:${actor}` });
    else {
      if (!(REACTIONS as readonly string[]).includes(emoji)) throw new DomainError('VALIDATION_FAILED', 'unsupported reaction');
      await this.c.reactions.updateOne({ _id: `${postId}:${actor}` }, { $set: { postId, principalId: actor, emoji, at: iso() } }, { upsert: true });
    }
    return this.reactionCounts(postId);
  }
  async reactionCounts(postId: string): Promise<Record<string, number>> {
    const rows = await this.c.reactions.aggregate<{ _id: string; n: number }>([{ $match: { postId } }, { $group: { _id: '$emoji', n: { $sum: 1 } } }]).toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }
  async comment(postId: string, text: string, actor: string): Promise<CommentDoc> {
    await this.publicPost(postId);
    const body = clean(text, 1000);
    if (body.length < 1) throw new DomainError('VALIDATION_FAILED', 'empty comment');
    await this.rate('comment', actor);
    const doc: CommentDoc = { _id: newId('cmt'), postId, principalId: actor, text: body, hidden: null, createdAt: iso() };
    await this.c.comments.insertOne(doc);
    return doc;
  }
  async comments(postId: string, viewer: string | null, opts: { before?: string | undefined; limit: number }) {
    await this.publicPost(postId);
    const rows = await this.c.comments.find({ postId, ...(opts.before ? { createdAt: { $lt: opts.before } } : {}) }).sort({ createdAt: -1 }).limit(Math.min(opts.limit, 100)).toArray();
    return this.withNames(rows, viewer);
  }
  private async withNames<T extends { principalId: string; hidden: unknown; text: string }>(rows: T[], viewer: string | null) {
    const profs = new Map((await this.c.profiles.find({ _id: { $in: [...new Set(rows.map((r) => r.principalId))] } }, { projection: { nickname: 1 } }).toArray()).map((p) => [p._id, p.nickname]));
    const blocked = viewer ? new Set((await this.c.blocks.find({ $or: [{ blockerId: viewer }, { blockedId: viewer }] }).toArray()).map((b) => (b.blockerId === viewer ? b.blockedId : b.blockerId))) : new Set<string>();
    return rows.map((r) => ({ ...r, nickname: profs.get(r.principalId) ?? null, text: r.hidden ? '' : blocked.has(r.principalId) ? '' : r.text, removed: !!r.hidden, blocked: blocked.has(r.principalId) }));
  }

  // ------------------------------------------------------------------ rooms
  private async room(roomId: string, actor: string): Promise<{ room: ChatRoomDoc; since: string | null }> {
    if (roomId.startsWith('ev:')) {
      const eventId = roomId.slice(3);
      const e = await this.c.events.findOne({ _id: eventId }, { projection: { visibility: 1, state: 1 } });
      if (!e || e.visibility !== 'public' || ['draft', 'in_review'].includes(e.state)) throw new DomainError('NOT_FOUND', 'room not found');
      const room = (await this.c.chatRooms.findOneAndUpdate({ _id: roomId }, { $setOnInsert: { _id: roomId, kind: 'event_spectator', eventId, teamId: null, members: [], createdAt: iso() } }, { upsert: true, returnDocument: 'after' }))!;
      return { room, since: null };
    }
    if (roomId.startsWith('team:')) {
      const teamId = roomId.slice(5);
      const mem = await this.c.teamMemberships.findOne({ teamId, principalId: actor, to: null });
      if (!mem) throw new DomainError('FORBIDDEN', 'only current team members use the team room');
      const room = (await this.c.chatRooms.findOneAndUpdate({ _id: roomId }, { $setOnInsert: { _id: roomId, kind: 'team', eventId: null, teamId, members: [], createdAt: iso() } }, { upsert: true, returnDocument: 'after' }))!;
      return { room, since: mem.from };
    }
    if (roomId.startsWith('dm:')) {
      const room = await this.c.chatRooms.findOne({ _id: roomId });
      if (!room || !room.members.includes(actor)) throw new DomainError('NOT_FOUND', 'room not found');
      return { room, since: null };
    }
    throw new DomainError('NOT_FOUND', 'room not found');
  }
  /** Opens (or returns) the private thread with someone the actor may message (messaging policy + blocks). */
  async openDm(actor: string, other: string): Promise<ChatRoomDoc> {
    const d = await canMessage(this.c, actor, other);
    if (!d.allowed) throw new DomainError('FORBIDDEN', `you cannot message this person (${d.reason})`);
    const members = [actor, other].sort();
    const id = `dm:${members.join(':')}`;
    return (await this.c.chatRooms.findOneAndUpdate({ _id: id }, { $setOnInsert: { _id: id, kind: 'dm', eventId: null, teamId: null, members, createdAt: iso() } }, { upsert: true, returnDocument: 'after' }))!;
  }
  async myRooms(actor: string) {
    const dms = await this.c.chatRooms.find({ kind: 'dm', members: actor }).toArray();
    const teams = await this.c.teamMemberships.find({ principalId: actor, to: null }).toArray();
    const names = new Map((await this.c.teams.find({ _id: { $in: teams.map((t) => t.teamId) } }, { projection: { name: 1 } }).toArray()).map((t) => [t._id, t.name]));
    const profs = new Map((await this.c.profiles.find({ _id: { $in: dms.flatMap((d) => d.members) } }, { projection: { nickname: 1 } }).toArray()).map((p) => [p._id, p.nickname]));
    return [
      ...teams.map((t) => ({ id: `team:${t.teamId}`, kind: 'team' as const, title: names.get(t.teamId) ?? t.teamId })),
      ...dms.map((d) => ({ id: d._id, kind: 'dm' as const, title: profs.get(d.members.find((m) => m !== actor) ?? actor) ?? 'گفت‌وگو' })),
    ];
  }
  async send(roomId: string, text: string, actor: string): Promise<ChatMessageDoc> {
    const { room } = await this.room(roomId, actor);
    const body = clean(text, 1000);
    if (!body) throw new DomainError('VALIDATION_FAILED', 'empty message');
    if (room.kind === 'dm') {
      const other = room.members.find((m) => m !== actor)!;
      if (await isBlockedEither(this.c, actor, other)) throw new DomainError('FORBIDDEN', 'messaging is blocked between you');
      const d = await canMessage(this.c, actor, other);
      if (!d.allowed) throw new DomainError('FORBIDDEN', `you cannot message this person (${d.reason})`);
    }
    await this.rate('chat', actor);
    const doc: ChatMessageDoc = { _id: newId('chm'), roomId, principalId: actor, text: body, hidden: null, createdAt: iso() };
    await this.c.chatMessages.insertOne(doc);
    const audience = room.kind === 'event_spectator' ? ({ kind: 'public' } as const) : ({ kind: 'principals', principalIds: room.kind === 'dm' ? room.members : (await this.c.teamMemberships.find({ teamId: room.teamId!, to: null }).toArray()).map((m) => m.principalId) } as const);
    await this.ct.realtime.publish({ channel: `chat:${roomId}`, type: 'chat.message', audience, payload: { id: doc._id, roomId } });
    return doc;
  }
  async messages(roomId: string, actor: string, opts: { before?: string | undefined; limit: number }) {
    const { since } = await this.room(roomId, actor);
    const q: Record<string, unknown> = { roomId };
    const range: Record<string, string> = {};
    if (since) range['$gte'] = since; // no history from before the actor joined the team
    if (opts.before) range['$lt'] = opts.before;
    if (Object.keys(range).length) q['createdAt'] = range;
    const rows = await this.c.chatMessages.find(q).sort({ createdAt: -1 }).limit(Math.min(opts.limit, 100)).toArray();
    return this.withNames(rows, actor);
  }
  /** Public spectator room reading needs no account. */
  async spectatorMessages(eventId: string, opts: { before?: string | undefined; limit: number }) {
    await this.room(`ev:${eventId}`, '');
    const rows = await this.c.chatMessages.find({ roomId: `ev:${eventId}`, ...(opts.before ? { createdAt: { $lt: opts.before } } : {}) }).sort({ createdAt: -1 }).limit(Math.min(opts.limit, 100)).toArray();
    return this.withNames(rows, null);
  }

  // ------------------------------------------------------------------ reports and moderation
  async report(input: { targetType: ContentReportDoc['targetType']; targetId: string; reason: string }, actor: string): Promise<ContentReportDoc> {
    const scope = await this.scopeOf(input.targetType, input.targetId);
    if (clean(input.reason, 500).length < 3) throw new DomainError('VALIDATION_FAILED', 'give a reason');
    const doc: ContentReportDoc = { _id: newId('rpt'), targetType: input.targetType, targetId: input.targetId, scope, reporterId: actor, reason: clean(input.reason, 500), state: 'open', decidedBy: null, note: null, createdAt: iso() };
    try {
      await this.c.contentReports.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'you already reported this');
      throw e;
    }
    return doc;
  }
  private async scopeOf(type: ContentReportDoc['targetType'], id: string): Promise<ContentReportDoc['scope']> {
    if (type === 'comment') {
      const cmt = await this.c.comments.findOne({ _id: id });
      if (!cmt) throw new DomainError('NOT_FOUND', 'not found');
      const p = await this.c.newsPosts.findOne({ _id: cmt.postId }, { projection: { eventId: 1 } });
      return { eventId: p?.eventId ?? null, teamId: null };
    }
    if (type === 'chat') {
      const m = await this.c.chatMessages.findOne({ _id: id });
      if (!m) throw new DomainError('NOT_FOUND', 'not found');
      return { eventId: m.roomId.startsWith('ev:') ? m.roomId.slice(3) : null, teamId: m.roomId.startsWith('team:') ? m.roomId.slice(5) : null };
    }
    if (type === 'match_message') {
      const m = await this.c.matchMessages.findOne({ _id: id });
      if (!m) throw new DomainError('NOT_FOUND', 'not found');
      const match = await this.c.matches.findOne({ _id: m.matchId }, { projection: { eventId: 1 } });
      return { eventId: match?.eventId ?? null, teamId: null };
    }
    const p = await this.c.newsPosts.findOne({ _id: id }, { projection: { eventId: 1 } });
    if (!p) throw new DomainError('NOT_FOUND', 'not found');
    return { eventId: p.eventId, teamId: null };
  }
  private async moderatorScope(actor: string, scope: ContentReportDoc['scope'], requestId: string) {
    if (await this.ct.acl.can(actor, 'community.moderate', { type: 'site', id: 'site' })) return;
    if (scope.eventId) return this.ct.acl.require(actor, 'community.moderate', { type: 'event', id: scope.eventId }, requestId);
    return this.ct.acl.require(actor, 'community.moderate', { type: 'site', id: 'site' }, requestId);
  }
  async queue(actor: string, requestId: string, eventId?: string | undefined) {
    await this.moderatorScope(actor, { eventId: eventId ?? null, teamId: null }, requestId);
    const rows = await this.c.contentReports.find({ state: 'open', ...(eventId ? { 'scope.eventId': eventId } : {}) }).sort({ createdAt: 1 }).limit(200).toArray();
    const out = [];
    for (const r of rows) out.push({ ...r, content: await this.contentText(r.targetType, r.targetId) });
    return out;
  }
  private async contentText(type: ContentReportDoc['targetType'], id: string): Promise<string | null> {
    if (type === 'comment') return (await this.c.comments.findOne({ _id: id }))?.text ?? null;
    if (type === 'chat') return (await this.c.chatMessages.findOne({ _id: id }))?.text ?? null;
    if (type === 'match_message') return (await this.c.matchMessages.findOne({ _id: id }))?.text ?? null;
    return (await this.c.newsPosts.findOne({ _id: id }))?.title ?? null;
  }
  /** Hide (with reason) or dismiss; the decision is audited and the reporter can see the outcome. */
  async decide(reportId: string, action: 'hide' | 'dismiss', note: string, actor: string, requestId: string): Promise<ContentReportDoc> {
    const r = await this.c.contentReports.findOne({ _id: reportId, state: 'open' });
    if (!r) throw new DomainError('NOT_FOUND', 'report not found');
    await this.moderatorScope(actor, r.scope, requestId);
    if (r.reporterId === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'you cannot decide your own report');
    if (action === 'hide') {
      const mod = { by: actor, reason: clean(note, 300) || 'community rules', at: iso() };
      if (r.targetType === 'comment') await this.c.comments.updateOne({ _id: r.targetId }, { $set: { hidden: mod } });
      else if (r.targetType === 'chat') await this.c.chatMessages.updateOne({ _id: r.targetId }, { $set: { hidden: mod } });
      else if (r.targetType === 'match_message') await this.c.matchMessages.updateOne({ _id: r.targetId }, { $set: { hidden: true } });
    }
    const out = (await this.c.contentReports.findOneAndUpdate({ _id: reportId, state: 'open' }, { $set: { state: action === 'hide' ? 'actioned' : 'dismissed', decidedBy: actor, note: clean(note, 500) } }, { returnDocument: 'after' }))!;
    // other open reports on the same content are closed with the same decision
    await this.c.contentReports.updateMany({ targetType: r.targetType, targetId: r.targetId, state: 'open' }, { $set: { state: out.state, decidedBy: actor, note: out.note } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: `community.${action}`, target: { type: r.targetType, id: r.targetId }, scope: r.scope.eventId ? { type: 'event', id: r.scope.eventId } : { type: 'site', id: 'site' }, outcome: 'success', details: { reportId, note }, requestId });
    return out;
  }
}
