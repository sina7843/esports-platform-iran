import { DomainError, newsMachine, type Role } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { MatchOutcome } from '../db/collections-esp04.js';
import type { NewsAssignmentDoc, NewsPostDoc, PostFormat, PostKind, PostMedia } from '../db/collections-esp06.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import { isVisible, liveAudience, maxDelaySeconds, resolveView, visibleAtFor, type View } from '../live/policy.js';

const iso = () => new Date().toISOString();
// eslint-disable-next-line no-control-regex -- removing control characters is the purpose of this pattern
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** EDIT-005 sanitisation: plain text only (rendered as text nodes, never HTML), control characters removed. */
export const clean = (s: string, max: number) => s.replace(CONTROL, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const httpsUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.username && !x.password;
  } catch {
    return false;
  }
};
const slugOf = (title: string, id: string) => `${clean(title, 80).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'post'}-${id.slice(-8).toLowerCase()}`;

export interface PostInput {
  eventId: string | null;
  kind: PostKind;
  format: PostFormat;
  title: string;
  body: string;
  quote?: { text: string; speaker: string } | null | undefined;
  link?: { url: string; label: string } | null | undefined;
  relations?: { [K in keyof NewsPostDoc['relations']]?: NewsPostDoc['relations'][K] | undefined } | undefined;
  occurredAt?: string | null | undefined;
  official?: boolean | undefined;
  spoiler?: boolean | undefined;
  category?: string | undefined;
  tags?: string[] | undefined;
  seo?: { [K in keyof NewsPostDoc['seo']]?: NewsPostDoc['seo'][K] | undefined } | undefined;
}

/** Public projection: no internal notes, reviewers, assignees or private file ids. */
export function publicPost(p: NewsPostDoc) {
  return {
    id: p._id, slug: p.slug, eventId: p.eventId, kind: p.kind, format: p.format, title: p.title, body: p.withdrawal ? '' : p.body, quote: p.withdrawal ? null : p.quote, link: p.withdrawal ? null : p.link,
    media: p.withdrawal ? [] : p.media.map((m) => ({ fileId: m.fileId, url: m.url ?? null, kind: m.kind, caption: m.caption, credit: m.credit })),
    relations: p.relations, source: p.source, authorId: p.authorId, occurredAt: p.occurredAt, publishedAt: p.publishedAt, state: p.state, pinned: p.pinned, highlighted: p.highlighted,
    category: p.category, tags: p.tags, seo: p.seo, result: p.resultRef ? { matchId: p.resultRef.matchId, final: p.resultRef.final, version: p.resultRef.resultVersion } : null, spoiler: p.spoiler,
    edited: p.editedAt ? { at: p.editedAt, reason: p.versions.at(-1)?.reason ?? null } : null, withdrawal: p.withdrawal ? { reason: p.withdrawal.reason, at: p.withdrawal.at } : null, correction: p.correction, version: p.version,
  };
}
export type PublicPost = ReturnType<typeof publicPost>;

/**
 * NEWS-001..008, EDIT-001..007: posts, editorial workflow and the newsroom. Result data in posts always comes from
 * the competition engine and cannot be edited by reporters; automatic posts are keyed by the official occurrence
 * (unique dedupe key) so each happens exactly once; a result correction marks every earlier result post and adds a
 * traceable correction post. Every publication is pushed to the live channels through the publication policy.
 */
