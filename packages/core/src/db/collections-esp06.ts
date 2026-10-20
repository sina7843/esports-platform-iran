import type { Collection, Db } from 'mongodb';
import type { NewsState } from '@esp/contracts';

/**
 * ESP-06 documents: news posts and newsroom, broadcast streams/crew/media archive, overlay tokens, audience
 * interactions (reactions, comments, chat rooms, reports), notifications and official group messages.
 */

export type PostKind = 'text' | 'image' | 'video' | 'quote' | 'link' | 'result' | 'notice' | 'decision';
export type PostFormat = 'live' | 'article' | 'report' | 'interview' | 'gallery';
export interface PostMedia {
  /** public display variant (metadata stripped); the original stays private to the uploader (EDIT-007) */
  fileId: string;
  url: string | null;
  originalFileId: string | null;
  kind: 'image' | 'video';
  caption: string | null;
  credit: string;
  rights: 'owned' | 'licensed' | 'press' | 'creative_commons' | 'participant_submitted';
  consent: { required: boolean; obtained: boolean; note: string | null };
}
export interface NewsPostDoc {
  _id: string;
  slug: string;
  eventId: string | null;
  kind: PostKind;
  format: PostFormat;
  title: string;
  body: string;
  quote: { text: string; speaker: string } | null;
  link: { url: string; label: string } | null;
  media: PostMedia[];
  relations: { matchId: string | null; stageId: string | null; disciplineId: string | null; teamIds: string[]; principalIds: string[]; participationIds: string[] };
  source: 'official' | 'reporter' | 'automatic';
  authorId: string;
  occurredAt: string;
  publishAt: string | null;
  publishedAt: string | null;
  state: NewsState;
  pinned: boolean;
  highlighted: boolean;
  category: string;
  tags: string[];
  seo: { title: string | null; description: string | null; canonical: string | null; shareImageFileId: string | null };
  /** NEWS-005: result data always comes from the engine; editors cannot change it */
  resultRef: { matchId: string; resultVersion: number; final: boolean } | null;
  /** reveals a result: subject to delayed views (CAST-005/006) */
  spoiler: boolean;
  dedupeKey: string | null;
  versions: Array<{ at: string; by: string; title: string; body: string; reason: string }>;
  editedAt: string | null;
  withdrawal: { reason: string; by: string; at: string } | null;
  correction: { notice: string; ref: string; at: string } | null;
  internalNotes: Array<{ by: string; at: string; text: string }>;
  assigneeId: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NewsAssignmentDoc {
  _id: string;
  eventId: string;
  matchId: string | null;
  principalId: string;
  role: 'reporter' | 'photographer' | 'editor';
  from: string;
  to: string | null;
  note: string | null;
  handover: { to: string; note: string; at: string } | null;
  state: 'active' | 'handed_over' | 'ended';
  grantId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface BroadcastStreamDoc {
  _id: string;
  eventId: string;
  disciplineId: string | null;
  stageId: string | null;
  language: string;
  label: string;
  provider: string;
  streamKey: string;
  role: 'primary' | 'fallback';
  status: 'scheduled' | 'live' | 'offline' | 'ended';
  /** CAST-005: delay applied server-side to every result-bearing item in this stream's synced view */
  delaySeconds: number;
  nextProgramme: { title: string; at: string } | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface MediaItemDoc {
  _id: string;
  eventId: string;
  matchId: string | null;
  streamId: string | null;
  kind: 'vod' | 'highlight' | 'interview';
  title: string;
  url: string | null;
  fileId: string | null;
  offsetSeconds: number | null;
  occurredAt: string;
  spoiler: boolean;
  createdBy: string;
  createdAt: string;
}
export interface CrewAssignmentDoc {
  _id: string;
  eventId: string;
  matchId: string | null;
  streamId: string | null;
  principalId: string;
  role: 'commentator' | 'analyst' | 'observer' | 'producer';
  grantId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
}
export interface OverlayTokenDoc {
  _id: string;
  eventId: string;
  streamId: string | null;
  mode: 'synced' | 'latest';
  widgets: Array<'scoreboard' | 'lineup' | 'bracket' | 'veto' | 'sponsor' | 'logo'>;
  matchId: string | null;
  label: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ReactionDoc {
  _id: string; // `${postId}:${principalId}`
  postId: string;
  principalId: string;
  emoji: string;
  at: string;
}
export interface Moderation {
  by: string;
  reason: string;
  at: string;
}
export interface CommentDoc {
  _id: string;
  postId: string;
  principalId: string;
  text: string;
  hidden: Moderation | null;
  createdAt: string;
}
export interface ChatRoomDoc {
  _id: string; // event_spectator: `ev:<eventId>`, team: `team:<teamId>`, dm: `dm:<a>:<b>` (sorted)
  kind: 'event_spectator' | 'team' | 'dm';
  eventId: string | null;
  teamId: string | null;
  members: string[];
  createdAt: string;
}
export interface ChatMessageDoc {
  _id: string;
  roomId: string;
  principalId: string;
  text: string;
  hidden: Moderation | null;
  createdAt: string;
}
export interface ContentReportDoc {
  _id: string;
  targetType: 'comment' | 'chat' | 'match_message' | 'post';
  targetId: string;
  scope: { eventId: string | null; teamId: string | null };
  reporterId: string;
  reason: string;
  state: 'open' | 'actioned' | 'dismissed';
  decidedBy: string | null;
  note: string | null;
  createdAt: string;
}

export type NotificationChannel = 'in_app' | 'sms' | 'email' | 'push';
export interface NotificationDoc {
  _id: string;
  principalId: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
  /** COM-003: essential notices ignore quiet hours and category opt-outs (never promotional) */
  essential: boolean;
  promotional: boolean;
  groupKey: string | null;
  count: number;
  dedupeKey: string | null;
  /** delayed audience notifications (CAST-007) and quiet hours both move this */
  deliverAt: string;
  createdAt: string;
  readAt: string | null;
  ackRequired: boolean;
  ackAt: string | null;
  officialMessageId: string | null;
  channels: Array<{ channel: NotificationChannel; status: 'pending' | 'sent' | 'failed' | 'skipped' | 'delivered'; attempts: number; nextAttemptAt: string | null; lastError: string | null; providerRef: string | null; sentAt: string | null; deliveredAt: string | null; reason: string | null }>;
}
export interface OfficialMessageDoc {
  _id: string;
  eventId: string;
  audience: 'participants' | 'captains' | 'staff';
  title: string;
  body: string;
  requiresAck: boolean;
  sentBy: string;
  recipients: number;
  createdAt: string;
}

export interface Esp06Collections {
  newsPosts: Collection<NewsPostDoc>;
  newsAssignments: Collection<NewsAssignmentDoc>;
  broadcastStreams: Collection<BroadcastStreamDoc>;
  mediaItems: Collection<MediaItemDoc>;
  crewAssignments: Collection<CrewAssignmentDoc>;
  overlayTokens: Collection<OverlayTokenDoc>;
  reactions: Collection<ReactionDoc>;
  comments: Collection<CommentDoc>;
  chatRooms: Collection<ChatRoomDoc>;
  chatMessages: Collection<ChatMessageDoc>;
  contentReports: Collection<ContentReportDoc>;
  notifications: Collection<NotificationDoc>;
  officialMessages: Collection<OfficialMessageDoc>;
}
export const esp06CollectionNames = {
  newsPosts: 'news_posts',
  newsAssignments: 'news_assignments',
  broadcastStreams: 'broadcast_streams',
  mediaItems: 'media_items',
  crewAssignments: 'crew_assignments',
  overlayTokens: 'overlay_tokens',
  reactions: 'post_reactions',
  comments: 'post_comments',
  chatRooms: 'chat_rooms',
  chatMessages: 'chat_messages',
  contentReports: 'content_reports',
  notifications: 'notifications',
  officialMessages: 'official_messages',
} as const;
export function esp06Collections(db: Db): Esp06Collections {
  const n = esp06CollectionNames;
  return {
    newsPosts: db.collection(n.newsPosts),
    newsAssignments: db.collection(n.newsAssignments),
    broadcastStreams: db.collection(n.broadcastStreams),
    mediaItems: db.collection(n.mediaItems),
    crewAssignments: db.collection(n.crewAssignments),
    overlayTokens: db.collection(n.overlayTokens),
    reactions: db.collection(n.reactions),
    comments: db.collection(n.comments),
    chatRooms: db.collection(n.chatRooms),
    chatMessages: db.collection(n.chatMessages),
    contentReports: db.collection(n.contentReports),
    notifications: db.collection(n.notifications),
    officialMessages: db.collection(n.officialMessages),
  };
}
