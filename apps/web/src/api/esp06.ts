import { API_BASE, request } from './client';

/** ESP-06 endpoints: live centre, news/newsroom, broadcast/overlays, community, notifications, search, home. */
const enc = encodeURIComponent;
type Obj = Record<string, unknown>;

export interface PublicPost {
  id: string; slug: string; eventId: string | null; kind: string; format: string; title: string; body: string;
  quote: { text: string; speaker: string } | null; link: { url: string; label: string } | null;
  media: Array<{ fileId: string; url: string | null; kind: string; caption: string | null; credit: string }>;
  relations: { matchId: string | null; stageId: string | null; disciplineId: string | null; teamIds: string[]; principalIds: string[]; participationIds: string[] };
  source: 'official' | 'reporter' | 'automatic'; authorId: string; occurredAt: string; publishedAt: string | null; state: string; pinned: boolean; highlighted: boolean;
  category: string; tags: string[]; seo: { title: string | null; description: string | null; canonical: string | null; shareImageFileId: string | null };
  result: { matchId: string; final: boolean; version: number } | null; spoiler: boolean;
  edited: { at: string; reason: string | null } | null; withdrawal: { reason: string; at: string } | null; correction: { notice: string; ref: string; at: string } | null; version: number;
  author?: { id: string; nickname: string } | null;
}
export interface ProjectedMatch {
  id: string; stageId: string; disciplineId: string; slot: { key: string; bracket: string; round: number; order: number; group: string | null } | null;
  sides: Array<{ participationId: string | null; displayName: string; teamId: string | null }>;
  state: 'scheduled' | 'live' | 'provisional' | 'final' | 'cancelled' | 'waiting'; scheduledAt: string | null; startedAt: string | null;
  outcome: { kind: string; winnerSide?: number; scores?: [number, number] | null; maps?: [number, number] | null } | null; provisional: boolean; finalAt: string | null;
}
export interface LiveView { kind: 'latest' | 'synced'; streamId?: string | null; delaySeconds: number; channel: string; label: string }
export interface PublicStream { id: string; label: string; language: string; role: string; status: string; delaySeconds: number; nextProgramme: { title: string; at: string } | null; provider: { name: string; mode: string; status: string; configured: boolean }; playbackUrl: string | null }
export interface LiveSnapshot {
  view: LiveView; cursor: number; serverTime: string;
  event: { id: string; name: string; state: string; startsAt: string | null; endsAt: string | null; visibility: string };
  mode: 'live' | 'archive';
  filters: { disciplines: Array<{ id: string; name: string }>; stages: Array<{ id: string; name: string; disciplineId: string }>; days: string[]; teams: Array<{ id: string; name: string }> };
  pinned: PublicPost[]; now: ProjectedMatch[]; next: ProjectedMatch[]; results: ProjectedMatch[];
  timeline: { items: PublicPost[]; before: string | null };
  streams: PublicStream[];
  archive: { closedAt: string; standings: Array<{ stageId: string; resultVersion: number; rows: Array<{ id: string; rank: number }> }>; honors: number } | null;
  finalReport: PublicPost | null;
}
export interface LiveFilters { disciplineId?: string; stageId?: string; day?: string; teamId?: string; matchId?: string }
export interface Notification { id: string; category: string; title: string; body: string; link: string | null; essential: boolean; count: number; deliverAt: string; readAt: string | null; ackRequired: boolean; ackAt: string | null; channels: Array<{ channel: string; status: string; attempts: number; deliveredAt: string | null; reason: string | null }> }
export interface NotificationPrefs { channels: { inApp: boolean; sms: boolean; email: boolean; push: boolean }; quietHours: { from: string; to: string } | null; promotional: boolean; digestFrequent: boolean; categories: Record<string, boolean> }

/** The latest-result view has separate endpoints; a synced page never calls them. */
const livePath = (eventId: string, latest: boolean) => `/live/events/${enc(eventId)}${latest ? '/latest' : ''}`;

