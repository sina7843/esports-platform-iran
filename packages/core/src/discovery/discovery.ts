import type { Container } from '../container.js';
import type { EventDoc } from '../db/collections.js';
import { NewsService, escapeRx, normalizeFa } from '../news/news.js';
import { ProfileService } from '../profiles/profiles.js';
import { ScheduleService } from '../competition/schedule.js';

const iso = () => new Date().toISOString();
const PUBLIC_EVENT_STATES = ['published', 'registration_open', 'registration_closed', 'preparing', 'active', 'paused', 'finished', 'closed', 'archived'];
export const SEARCH_TYPES = ['players', 'teams', 'events', 'news', 'organizers', 'ads'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/**
 * UX-001: unified and specialised search. There is no separate copy of the data: every query runs against the
 * source collections with the same public filters as each public page (profile privacy, blocks, event
 * visibility, published news with the anti-spoiler view, verified organizers, open ads). Removing or hiding
 * private information therefore takes effect immediately. Persian/Arabic letter and digit forms are normalised.
 */
export class SearchService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  async search(q: { q: string; type?: SearchType | undefined; gameId?: string | undefined; city?: string | undefined; limit: number }, viewer: string | null) {
    const text = normalizeFa(q.q).slice(0, 80);
    const rx = text ? new RegExp(escapeRx(text), 'i') : null;
    const per = q.type ? Math.min(q.limit, 50) : 5;
    const want = (t: SearchType) => !q.type || q.type === t;
    const out: Partial<Record<SearchType, unknown[]>> = {};
    if (want('players')) out.players = (await new ProfileService(this.ct).search({ q: text.toLowerCase() || undefined, gameId: q.gameId, city: q.city, limit: per }, viewer)).items;
    if (want('teams')) {
      const f: Record<string, unknown> = {};
      if (rx) f['$or'] = [{ name: rx }, { tag: rx }];
      if (q.gameId) f['gameId'] = q.gameId;
      if (q.city) f['city'] = q.city;
      out.teams = (await this.c.teams.find(f, { projection: { name: 1, tag: 1, gameId: 1, city: 1 } }).limit(per).toArray()).map((t) => ({ id: t._id, name: t.name, tag: t.tag, gameId: t.gameId, city: t.city }));
    }
    if (want('events')) {
      const f: Record<string, unknown> = { visibility: 'public', state: { $in: PUBLIC_EVENT_STATES } };
      if (rx) f['name'] = rx;
      if (q.city) f['config.regions'] = q.city;
      if (q.gameId) f['_id'] = { $in: (await this.c.disciplines.find({ gameId: q.gameId }, { projection: { eventId: 1 } }).toArray()).map((d) => d.eventId) };
      out.events = (await this.c.events.find(f, { projection: { name: 1, slug: 1, state: 1, startsAt: 1, config: 1 } }).sort({ startsAt: -1 }).limit(per).toArray()).map((e) => ({ id: e._id, name: e.name, state: e.state, startsAt: e.startsAt, regions: e.config.regions, presence: e.config.presence }));
    }
    if (want('news')) out.news = text ? await new NewsService(this.ct).list({ q: text, limit: per }) : [];
    if (want('organizers')) {
      const verified = (await this.c.organizerProfiles.find({ 'verified.state': 'verified' }, { projection: { level: 1 } }).toArray()).map((p) => p._id);
      out.organizers = (await this.c.organizations.find({ _id: { $in: verified }, ...(rx ? { name: rx } : {}), ...(q.city ? { city: q.city } : {}) }, { projection: { name: 1, slug: 1, city: 1 } }).limit(per).toArray()).map((o) => ({ id: o._id, slug: o.slug, name: o.name, city: o.city }));
    }
    if (want('ads')) {
      const f: Record<string, unknown> = { state: 'open' };
      if (rx) f['$or'] = [{ description: rx }, { role: rx }];
      if (q.gameId) f['gameId'] = q.gameId;
      if (q.city) f['city'] = q.city;
      out.ads = (await this.c.recruitmentAds.find(f, { projection: { teamId: 1, kind: 1, gameId: 1, role: 1, city: 1, description: 1 } }).limit(per).toArray()).map((a) => ({ id: a._id, teamId: a.teamId, kind: a.kind, gameId: a.gameId, role: a.role, city: a.city, description: a.description.slice(0, 200) }));
    }
    return { q: text, results: out };
  }
}

/**
 * UX-002: personal home. Games come from the profile and game follows; city from the profile; upcoming events are
 * public ones of those games (and city, when known); the calendar shows the person's own matches; news comes from
 * followed events and teams. An anonymous visitor gets the public overview.
 */
export class HomeService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async home(viewer: string | null) {
    const upcomingFilter = { visibility: 'public' as const, state: { $in: ['published', 'registration_open', 'registration_closed', 'preparing', 'active', 'paused'] as EventDoc['state'][] } };
    const news = new NewsService(this.ct);
    if (!viewer) {
      return {
        personal: false,
        events: (await this.c.events.find(upcomingFilter, { projection: { name: 1, state: 1, startsAt: 1, config: 1 } }).sort({ startsAt: 1 }).limit(8).toArray()).map((e) => ({ id: e._id, name: e.name, state: e.state, startsAt: e.startsAt, regions: e.config.regions })),
        news: await news.list({ limit: 8 }),
        calendar: [],
        following: [],
        games: [],
      };
    }
    const prof = await this.c.profiles.findOne({ _id: viewer }, { projection: { games: 1, city: 1 } });
    const follows = await this.c.follows.find({ followerId: viewer }).toArray();
    const games = [...new Set([...(prof?.games ?? []).map((g) => g.gameId), ...follows.filter((f) => f.targetType === 'game').map((f) => f.targetId)])];
    const gameEvents = games.length ? (await this.c.disciplines.find({ gameId: { $in: games } }, { projection: { eventId: 1 } }).toArray()).map((d) => d.eventId) : [];
    const followedEvents = follows.filter((f) => f.targetType === 'event').map((f) => f.targetId);
    const evs = await this.c.events.find({ ...upcomingFilter, _id: { $in: [...new Set([...gameEvents, ...followedEvents])] } }, { projection: { name: 1, state: 1, startsAt: 1, config: 1 } }).sort({ startsAt: 1 }).limit(30).toArray();
    // events in the person's city first, then the rest
    const city = prof?.city ?? null;
    evs.sort((a, b) => Number(!!city && b.config.regions.includes(city)) - Number(!!city && a.config.regions.includes(city)));
    const teamIds = follows.filter((f) => f.targetType === 'team').map((f) => f.targetId);
    const items = [];
    for (const eventId of followedEvents.slice(0, 10)) items.push(...(await news.list({ eventId, limit: 3 })));
    for (const teamId of teamIds.slice(0, 10)) items.push(...(await news.list({ teamId, limit: 3 })));
    const seen = new Set<string>();
    const feed = items.filter((p) => !seen.has(p.id) && seen.add(p.id)).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 12);
    return {
      personal: true,
      games,
      events: evs.slice(0, 12).map((e) => ({ id: e._id, name: e.name, state: e.state, startsAt: e.startsAt, regions: e.config.regions, inMyCity: !!city && e.config.regions.includes(city), followed: followedEvents.includes(e._id) })),
      news: feed.length ? feed : await news.list({ limit: 8 }),
      calendar: (await new ScheduleService(this.ct).calendar(viewer)).filter((m) => m.scheduledAt >= iso()).slice(0, 8),
      following: follows.map((f) => ({ type: f.targetType, id: f.targetId })),
    };
  }
}

export { safeReturnPath } from '@esp/contracts';
