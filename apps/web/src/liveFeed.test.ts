import { describe, expect, it } from 'vitest';
import type { PublicPost } from './api/esp06';
import { appendOlder, applyEvents, createFeed, reveal } from './liveFeed';

const post = (id: string, occurredAt: string, version = 1, title = id): PublicPost => ({
  id, slug: id, eventId: 'e', kind: 'text', format: 'live', title, body: '', quote: null, link: null, media: [], relations: { matchId: null, stageId: null, disciplineId: null, teamIds: [], principalIds: [], participationIds: [] },
  source: 'reporter', authorId: 'a', occurredAt, publishedAt: occurredAt, state: 'published', pinned: false, highlighted: false, category: 'live', tags: [], seo: { title: null, description: null, canonical: null, shareImageFileId: null },
  result: null, spoiler: false, edited: null, withdrawal: null, correction: null, version,
});
const ev = (seq: number, p: PublicPost) => ({ seq, type: 'post.upsert', payload: { post: p } });

describe('live feed reducer (LIVE-005/006, AC-15)', () => {
  it('a reader away from the top is not moved; new posts wait and are counted, then revealed in order', () => {
    const s0 = createFeed([post('a', '2026-10-20T10:00:00Z')], 10);
    const { state } = applyEvents(s0, [ev(11, post('b', '2026-10-20T10:05:00Z'))], false);
    expect(state.posts.map((p) => p.id)).toEqual(['a']);
    expect(state.pending).toHaveLength(1);
    expect(reveal(state).posts.map((p) => p.id)).toEqual(['b', 'a']);
  });
  it('duplicate seqs (reconnect catch-up) apply once; older versions never roll a post back', () => {
    let s = createFeed([], 0);
    s = applyEvents(s, [ev(1, post('a', '2026-10-20T10:00:00Z', 1)), ev(2, post('a', '2026-10-20T10:00:00Z', 2, 'edited'))], true).state;
    s = applyEvents(s, [ev(1, post('a', '2026-10-20T10:00:00Z', 1)), ev(2, post('a', '2026-10-20T10:00:00Z', 2, 'edited'))], true).state;
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0]!.title).toBe('edited');
    // a reordered, late delivery of version 1 does not undo version 2
    s = applyEvents(s, [ev(3, post('a', '2026-10-20T10:00:00Z', 1, 'stale'))], true).state;
    expect(s.posts[0]!.title).toBe('edited');
    expect(s.cursor).toBe(3);
  });
  it('out-of-order arrival keeps occurrence order; an older page appends without duplicates; match hints request a refresh', () => {
    let s = createFeed([post('c', '2026-10-20T12:00:00Z')], 0);
    const r = applyEvents(s, [ev(5, post('late', '2026-10-20T09:00:00Z')), { seq: 4, type: 'matches.changed', payload: { matchIds: ['m'] } }], true);
    s = r.state;
    expect(r.refreshMatches).toBe(true);
    expect(s.posts.map((p) => p.id)).toEqual(['c', 'late']);
    s = appendOlder(s, [post('late', '2026-10-20T09:00:00Z'), post('old', '2026-10-20T08:00:00Z')]);
    expect(s.posts.map((p) => p.id)).toEqual(['c', 'late', 'old']);
  });
});
