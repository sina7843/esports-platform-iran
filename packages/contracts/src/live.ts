import { z } from 'zod';
import { UtcInstantSchema } from './time.js';

/** ESP-06 request contracts: live centre, news/newsroom, broadcast/overlays, community, notifications, search. */
const Id = z.string().min(1).max(64);
const Reason = z.string().min(5).max(500);

export const LiveQuerySchema = z.object({
  view: z.string().max(80).optional(), // 'latest' only on the explicit latest endpoint; 'stream:<id>' for a synced view
  t: z.string().max(64).optional(),
  disciplineId: Id.optional(),
  stageId: Id.optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  teamId: Id.optional(),
  matchId: Id.optional(),
  before: z.string().max(120).optional(),
});
export const LiveTabs = ['timeline', 'schedule', 'results', 'bracket', 'stats', 'gallery', 'video'] as const;

export const PostKinds = ['text', 'image', 'video', 'quote', 'link', 'result', 'notice', 'decision'] as const;
export const PostFormats = ['live', 'article', 'report', 'interview', 'gallery'] as const;
export const PostCreateSchema = z.object({
  eventId: Id.nullable().default(null),
  kind: z.enum(PostKinds),
  format: z.enum(PostFormats).default('live'),
  title: z.string().max(200).default(''),
  body: z.string().max(20_000).default(''),
  quote: z.object({ text: z.string().min(1).max(1000), speaker: z.string().min(1).max(120) }).nullable().optional(),
  link: z.object({ url: z.string().url().max(500), label: z.string().max(200) }).nullable().optional(),
  relations: z.object({ matchId: Id.nullable().optional(), stageId: Id.nullable().optional(), disciplineId: Id.nullable().optional(), teamIds: z.array(Id).max(10).optional(), principalIds: z.array(Id).max(20).optional(), participationIds: z.array(Id).max(20).optional() }).optional(),
  occurredAt: UtcInstantSchema.nullable().optional(),
  official: z.boolean().optional(),
  spoiler: z.boolean().optional(),
  category: z.string().max(40).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  seo: z.object({ title: z.string().max(70).nullable().optional(), description: z.string().max(170).nullable().optional(), canonical: z.string().url().max(500).nullable().optional() }).optional(),
});
export const PostEditSchema = z.object({ title: z.string().max(200).optional(), body: z.string().max(20_000).optional(), reason: z.string().max(500).default(''), expectedVersion: z.number().int().min(0) });
export const PostVersionSchema = z.object({ expectedVersion: z.number().int().min(0) });
export const PostScheduleSchema = z.object({ publishAt: UtcInstantSchema, expectedVersion: z.number().int().min(0) });
export const PostWithdrawSchema = z.object({ reason: Reason, expectedVersion: z.number().int().min(0) });
export const PostReturnSchema = z.object({ note: z.string().min(3).max(1000), expectedVersion: z.number().int().min(0) });
export const PostFlagSchema = z.object({ pinned: z.boolean().optional(), highlighted: z.boolean().optional() });
export const PostNoteSchema = z.object({ text: z.string().min(1).max(2000) });
export const PostMediaSchema = z.object({
  fileId: Id,
  caption: z.string().max(300).nullable().default(null),
  credit: z.string().min(2).max(120),
  rights: z.enum(['owned', 'licensed', 'press', 'creative_commons', 'participant_submitted']),
  consent: z.object({ required: z.boolean(), obtained: z.boolean(), note: z.string().max(300).nullable().default(null) }),
});
export const NewsListQuerySchema = z.object({ eventId: Id.optional(), category: z.string().max(40).optional(), format: z.enum(PostFormats).optional(), authorId: Id.optional(), teamId: Id.optional(), q: z.string().max(100).optional(), before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const AssignmentSchema = z.object({ matchId: Id.nullable().default(null), principalId: Id, role: z.enum(['reporter', 'photographer', 'editor']), from: UtcInstantSchema, to: UtcInstantSchema.nullable().default(null), note: z.string().max(1000).nullable().default(null) });
export const HandoverSchema = z.object({ to: Id, note: z.string().min(5).max(2000) });

export const StreamSchema = z.object({
  disciplineId: Id.nullable().default(null), stageId: Id.nullable().default(null), language: z.string().min(2).max(10).default('fa'), label: z.string().min(1).max(80), streamKey: z.string().min(1).max(200),
  role: z.enum(['primary', 'fallback']), delaySeconds: z.number().int().min(0).max(3600), nextProgramme: z.object({ title: z.string().max(120), at: UtcInstantSchema }).nullable().default(null),
});
export const StreamUpdateSchema = z.object({ status: z.enum(['scheduled', 'live', 'offline', 'ended']).optional(), nextProgramme: z.object({ title: z.string().max(120), at: UtcInstantSchema }).nullable().optional(), delaySeconds: z.number().int().min(0).max(3600).optional(), label: z.string().max(80).optional(), expectedVersion: z.number().int().min(0) });
export const CrewSchema = z.object({ principalId: Id, role: z.enum(['commentator', 'analyst', 'observer', 'producer']), matchId: Id.nullable().default(null), streamId: Id.nullable().default(null) });
export const MediaItemSchema = z.object({ kind: z.enum(['vod', 'highlight', 'interview']), title: z.string().min(2).max(200), url: z.string().url().max(500).nullable().default(null), fileId: Id.nullable().default(null), matchId: Id.nullable().default(null), streamId: Id.nullable().default(null), offsetSeconds: z.number().int().min(0).nullable().default(null), occurredAt: UtcInstantSchema.nullable().default(null), spoiler: z.boolean().default(true) });
export const OverlaySchema = z.object({ streamId: Id.nullable().default(null), mode: z.enum(['synced', 'latest']), widgets: z.array(z.enum(['scoreboard', 'lineup', 'bracket', 'veto', 'sponsor', 'logo'])).min(1).max(6), matchId: Id.nullable().default(null), label: z.string().min(1).max(80), hours: z.number().int().min(1).max(168) });

export const ReactSchema = z.object({ emoji: z.string().max(8).nullable() });
export const CommentSchema = z.object({ text: z.string().min(1).max(1000) });
export const ChatSendSchema = z.object({ text: z.string().min(1).max(1000) });
export const PageBeforeSchema = z.object({ before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const ReportSchema = z.object({ targetType: z.enum(['comment', 'chat', 'match_message', 'post']), targetId: Id, reason: z.string().min(3).max(500) });
export const ModerationDecisionSchema = z.object({ action: z.enum(['hide', 'dismiss']), note: z.string().max(500).default('') });

export const NotificationPrefsUpdateSchema = z.object({
  channels: z.object({ sms: z.boolean(), email: z.boolean(), push: z.boolean() }).partial().optional(),
  quietHours: z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(),
  promotional: z.boolean().optional(),
  digestFrequent: z.boolean().optional(),
  categories: z.record(z.string(), z.boolean()).optional(),
});
export const MarkReadSchema = z.object({ ids: z.union([z.array(Id).max(200), z.literal('all')]) });
export const OfficialMessageSchema = z.object({ audience: z.enum(['participants', 'captains', 'staff']), title: z.string().min(3).max(200), body: z.string().min(5).max(4000), requiresAck: z.boolean().default(false) });
export const SearchQuerySchema = z.object({ q: z.string().max(80).default(''), type: z.enum(['players', 'teams', 'events', 'news', 'organizers', 'ads']).optional(), gameId: Id.optional(), city: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(50).default(10) });