export const esp06 = {
  live: (eventId: string, o: { latest: boolean; streamId?: string | undefined; t?: string | undefined; filters?: LiveFilters }) =>
    request<LiveSnapshot>('GET', livePath(eventId, o.latest), { query: { ...(o.filters ?? {}), t: o.t, view: !o.latest && o.streamId ? `stream:${o.streamId}` : undefined } }),
  tab: <T = Obj>(eventId: string, tab: string, o: { latest: boolean; streamId?: string | undefined; t?: string | undefined; filters?: LiveFilters; before?: string | undefined }) =>
    request<T>('GET', `${livePath(eventId, o.latest)}/tabs/${enc(tab)}`, { query: { ...(o.filters ?? {}), t: o.t, before: o.before, view: !o.latest && o.streamId ? `stream:${o.streamId}` : undefined } }),
  // news
  news: (q: { eventId?: string; category?: string; format?: string; q?: string; teamId?: string; authorId?: string; before?: string; limit?: number }) => request<{ items: PublicPost[] }>('GET', '/news', { query: q }),
  article: (slug: string) => request<PublicPost>('GET', `/news/${enc(slug)}`),
  meta: (slug: string) => request<{ title: string; description: string; canonical: string; image: string; jsonLd: string }>('GET', `/news/${enc(slug)}/meta`),
  cardUrl: (slug: string) => `${API_BASE}/news/${enc(slug)}/card.svg`,
  createPost: (b: Obj) => request<{ post: Obj & { _id: string; version: number; slug: string }; warnings: string[] }>('POST', '/news', { body: b }),
  editPost: (id: string, b: { title?: string; body?: string; reason: string; expectedVersion: number }) => request<Obj>('PATCH', `/news/${enc(id)}`, { body: b }),
  postMedia: (id: string, b: Obj) => request<Obj>('POST', `/news/${enc(id)}/media`, { body: b }),
  postNote: (id: string, text: string) => request<Obj>('POST', `/news/${enc(id)}/notes`, { body: { text } }),
  postStep: (id: string, step: 'submit' | 'publish', expectedVersion: number) => request<Obj>('POST', `/news/${enc(id)}/${step}`, { body: { expectedVersion } }),
  returnPost: (id: string, note: string, expectedVersion: number) => request<Obj>('POST', `/news/${enc(id)}/return`, { body: { note, expectedVersion } }),
  schedulePost: (id: string, publishAt: string, expectedVersion: number) => request<Obj>('POST', `/news/${enc(id)}/schedule`, { body: { publishAt, expectedVersion } }),
  withdrawPost: (id: string, reason: string, expectedVersion: number) => request<Obj>('POST', `/news/${enc(id)}/withdraw`, { body: { reason, expectedVersion } }),
  flagPost: (id: string, b: { pinned?: boolean; highlighted?: boolean }) => request<Obj>('POST', `/news/${enc(id)}/flags`, { body: b }),
  queue: (eventId: string) => request<{ items: Array<Obj & { _id: string; title: string; state: string; version: number; kind: string; spoiler: boolean; source: string; visibility: Array<{ view: string; label?: string; at: string | null }>; internalNotes: Array<{ by: string; at: string; text: string }>; reviewNote: string | null }> }>('GET', `/newsroom/events/${enc(eventId)}/queue`),
  templates: (matchId: string) => request<{ match: Obj; logos: string[]; templates: Array<{ key: string; title: string; body: string }> }>('GET', `/newsroom/matches/${enc(matchId)}/templates`),
  assignments: (eventId: string) => request<{ items: Array<Obj & { _id: string; principalId: string; role: string; state: string; note: string | null }> }>('GET', `/newsroom/events/${enc(eventId)}/assignments`),
  assign: (eventId: string, b: Obj) => request<Obj>('POST', `/newsroom/events/${enc(eventId)}/assignments`, { body: b }),
  handover: (id: string, to: string, note: string) => request<Obj>('POST', `/newsroom/assignments/${enc(id)}/handover`, { body: { to, note } }),
  finalReport: (eventId: string) => request<Obj & { _id: string }>('POST', `/newsroom/events/${enc(eventId)}/final-report`),
  // audience
  reactions: (postId: string) => request<Record<string, number>>('GET', `/news/${enc(postId)}/reactions`),
  react: (postId: string, emoji: string | null) => request<Record<string, number>>('POST', `/news/${enc(postId)}/reactions`, { body: { emoji } }),
  comments: (postId: string) => request<{ items: Array<{ _id: string; nickname: string | null; text: string; removed: boolean; createdAt: string }> }>('GET', `/news/${enc(postId)}/comments`),
  comment: (postId: string, text: string) => request<Obj>('POST', `/news/${enc(postId)}/comments`, { body: { text } }),
  spectatorChat: (eventId: string) => request<{ items: Array<{ _id: string; nickname: string | null; text: string; removed: boolean; createdAt: string }> }>('GET', `/events/${enc(eventId)}/spectator-chat`),
  spectatorSend: (eventId: string, text: string) => request<Obj>('POST', `/events/${enc(eventId)}/spectator-chat`, { body: { text } }),
  rooms: () => request<{ items: Array<{ id: string; kind: string; title: string }> }>('GET', '/chat/rooms'),
  openDm: (principalId: string) => request<{ _id: string }>('POST', '/chat/dm', { body: { principalId } }),
  roomMessages: (roomId: string) => request<{ items: Array<{ _id: string; principalId: string; nickname: string | null; text: string; removed: boolean; blocked: boolean; createdAt: string }> }>('GET', `/chat/rooms/${enc(roomId)}/messages`),
  sendRoom: (roomId: string, text: string) => request<Obj>('POST', `/chat/rooms/${enc(roomId)}/messages`, { body: { text } }),
  report: (targetType: string, targetId: string, reason: string) => request<{ id: string; state: string }>('POST', '/reports', { body: { targetType, targetId, reason } }),
  moderation: (eventId?: string) => request<{ items: Array<Obj & { _id: string; targetType: string; reason: string; content: string | null }> }>('GET', '/moderation/queue', { query: { eventId } }),
  moderate: (id: string, action: 'hide' | 'dismiss', note: string) => request<Obj>('POST', `/moderation/reports/${enc(id)}/decision`, { body: { action, note } }),
  // broadcast
  streams: (eventId: string) => request<{ items: Array<Obj & { _id: string; label: string; status: string; delaySeconds: number; role: string; version: number; language: string }> }>('GET', `/broadcast/events/${enc(eventId)}/streams`),
  addStream: (eventId: string, b: Obj) => request<Obj>('POST', `/broadcast/events/${enc(eventId)}/streams`, { body: b }),
  updateStream: (id: string, b: Obj) => request<Obj>('PATCH', `/broadcast/streams/${enc(id)}`, { body: b }),
  crew: (eventId: string) => request<{ items: Array<Obj & { _id: string; principalId: string; role: string; matchId: string | null }> }>('GET', `/broadcast/events/${enc(eventId)}/crew`),
  addCrew: (eventId: string, b: Obj) => request<Obj>('POST', `/broadcast/events/${enc(eventId)}/crew`, { body: b }),
  endCrew: (id: string) => request<Obj>('DELETE', `/broadcast/crew/${enc(id)}`),
  addMedia: (eventId: string, b: Obj) => request<Obj>('POST', `/broadcast/events/${enc(eventId)}/media`, { body: b }),
  overlays: (eventId: string) => request<{ items: Array<Obj & { _id: string; label: string; mode: string; widgets: string[]; expiresAt: string; revokedAt: string | null }> }>('GET', `/broadcast/events/${enc(eventId)}/overlays`),
  createOverlay: (eventId: string, b: Obj) => request<{ token: string; overlay: Obj & { _id: string } }>('POST', `/broadcast/events/${enc(eventId)}/overlays`, { body: b }),
  revokeOverlay: (id: string) => request<Obj>('DELETE', `/broadcast/overlays/${enc(id)}`),
  overlay: (token: string) => request<Obj>('GET', `/overlay/${enc(token)}`),
  // notifications
  notifications: (q: { before?: string; unread?: boolean } = {}) => request<{ items: Notification[]; unread: number }>('GET', '/me/notifications', { query: { before: q.before, unread: q.unread ? 'true' : undefined } }),
  markRead: (ids: string[] | 'all') => request<{ updated: number }>('POST', '/me/notifications/read', { body: { ids } }),
  ack: (id: string) => request<Obj>('POST', `/me/notifications/${enc(id)}/ack`),
  prefs: () => request<NotificationPrefs>('GET', '/me/notification-prefs'),
  savePrefs: (b: Obj) => request<NotificationPrefs>('PATCH', '/me/notification-prefs', { body: b }),
  unsubscribe: (token: string) => request<Obj>('POST', '/notifications/unsubscribe', { body: { token } }),
  sendOfficial: (eventId: string, b: Obj) => request<Obj & { _id: string; recipients: number }>('POST', `/events/${enc(eventId)}/official-messages`, { body: b }),
  officialList: (eventId: string) => request<{ items: Array<Obj & { _id: string; title: string; audience: string; recipients: number; createdAt: string }> }>('GET', `/events/${enc(eventId)}/official-messages`),
  officialReport: (id: string) => request<{ totals: Record<string, number> }>('GET', `/official-messages/${enc(id)}/report`),
  // discovery
  search: (q: { q: string; type?: string; gameId?: string; city?: string; limit?: number }) => request<{ q: string; results: Record<string, Array<Obj>> }>('GET', '/search', { query: q }),
  home: () => request<{ personal: boolean; games: string[]; events: Array<Obj & { id: string; name: string; state: string; startsAt: string | null; inMyCity?: boolean; followed?: boolean }>; news: PublicPost[]; calendar: Array<Obj & { matchId: string; scheduledAt: string; sides: string[] }>; following: Array<{ type: string; id: string }> }>('GET', '/home'),
};