export class NewsService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string | null) {
    return eventId ? { type: 'event' as const, id: eventId } : { type: 'site' as const, id: 'site' };
  }
  async load(id: string): Promise<NewsPostDoc> {
    const p = await this.c.newsPosts.findOne({ _id: id });
    if (!p) throw new DomainError('NOT_FOUND', 'post not found');
    return p;
  }
  private async canPublish(actor: string, eventId: string | null) {
    return this.ct.acl.can(actor, 'news.publish', this.scope(eventId));
  }

  // ------------------------------------------------------------------ creation and editing
  private async resultFields(matchId: string): Promise<{ resultRef: NonNullable<NewsPostDoc['resultRef']>; title: string; body: string; m: MatchDoc }> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    const final = m.state === 'final' && !!m.outcome;
    const outcome = final ? m.outcome! : (m.result?.submissions.find((x) => x.source !== 'integration')?.outcome ?? null);
    if (!outcome) throw new DomainError('PRECONDITION_FAILED', 'this match has no result yet');
    const stage = await this.c.stages.findOne({ _id: m.stageId }, { projection: { name: 1 } });
    const text = describe(m, outcome);
    // NEWS-008: a provisional result is never titled as final
    return { m, resultRef: { matchId, resultVersion: m.resultVersion, final }, title: `${final ? 'نتیجه نهایی' : 'نتیجه موقت (در انتظار تأیید)'}: ${text}`, body: `${stage?.name ?? ''} — ${text}${final ? '' : '\nاین نتیجه هنوز رسمی نشده است.'}` };
  }

  async create(input: PostInput, actor: string, requestId: string): Promise<{ post: NewsPostDoc; warnings: string[] }> {
    await this.ct.acl.require(actor, 'news.draft', this.scope(input.eventId), requestId);
    if (input.eventId && !(await this.c.events.findOne({ _id: input.eventId }, { projection: { _id: 1 } }))) throw new DomainError('NOT_FOUND', 'event not found');
    if (input.official && !(await this.canPublish(actor, input.eventId))) throw new DomainError('FORBIDDEN', 'only an editor/organizer marks a post official');
    const relations = { matchId: input.relations?.matchId ?? null, stageId: input.relations?.stageId ?? null, disciplineId: input.relations?.disciplineId ?? null, teamIds: input.relations?.teamIds ?? [], principalIds: input.relations?.principalIds ?? [], participationIds: input.relations?.participationIds ?? [] };
    let title = clean(input.title, 200);
    let body = clean(input.body, 20_000);
    let resultRef: NewsPostDoc['resultRef'] = null;
    if (input.kind === 'result') {
      if (!relations.matchId) throw new DomainError('VALIDATION_FAILED', 'a result post is linked to a match');
      const r = await this.resultFields(relations.matchId);
      resultRef = r.resultRef;
      title = r.title; // NEWS-005: the engine writes the result text, not the author
      body = body ? `${r.body}\n\n${body}` : r.body;
      relations.stageId = r.m.stageId;
      relations.disciplineId = r.m.disciplineId;
      relations.participationIds = r.m.participantIds ?? [];
    }
    if (relations.matchId && input.eventId) {
      const m = await this.c.matches.findOne({ _id: relations.matchId }, { projection: { eventId: 1 } });
      if (!m || m.eventId !== input.eventId) throw new DomainError('VALIDATION_FAILED', 'the match is not part of this event');
    }
    if (title.length < 3) throw new DomainError('VALIDATION_FAILED', 'title is required');
    if (input.kind === 'quote' && (!input.quote?.text || !input.quote.speaker)) throw new DomainError('VALIDATION_FAILED', 'a quote needs text and speaker');
    if (input.kind === 'link' && (!input.link || !httpsUrl(input.link.url))) throw new DomainError('VALIDATION_FAILED', 'a link post needs an https URL');
    if (input.seo?.canonical && !httpsUrl(input.seo.canonical)) throw new DomainError('VALIDATION_FAILED', 'canonical must be an https URL');
    const id = newId('pst');
    const doc: NewsPostDoc = {
      _id: id, slug: slugOf(title, id), eventId: input.eventId, kind: input.kind, format: input.format, title, body,
      quote: input.quote ? { text: clean(input.quote.text, 1000), speaker: clean(input.quote.speaker, 120) } : null,
      link: input.link ? { url: input.link.url, label: clean(input.link.label, 200) } : null, media: [], relations,
      source: input.official ? 'official' : 'reporter', authorId: actor, occurredAt: input.occurredAt ?? iso(), publishAt: null, publishedAt: null, state: 'draft', pinned: false, highlighted: false,
      category: clean(input.category ?? 'news', 40) || 'news', tags: (input.tags ?? []).map((t) => clean(t, 40)).filter(Boolean).slice(0, 10),
      seo: { title: input.seo?.title ? clean(input.seo.title, 70) : null, description: input.seo?.description ? clean(input.seo.description, 170) : null, canonical: input.seo?.canonical ?? null, shareImageFileId: null },
      resultRef, spoiler: input.kind === 'result' || input.kind === 'decision' ? true : (input.spoiler ?? !!relations.matchId), dedupeKey: null, versions: [], editedAt: null, withdrawal: null, correction: null,
      internalNotes: [], assigneeId: null, reviewNote: null, createdAt: iso(), updatedAt: iso(), version: 0,
    };
    // EDIT-004 duplicate warning: same match and kind recently, by anyone
    const warnings: string[] = [];
    if (relations.matchId) {
      const dup = await this.c.newsPosts.find({ 'relations.matchId': relations.matchId, kind: input.kind, withdrawal: null, createdAt: { $gt: new Date(Date.now() - 15 * 60_000).toISOString() } }).limit(3).toArray();
      if (dup.length) warnings.push(`possible duplicate of ${dup.map((d) => d._id).join(', ')}`);
    }
    await this.c.newsPosts.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'news.create', target: { type: 'news_post', id }, scope: this.scope(input.eventId), outcome: 'success', details: { kind: input.kind, warnings: warnings.length }, requestId });
    return { post: doc, warnings };
  }

  /** Drafts are edited freely by their author; a published post is corrected by an editor with a visible reason (NEWS-004). */
  async edit(id: string, input: { title?: string | undefined; body?: string | undefined; reason: string; expectedVersion: number }, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    const editor = await this.canPublish(actor, p.eventId);
    if (p.authorId !== actor && !editor) throw new DomainError('FORBIDDEN', 'only the author or an editor edits this post');
    if (p.source === 'automatic' && !editor) throw new DomainError('FORBIDDEN', 'automatic posts are corrected by editors');
    // NEWS-005: the engine-written result title is not editable
    const title = p.kind === 'result' || p.source === 'automatic' ? p.title : input.title !== undefined ? clean(input.title, 200) : p.title;
    const body = input.body !== undefined ? clean(input.body, 20_000) : p.body;
    if (p.kind === 'result' && p.resultRef && !body.startsWith(p.body.split('\n')[0]!)) throw new DomainError('FORBIDDEN', 'the engine result line cannot be edited');
    if (['draft', 'in_review'].includes(p.state)) {
      const r = await this.c.newsPosts.findOneAndUpdate({ _id: id, version: input.expectedVersion }, { $set: { title, body, updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'the post changed; reload');
      return r;
    }
    if (!editor) throw new DomainError('FORBIDDEN', 'a published post is corrected by an editor');
    if (input.reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a correction needs a visible reason');
    const { doc } = await applyTransition(newsMachine, this.c.newsPosts, id, { transition: 'correct', expectedVersion: input.expectedVersion, actorRoles: ['editor'] }, { title, body, versions: [...p.versions, { at: iso(), by: actor, title: p.title, body: p.body, reason: clean(input.reason, 500) }], editedAt: iso() } as Partial<NewsPostDoc>);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'news.correct', target: { type: 'news_post', id }, scope: this.scope(p.eventId), outcome: 'success', details: { reason: input.reason }, requestId });
    await this.broadcast(doc, 'post.upsert');
    return doc;
  }

  /** EDIT-007: attaches an image with rights/consent; the public display variant is metadata-stripped, the original stays private. */
  async attachMedia(id: string, input: { fileId: string; caption: string | null; credit: string; rights: PostMedia['rights']; consent: PostMedia['consent'] }, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    if (p.authorId !== actor && !(await this.canPublish(actor, p.eventId))) throw new DomainError('FORBIDDEN', 'only the author or an editor adds media');
    if (!['draft', 'in_review'].includes(p.state)) throw new DomainError('PRECONDITION_FAILED', 'media is added before publication');
    if (clean(input.credit, 120).length < 2) throw new DomainError('VALIDATION_FAILED', 'credit the creator');
    const display = await this.ct.files.deriveDisplay(input.fileId, this.scope(p.eventId), { principalId: actor, requestId });
    const item: PostMedia = { fileId: display._id, url: display.publicUrl, originalFileId: input.fileId, kind: 'image', caption: input.caption ? clean(input.caption, 300) : null, credit: clean(input.credit, 120), rights: input.rights, consent: { required: input.consent.required, obtained: input.consent.obtained, note: input.consent.note ? clean(input.consent.note, 300) : null } };
    const r = await this.c.newsPosts.findOneAndUpdate({ _id: id, 'media.9': { $exists: false } }, { $push: { media: item }, $set: { updatedAt: iso(), ...(p.seo.shareImageFileId ? {} : { 'seo.shareImageFileId': display._id }) }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VALIDATION_FAILED', 'at most 10 media items');
    return r;
  }

  async note(id: string, text: string, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    await this.ct.acl.require(actor, 'news.draft', this.scope(p.eventId), requestId);
    return (await this.c.newsPosts.findOneAndUpdate({ _id: id }, { $push: { internalNotes: { by: actor, at: iso(), text: clean(text, 2000) } } }, { returnDocument: 'after' }))!;
  }

  // ------------------------------------------------------------------ workflow (EDIT-003)
  private assertPublishable(p: NewsPostDoc) {
    if (p.media.some((m) => m.consent.required && !m.consent.obtained)) throw new DomainError('PRECONDITION_FAILED', 'a media item needs consent before publication (EDIT-007)');
    if (p.kind === 'result' && p.resultRef && !p.resultRef.final && p.title.startsWith('نتیجه نهایی')) throw new DomainError('PRECONDITION_FAILED', 'a provisional result cannot be titled final (NEWS-008)');
  }
  async submit(id: string, expectedVersion: number, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    await this.ct.acl.require(actor, 'news.draft', this.scope(p.eventId), requestId);
    return (await applyTransition(newsMachine, this.c.newsPosts, id, { transition: 'submit', expectedVersion, actorRoles: ['reporter'] }, { updatedAt: iso() } as Partial<NewsPostDoc>)).doc;
  }
  async returnToDraft(id: string, note: string, expectedVersion: number, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    await this.ct.acl.require(actor, 'news.publish', this.scope(p.eventId), requestId);
    if (p.state !== 'in_review') throw new DomainError('ILLEGAL_TRANSITION', `post is ${p.state}`);
    const r = await this.c.newsPosts.findOneAndUpdate({ _id: id, version: expectedVersion, state: 'in_review' }, { $set: { state: 'draft', reviewNote: clean(note, 1000), updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'the post changed; reload');
    return r;
  }
  async schedule(id: string, publishAt: string, expectedVersion: number, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    await this.ct.acl.require(actor, 'news.publish', this.scope(p.eventId), requestId);
    if (Number.isNaN(Date.parse(publishAt)) || Date.parse(publishAt) <= Date.now()) throw new DomainError('VALIDATION_FAILED', 'publication time must be in the future');
    this.assertPublishable(p);
    return (await applyTransition(newsMachine, this.c.newsPosts, id, { transition: 'schedule', expectedVersion, actorRoles: ['editor'] }, { publishAt, updatedAt: iso() } as Partial<NewsPostDoc>)).doc;
  }
  /** Direct publish is reserved to holders of `news.publish` (editor/organizer). */
  async publish(id: string, expectedVersion: number, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    const system = actor === 'system';
    if (!system) await this.ct.acl.require(actor, 'news.publish', this.scope(p.eventId), requestId);
    this.assertPublishable(p);
    const { doc } = await applyTransition(newsMachine, this.c.newsPosts, id, { transition: 'publish', expectedVersion, actorRoles: [system ? 'system' : 'editor'] }, { publishedAt: iso(), updatedAt: iso() } as Partial<NewsPostDoc>);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'news.publish', target: { type: 'news_post', id }, scope: this.scope(p.eventId), outcome: 'success', requestId });
    await this.broadcast(doc, 'post.upsert');
    return doc;
  }
  /** NEWS-004: a withdrawal keeps a public tombstone with its reason. */
  async withdraw(id: string, reason: string, expectedVersion: number, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    await this.ct.acl.require(actor, 'news.publish', this.scope(p.eventId), requestId);
    if (clean(reason, 500).length < 5) throw new DomainError('VALIDATION_FAILED', 'a withdrawal needs a reason');
    const { doc } = await applyTransition(newsMachine, this.c.newsPosts, id, { transition: 'retract', expectedVersion, actorRoles: ['editor'] }, { withdrawal: { reason: clean(reason, 500), by: actor, at: iso() }, pinned: false, updatedAt: iso() } as Partial<NewsPostDoc>);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'news.withdraw', target: { type: 'news_post', id }, scope: this.scope(p.eventId), outcome: 'success', details: { reason }, requestId });
    await this.broadcast(doc, 'post.upsert');
    return doc;
  }
  async flag(id: string, input: { pinned?: boolean | undefined; highlighted?: boolean | undefined }, actor: string, requestId: string): Promise<NewsPostDoc> {
    const p = await this.load(id);
    await this.ct.acl.require(actor, 'news.publish', this.scope(p.eventId), requestId);
    if (!['published', 'corrected'].includes(p.state)) throw new DomainError('PRECONDITION_FAILED', 'only published posts are pinned or highlighted');
    const r = (await this.c.newsPosts.findOneAndUpdate({ _id: id }, { $set: { ...(input.pinned !== undefined ? { pinned: input.pinned } : {}), ...(input.highlighted !== undefined ? { highlighted: input.highlighted } : {}), updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' }))!;
    await this.broadcast(r, 'post.upsert');
    return r;
  }
  /** Worker: scheduled posts whose time has come. */
  async publishDue(now = new Date()): Promise<number> {
    const due = await this.c.newsPosts.find({ state: 'scheduled', publishAt: { $lte: now.toISOString() } }).limit(100).toArray();
    let n = 0;
    for (const p of due) await this.publish(p._id, p.version, 'system', `news-schedule:${p._id}`).then(() => n++).catch(() => undefined);
    return n;
  }

  // ------------------------------------------------------------------ live push (CAST-005/006)
  /**
   * Publishes the post change on the latest channel immediately and on each stream-synced channel at the moment the
   * post may be seen there (spoilers wait for occurredAt + delay; other posts are immediate).
   */
  async broadcast(p: NewsPostDoc, type: 'post.upsert'): Promise<void> {
    if (!p.eventId || !['published', 'corrected', 'retracted'].includes(p.state)) return;
    const payload = { post: publicPost(p) };
    const audience = await liveAudience(this.c, p.eventId);
    await this.ct.realtime.publish({ channel: `live:${p.eventId}:latest`, type, audience, payload });
    const streams = await this.c.broadcastStreams.find({ eventId: p.eventId }).toArray();
    const delays = new Set([0, ...streams.map((s) => s.delaySeconds)]);
    for (const d of delays) {
      const at = p.spoiler ? visibleAtFor(p.occurredAt, d) : iso();
      await this.ct.realtime.publish({ channel: `live:${p.eventId}:d${d}`, type, audience, payload, ...(at > iso() ? { visibleAt: at } : {}) });
    }
  }

  // ------------------------------------------------------------------ automatic posts (NEWS-006, AC-14)
  /** Creates the post for an official occurrence exactly once; returns null when it already exists. */
  async autoPost(dedupeKey: string, input: { eventId: string; kind: PostKind; title: string; body: string; relations: NewsPostDoc['relations']; occurredAt: string; spoiler: boolean; resultRef?: NewsPostDoc['resultRef'] | undefined }): Promise<NewsPostDoc | null> {
    const id = newId('pst');
    const doc: NewsPostDoc = {
      _id: id, slug: slugOf(input.title, id), eventId: input.eventId, kind: input.kind, format: 'live', title: clean(input.title, 200), body: clean(input.body, 5000), quote: null, link: null, media: [], relations: input.relations,
      source: 'automatic', authorId: 'system', occurredAt: input.occurredAt, publishAt: null, publishedAt: null, state: 'draft', pinned: false, highlighted: false, category: 'live', tags: [],
      seo: { title: null, description: null, canonical: null, shareImageFileId: null }, resultRef: input.resultRef ?? null, spoiler: input.spoiler, dedupeKey, versions: [], editedAt: null, withdrawal: null, correction: null,
      internalNotes: [], assigneeId: null, reviewNote: null, createdAt: iso(), updatedAt: iso(), version: 0,
    };
    try {
      await this.c.newsPosts.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return null; // the occurrence already has its post
      throw e;
    }
    return this.publish(id, 0, 'system', `auto:${dedupeKey}`);
  }

  private async matchRelations(m: MatchDoc): Promise<NewsPostDoc['relations']> {
    const parts = await this.c.participations.find({ _id: { $in: m.participantIds ?? [] } }, { projection: { snapshot: 1 } }).toArray();
    return { matchId: m._id, stageId: m.stageId, disciplineId: m.disciplineId, teamIds: parts.map((p) => p.snapshot.teamId).filter((x): x is string => !!x), principalIds: m.principalIds ?? [], participationIds: m.participantIds ?? [] };
  }

  /** Maps official outbox events to automatic posts and corrections. Safe to replay. */
  async onEvent(type: string, payload: Record<string, unknown>, occurredAt: string): Promise<void> {
    const matchId = typeof payload['matchId'] === 'string' ? payload['matchId'] : null;
    const m = matchId ? await this.c.matches.findOne({ _id: matchId }) : null;
    if (type === 'competition.match.started' && m) {
      await this.autoPost(`match.start:${m._id}`, { eventId: m.eventId, kind: 'notice', title: `آغاز بازی: ${m.sides.map((s) => s.displayName).join(' — ')}`, body: `${m.slot?.key ?? ''}`, relations: await this.matchRelations(m), occurredAt, spoiler: false });
    } else if (type === 'competition.match.finalized' && m && m.outcome) {
      const r = await this.resultFields(m._id);
      await this.autoPost(`match.final:${m._id}`, { eventId: m.eventId, kind: 'result', title: r.title, body: r.body, relations: await this.matchRelations(m), occurredAt, spoiler: true, resultRef: r.resultRef });
    } else if ((type === 'competition.participant.advanced' || type === 'competition.participant.eliminated') && m) {
      const adv = type.endsWith('advanced');
      await this.autoPost(String(payload['dedupeKey']), { eventId: m.eventId, kind: 'notice', title: `${String(payload['displayName'])} ${adv ? 'صعود کرد' : 'حذف شد'}`, body: `${m.slot?.key ?? ''}`, relations: await this.matchRelations(m), occurredAt, spoiler: true });
    } else if (type === 'competition.match.rescheduled' && m) {
      await this.autoPost(`match.time:${m._id}:${String(payload['scheduledAt'])}`, { eventId: m.eventId, kind: 'notice', title: `تغییر زمان بازی: ${m.sides.map((s) => s.displayName).join(' — ') || m.slot?.key}`, body: `زمان جدید: ${String(payload['scheduledAt'])}`, relations: await this.matchRelations(m), occurredAt, spoiler: false });
    } else if (type === 'honors.issued' && payload['label'] === 'champion') {
      const h = await this.c.honors.findOne({ _id: String(payload['honorId']) });
      if (h) await this.autoPost(`champion:${h.eventId}:${h.disciplineId}:${h.participationId}`, { eventId: h.eventId, kind: 'notice', title: `قهرمان: ${h.team?.nameAtTime ?? h.recipients.map((r) => r.displayName).join('، ')}`, body: h.eventName, relations: { matchId: null, stageId: h.stageId, disciplineId: h.disciplineId, teamIds: h.team ? [h.team.teamId] : [], principalIds: h.recipients.filter((r) => r.eligible).map((r) => r.principalId), participationIds: h.participationId ? [h.participationId] : [] }, occurredAt, spoiler: true });
    } else if (type === 'competition.event.finished' || type === 'competition.event.closed') {
      const eventId = String(payload['eventId']);
      await this.autoPost(`${type}:${eventId}`, { eventId, kind: 'notice', title: type.endsWith('finished') ? 'پایان رقابت‌ها' : 'رویداد بسته شد؛ نتایج و افتخارات رسمی است', body: String(payload['name'] ?? ''), relations: { matchId: null, stageId: null, disciplineId: null, teamIds: [], principalIds: [], participationIds: [] }, occurredAt, spoiler: false });
    } else if (type === 'competition.result.corrected' && m) {
      await this.applyCorrection(m, String(payload['correctionId']), String(payload['reason'] ?? ''), occurredAt);
    }
  }

  /** NEWS-007: every earlier result-bearing post of the match gets a visible correction notice, plus one correction post. */
  async applyCorrection(m: MatchDoc, correctionId: string, reason: string, occurredAt: string): Promise<void> {
    const notice = `اصلاحیه: نتیجه این رویارویی پس از بازبینی رسمی تغییر کرد${reason ? ` (${clean(reason, 200)})` : ''}.`;
    for (const p of await this.c.newsPosts.find({ 'relations.matchId': m._id, spoiler: true, state: { $in: ['published', 'corrected'] }, 'correction.ref': { $ne: correctionId }, dedupeKey: { $ne: `correction:${correctionId}` } }).toArray()) {
      const { doc } = await applyTransition(newsMachine, this.c.newsPosts, p._id, { transition: 'correct', expectedVersion: p.version, actorRoles: ['system'] }, { correction: { notice, ref: correctionId, at: iso() }, updatedAt: iso() } as Partial<NewsPostDoc>);
      await this.broadcast(doc, 'post.upsert');
    }
    const r = m.outcome ? await this.resultFields(m._id) : null;
    await this.autoPost(`correction:${correctionId}`, { eventId: m.eventId, kind: 'result', title: `اصلاحیه نتیجه: ${r ? describe(m, m.outcome!) : m.slot?.key ?? ''}`, body: notice, relations: await this.matchRelations(m), occurredAt, spoiler: true, resultRef: r?.resultRef ?? null });
  }

  // ------------------------------------------------------------------ reading
  /** Public listing with category/event/search filters; spoiler posts obey the event's default (most delayed) view. */
  async list(f: { eventId?: string | undefined; category?: string | undefined; format?: string | undefined; authorId?: string | undefined; q?: string | undefined; teamId?: string | undefined; before?: string | undefined; limit: number }) {
    const filter: Record<string, unknown> = { state: { $in: ['published', 'corrected', 'retracted'] } };
    if (f.eventId) filter['eventId'] = f.eventId;
    if (f.category) filter['category'] = f.category;
    if (f.format) filter['format'] = f.format;
    if (f.authorId) filter['authorId'] = f.authorId;
    if (f.teamId) filter['relations.teamIds'] = f.teamId;
    if (f.before) filter['publishedAt'] = { $lt: f.before };
    if (f.q) {
      const rx = new RegExp(escapeRx(normalizeFa(f.q)).slice(0, 100), 'i');
      filter['$or'] = [{ title: rx }, { body: rx }, { tags: rx }];
    }
    const rows = await this.c.newsPosts.find(filter).sort({ publishedAt: -1 }).limit(Math.min(f.limit, 100) * 2).toArray();
    const out = [];
    const views = new Map<string, View>();
    for (const p of rows) {
      if (p.eventId && p.spoiler) {
        if (!views.has(p.eventId)) views.set(p.eventId, { kind: 'synced', streamId: null, delaySeconds: await maxDelaySeconds(this.c, p.eventId) });
        if (!isVisible(views.get(p.eventId)!, p.occurredAt, true)) continue;
      }
      if (await this.eventHidden(p.eventId)) continue;
      out.push(publicPost(p));
      if (out.length >= f.limit) break;
    }
    return out;
  }
  private hiddenCache = new Map<string, boolean>();
  private async eventHidden(eventId: string | null): Promise<boolean> {
    if (!eventId) return false;
    if (!this.hiddenCache.has(eventId)) {
      const e = await this.c.events.findOne({ _id: eventId }, { projection: { visibility: 1 } });
      this.hiddenCache.set(eventId, !e || e.visibility !== 'public');
    }
    return this.hiddenCache.get(eventId)!;
  }
  /** Article page by slug (or id) in a view; a spoiler not yet visible in that view is "not found". */
  async bySlug(slug: string, view?: string | undefined) {
    const p = await this.c.newsPosts.findOne({ $or: [{ slug }, { _id: slug }], state: { $in: ['published', 'corrected', 'retracted'] } });
    if (!p || (await this.eventHidden(p.eventId))) throw new DomainError('NOT_FOUND', 'post not found');
    if (p.eventId && p.spoiler) {
      const v = view === 'latest' ? await resolveView(this.c, p.eventId, 'latest') : { kind: 'synced' as const, streamId: null, delaySeconds: await maxDelaySeconds(this.c, p.eventId) };
      if (!isVisible(v, p.occurredAt, true)) throw new DomainError('NOT_FOUND', 'post not found');
    }
    const author = p.authorId === 'system' ? null : await this.c.profiles.findOne({ _id: p.authorId }, { projection: { nickname: 1 } });
    return { ...publicPost(p), author: author ? { id: p.authorId, nickname: author.nickname } : null };
  }
  /** EDIT-006: SEO metadata and NewsArticle structured data (JSON-LD safe for inline embedding). */
  async meta(slug: string, origin: string) {
    const p = await this.bySlug(slug);
    const canonical = p.seo.canonical ?? `${origin}/news/${encodeURIComponent(p.slug)}`;
    const image = p.seo.shareImageFileId ? `${origin}/api/v1/news/${p.id}/card.svg` : `${origin}/api/v1/news/${p.id}/card.svg`;
    const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: p.seo.title ?? p.title, datePublished: p.publishedAt, dateModified: p.edited?.at ?? p.publishedAt, inLanguage: 'fa-IR', mainEntityOfPage: canonical, image: [image], author: p.author ? { '@type': 'Person', name: p.author.nickname } : { '@type': 'Organization', name: 'سامانه نتایج رسمی' } };
    return { title: p.seo.title ?? p.title, description: p.seo.description ?? p.body.slice(0, 160), canonical, image, jsonLd: JSON.stringify(ld).replace(/</g, '\\u003c') };
  }
  /** EDIT-006 share image: a local SVG; it obeys the same view as the article (a hidden spoiler is "not found"). */
  async card(slug: string): Promise<string> {
    const p = await this.bySlug(slug);
    const esc = (x: string) => x.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const ev = p.eventId ? await this.c.events.findOne({ _id: p.eventId }, { projection: { name: 1 } }) : null;
    const badge = p.result ? (p.result.final ? 'نتیجه رسمی' : 'نتیجه موقت — رسمی نیست') : p.withdrawal ? 'پس‌گرفته‌شده' : p.correction ? 'اصلاح‌شده' : '';
    const words = p.title.split(/\s+/);
    const lines: string[] = [];
    for (const w of words) {
      const last = lines.at(-1);
      if (last !== undefined && (last + ' ' + w).length <= 34) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" direction="rtl"><rect width="1200" height="630" fill="#0f172a"/>${lines.slice(0, 4).map((l, i) => `<text x="1140" y="${200 + i * 80}" text-anchor="end" font-size="56" font-weight="700" fill="#f8fafc">${esc(l)}</text>`).join('')}${badge ? `<text x="1140" y="120" text-anchor="end" font-size="34" fill="${p.result && !p.result.final ? '#f59e0b' : '#38bdf8'}">${esc(badge)}</text>` : ''}<text x="1140" y="570" text-anchor="end" font-size="30" fill="#94a3b8">${esc(ev?.name ?? '')}</text></svg>`;
  }
  async newsroomQueue(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'news.draft', this.scope(eventId), requestId);
    const posts = await this.c.newsPosts.find({ eventId }).sort({ updatedAt: -1 }).limit(200).toArray();
    const streams = await this.c.broadcastStreams.find({ eventId }).toArray();
    // CAST-007 preview: when each post becomes visible per stream
    return posts.map((p) => ({ ...p, visibility: [{ view: 'latest', at: p.publishedAt ?? p.publishAt }, ...streams.map((s) => ({ view: `stream:${s._id}`, label: s.label, at: p.spoiler ? visibleAtFor(p.occurredAt, s.delaySeconds) : (p.publishedAt ?? p.publishAt) }))] }));
  }

  // ------------------------------------------------------------------ newsroom templates, assignments (EDIT-002/004)
  async templates(matchId: string, actor: string, requestId: string) {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await this.ct.acl.require(actor, 'news.draft', this.scope(m.eventId), requestId);
    const names = m.sides.map((s) => s.displayName);
    const parts = await this.c.participations.find({ _id: { $in: m.participantIds ?? [] } }).toArray();
    const teams = await this.c.teams.find({ _id: { $in: parts.map((p) => p.snapshot.teamId).filter((x): x is string => !!x) } }, { projection: { logoFileId: 1, name: 1 } }).toArray();
    const logos = await this.c.files.find({ _id: { $in: teams.map((t) => t.logoFileId).filter((x): x is string => !!x) } }, { projection: { publicUrl: 1 } }).toArray();
    const final = m.state === 'final' && m.outcome ? describe(m, m.outcome) : null;
    return {
      match: { id: m._id, state: m.state, sides: names, scheduledAt: m.scheduledAt ?? null, final: !!final },
      logos: logos.map((l) => l.publicUrl).filter(Boolean),
      templates: [
        { key: 'preview', title: `پیش‌بازی: ${names.join(' مقابل ')}`, body: `${names.join(' و ')} به مصاف هم می‌روند.` },
        { key: 'start', title: `آغاز بازی ${names.join(' — ')}`, body: 'بازی آغاز شد.' },
        { key: 'interview', title: `گفت‌وگو پس از بازی ${names.join(' — ')}`, body: '' },
        ...(final ? [{ key: 'result', title: `نتیجه نهایی: ${final}`, body: 'نتیجه رسمی از موتور مسابقات درج می‌شود.' }] : []),
      ],
    };
  }

  async assign(input: { eventId: string; matchId: string | null; principalId: string; role: NewsAssignmentDoc['role']; from: string; to: string | null; note: string | null }, actor: string, requestId: string): Promise<NewsAssignmentDoc> {
    await this.ct.acl.require(actor, 'newsroom.manage', this.scope(input.eventId), requestId);
    if (!(await this.c.principals.findOne({ _id: input.principalId, status: 'active' }))) throw new DomainError('NOT_FOUND', 'principal not found');
    const grant = await this.ct.acl.grant({ principalId: input.principalId, role: input.role as Role, scope: this.scope(input.eventId), expiresAt: input.to, reason: 'newsroom assignment' }, { principalId: actor, requestId });
    const doc: NewsAssignmentDoc = { _id: newId('nas'), eventId: input.eventId, matchId: input.matchId, principalId: input.principalId, role: input.role, from: input.from, to: input.to, note: input.note ? clean(input.note, 1000) : null, handover: null, state: 'active', grantId: grant._id, createdBy: actor, createdAt: iso() };
    await this.c.newsAssignments.insertOne(doc);
    return doc;
  }
  /** Shift handover: the outgoing person leaves a note; the incoming one receives an assignment; history is kept. */
  async handover(assignmentId: string, to: string, note: string, actor: string, requestId: string): Promise<NewsAssignmentDoc> {
    const a = await this.c.newsAssignments.findOne({ _id: assignmentId, state: 'active' });
    if (!a) throw new DomainError('NOT_FOUND', 'assignment not found');
    if (a.principalId !== actor && !(await this.ct.acl.can(actor, 'newsroom.manage', this.scope(a.eventId)))) throw new DomainError('FORBIDDEN', 'only the assignee or the newsroom lead hands over');
    if (clean(note, 2000).length < 5) throw new DomainError('VALIDATION_FAILED', 'leave a handover note');
    const next = await this.assign({ eventId: a.eventId, matchId: a.matchId, principalId: to, role: a.role, from: iso(), to: a.to, note: `تحویل از ${a.principalId}: ${clean(note, 900)}` }, a.createdBy === actor ? actor : (await this.ct.acl.can(actor, 'newsroom.manage', this.scope(a.eventId))) ? actor : a.createdBy, requestId);
    await this.c.newsAssignments.updateOne({ _id: a._id }, { $set: { state: 'handed_over', handover: { to, note: clean(note, 2000), at: iso() }, to: iso() } });
    if (a.grantId) await this.ct.acl.revoke(a.grantId, { principalId: 'system', requestId }, 'shift handed over').catch(() => undefined);
    return next;
  }
  async assignments(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'news.draft', this.scope(eventId), requestId);
    return this.c.newsAssignments.find({ eventId }).sort({ createdAt: -1 }).limit(200).toArray();
  }

  /** AUD-005: final report draft from official data and highlighted posts; publishing still needs an editor. */
  async draftFinalReport(eventId: string, actor: string, requestId: string): Promise<NewsPostDoc> {
    await this.ct.acl.require(actor, 'news.draft', this.scope(eventId), requestId);
    const e = await this.c.events.findOne({ _id: eventId });
    if (!e) throw new DomainError('NOT_FOUND', 'event not found');
    if (!['finished', 'closed', 'archived'].includes(e.state)) throw new DomainError('PRECONDITION_FAILED', 'the final report is drafted after the event finishes');
    const honors = await this.c.honors.find({ eventId, state: 'active', 'basis.kind': 'standing' }).sort({ place: 1 }).toArray();
    const highlights = await this.c.newsPosts.find({ eventId, highlighted: true, state: { $in: ['published', 'corrected'] } }).sort({ occurredAt: 1 }).limit(20).toArray();
    const finals = await this.c.matches.countDocuments({ eventId, state: 'final' });
    const lines = [
      `${e.name} با ${finals} رویارویی رسمی به پایان رسید.`,
      ...honors.map((h) => `${h.label === 'champion' ? 'قهرمان' : `مقام ${h.place}`}: ${h.team?.nameAtTime ?? h.recipients.filter((r) => r.eligible).map((r) => r.displayName).join('، ')}`),
      '',
      'لحظه‌های برگزیده:',
      ...highlights.map((p) => `• ${p.title}`),
    ];
    const { post } = await this.create({ eventId, kind: 'text', format: 'report', title: `گزارش پایانی ${e.name}`, body: lines.join('\n'), category: 'report', spoiler: true, occurredAt: iso() }, actor, requestId);
    return post;
  }
}

export function describe(m: Pick<MatchDoc, 'sides'>, o: MatchOutcome): string {
  const a = m.sides[0]?.displayName ?? '—';
  const b = m.sides[1]?.displayName ?? '—';
  if (o.kind === 'win') {
    const sc = o.maps ?? o.scores;
    return `${a} ${sc ? `${sc[0]}–${sc[1]}` : o.winnerSide === 0 ? '(برد)' : '(باخت)'} ${b}${o.forfeit ? ' (باخت فنی)' : ''}`;
  }
  if (o.kind === 'draw') return `${a} مساوی ${b}`;
  if (o.kind === 'double_forfeit') return `${a} و ${b}: غیبت هر دو طرف`;
  if (o.kind === 'placements') return `نفر اول: ${o.placements.find((p) => p.placement === 1)?.id ?? '—'}`;
  return 'رکوردها ثبت شد';
}
export const normalizeFa = (s: string) => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
export const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
