import type { PublicPost } from './api/esp06';

/**
 * LIVE-005/006 client side of the live timeline. Pure and deterministic so it is unit-tested:
 * - events are applied once per seq (duplicates after reconnect are ignored);
 * - a post is replaced only by a newer version (late or reordered deliveries never roll it back);
 * - while the reader is away from the top, new posts wait in `pending` (the list does not move); `reveal()` shows them;
 * - posts stay ordered by occurrence time (a late-arriving older occurrence goes to its place, not the top).
 */
export interface FeedState {
  posts: PublicPost[];
  pending: PublicPost[];
  seen: Set<number>;
  cursor: number;
}
export function createFeed(posts: PublicPost[], cursor: number): FeedState {
  return { posts: sortPosts(posts), pending: [], seen: new Set(), cursor };
}
const order = (a: PublicPost, b: PublicPost) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id);
export function sortPosts(ps: PublicPost[]): PublicPost[] {
  return [...ps].sort(order);
}

export interface FeedEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}
/** Returns the new state and whether matches/streams should be refreshed. */
export function applyEvents(s: FeedState, events: FeedEvent[], atTop: boolean): { state: FeedState; refreshMatches: boolean } {
  const seen = new Set(s.seen);
  let posts = s.posts;
  let pending = s.pending;
  let cursor = s.cursor;
  let refreshMatches = false;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    cursor = Math.max(cursor, e.seq);
    if (seen.has(e.seq)) continue;
    seen.add(e.seq);
    if (e.type === 'matches.changed' || e.type === 'streams.changed') {
      refreshMatches = true;
      continue;
    }
    if (e.type !== 'post.upsert') continue;
    const p = e.payload['post'] as PublicPost | undefined;
    if (!p) continue;
    const known = posts.find((x) => x.id === p.id);
    if (known) {
      if (p.version > known.version) posts = posts.map((x) => (x.id === p.id ? p : x)); // in-place: edits never move the reader
      continue;
    }
    const waiting = pending.find((x) => x.id === p.id);
    if (waiting) {
      if (p.version > waiting.version) pending = pending.map((x) => (x.id === p.id ? p : x));
      continue;
    }
    if (atTop) posts = sortPosts([p, ...posts]);
    else pending = [...pending, p];
  }
  return { state: { posts, pending, seen, cursor }, refreshMatches };
}
export function reveal(s: FeedState): FeedState {
  return { ...s, posts: sortPosts([...s.pending.filter((p) => !s.posts.some((x) => x.id === p.id)), ...s.posts]), pending: [] };
}
/** Older page appended at the bottom (deduplicated). */
export function appendOlder(s: FeedState, older: PublicPost[]): FeedState {
  return { ...s, posts: sortPosts([...s.posts, ...older.filter((p) => !s.posts.some((x) => x.id === p.id))]) };
}
