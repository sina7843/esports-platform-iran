# Live coverage, newsroom, broadcast and communication (ESP-06)

Code:
- `packages/core/src/live/*` (policy, live centre, broadcast, consumers)
- `packages/core/src/news/news.ts`
- `packages/core/src/notifications/notifications.ts`
- `packages/core/src/community/community.ts`
- `packages/core/src/discovery/discovery.ts`
- API: `apps/api/src/routes/live.ts`
- Web:
  - `LiveCenterView`, `NewsView`, `ArticleView`, `NewsroomView`, `BroadcastAdminView`, `OverlayView`, `NotificationsView`, `MessagesView`, `SearchView`, `HomeView`
  - `liveFeed.ts`

## 1. Publication policy (CAST-005/006/007, AC-16)

One server-side rule (`live/policy.ts`) covers every surface: live API, realtime channels, overlays, share images, article pages, news lists and search snippets, and audience notifications.

- **Views:**
  - The *latest* view shows data as soon as it is official.
  - A *synced* view follows a stream. Its cutoff is `now − stream.delaySeconds`.
  - The default synced view follows the primary stream with the longest delay, or zero delay when there is no stream.
- **Result-bearing items** (`spoiler = true`) appear in a synced view only when `occurredAt + delay ≤ now`. These are result and decision posts, automatic result/advance/elimination/champion posts, and spoiler-marked manual posts and video.
- **Match projection:**
  - an outcome is visible only if its official result version existed by the cutoff;
  - a side that advanced from a winner/loser slot is masked as «برنده W1-1» until that source result is visible;
  - started matches appear as "live" only once the start is inside the cutoff.
- **Endpoints:**
  - `/live/events/:id[/tabs/:tab]` serves the synced view, `Cache-Control: public, max-age=5`. Later responses only reveal more, so a cached copy is never early.
  - `/live/events/:id/latest[/tabs/:tab]` serves the latest view, `no-store`.
  - The synced endpoints reject `view=latest`. The web page only calls the endpoint family of the view the reader chose, so a delayed page never fetches or prefetches latest data.
- **Realtime:**
  - Each change is published on `live:<event>:latest` immediately.
  - It is published on `live:<event>:d<delay>` with `visibleAt = occurredAt + delay` for every distinct stream delay.
  - The realtime store filters by `visibleAt` on poll, SSE and WebSocket alike.
- **Audiences:**
  - Public events publish to the public audience.
  - Other visibilities publish to holders of `event.read_private` in the event. This is re-checked on every delivery, so a revoked grant stops delivery (AC-23).
- **Notifications:** audience notifications about a result (follow end) get `deliverAt = occurredAt + longest stream delay`. The match sides are notified immediately; they were there.
- **Confidential data never enters public projections, even after the delay:** lobby credentials, evidence, internal notes, reviewers, private originals.

## 2. Timeline, snapshot and resume (LIVE-004..006, AC-15)

- The snapshot reads the global realtime cursor **before** reading its data. A subscription from that cursor can therefore only repeat events, never skip one.
- The client (`liveFeed.ts`) applies events once per `seq`. A post is replaced only by a higher `version`, so late or reordered deliveries never roll it back. Posts are ordered by occurrence time.
- While the reader is away from the top, new posts wait in `pending` and are counted ("N new — show"). Edits update in place.
- Retention:
  - The prune job deletes events older than 7 days after raising `realtime_floor`. This replaces the silent TTL index (migration 0010).
  - A cursor below the floor gets `resync: true` (poll) or close code 4409 (WebSocket). The page then reloads the snapshot.
- Fallback polling backs off exponentially. Low-data mode polls every 10 s, loads no images until asked, and never autoplays.

## 3. Posts and newsroom (NEWS-001..008, EDIT-001..007, AC-14)

- **Post kinds:** text, image, video, quote, link, result, notice, decision.
- **Post formats:** live, article, report, interview, gallery.
- **Every post records:**
  - occurred and published times;
  - author and source (official, reporter, automatic);
  - relations (event, match, stage, discipline, teams, people, participations);
  - slug, SEO, category and tags.
- **Text is plain:** control characters are stripped, it is rendered as text nodes, and JSON-LD is pre-escaped.
- **Result posts:** the engine writes the title and result line ("نتیجه نهایی" or "نتیجه موقت (در انتظار تأیید)"). Reporters cannot edit it, and a provisional result cannot be titled final.
- **Workflow (newsMachine):**
  - draft → submit (`news.draft`) → publish/schedule (`news.publish`, editor only); a direct publish is the editor's right;
  - edits after publication require an editor and a public reason and keep version history;
  - withdrawal keeps a public tombstone with its reason;
  - pin and highlight.
- **Automatic posts:**
  - Each official outbox event creates its post exactly once. The unique `dedupeKey` per occurrence (`match.final:<id>`, `match.start:<id>`, advance/eliminate keys, `match.time:<id>:<time>`, `champion:…`, event finished/closed) is enforced by a unique partial index.
  - Re-finalisation after a correction does not add a second "end" post.
- **Correction:** every earlier result post of the match moves to `corrected` with a visible notice, and exactly one `correction:<id>` post is created.
- **Newsroom tools:**
  - schedule data beside the editor and quick templates with team logos;
  - duplicate warning (same match and kind within 15 minutes) and internal notes;
  - per-stream visibility preview;
  - assignments as scoped grants with expiry, and shift handover with a note and history;
  - final report draft from honors and highlighted posts. Publishing it still needs an editor; no external AI is involved.
- **Media (EDIT-007):**
  - the original is uploaded private (`media_original`);
  - the public display variant has its metadata stripped (JPEG APP1–APP13/APP15/COM; PNG tEXt/zTXt/iTXt/eXIf/tIME) and no re-encoding;
  - rights, credit and consent are recorded, and publication is blocked while required consent is missing;
  - evidence and identity files can never become public.
- **Sharing:** the share image is a local SVG that obeys the same view rule as the article.

## 4. Broadcast and overlays (CAST-001..008)

- **Streams:**
  - per discipline, stage and language, with primary/fallback role, status and next programme;
  - the delay is 0–3600 s; changing it is audited and pushes a refresh hint.
- **Playback:** comes only from the video adapter.
  - No Iranian or self-hosted provider is selected (INTG-001), so the development double reports `unknown`.
  - The page says "not configured" and never shows a fake player.
  - The player is `muted`, never autoplays, and uses `preload=none`.
- **Crew:** commentator, analyst, observer and producer appointments grant `broadcast_crew` in the event.
- **Archive:** VOD, highlights and interviews are tied to a match and a time, with spoiler timing.
- **Overlays (OBS browser source):**
  - The token is random, stored as SHA-256, expires (1–168 h), can be revoked and is shown once.
  - Each overlay has a mode, *synced to stream* or *latest result*, and the response says which.
  - Widgets: scoreboard, lineup (display names only), bracket, veto (actions up to the cutoff), sponsor (labelled) and logo.
  - Within the delay the synced overlay shows no current match at all.

## 5. Notifications (COM-001..004, COM-006)

- **Channels:** each notification has in-site plus per-channel status for SMS, email and push.
  - States: pending, sent, failed, skipped, delivered.
  - Attempts, last error and backoff are 1 min, 5 min, 30 min, 2 h, then failed.
  - Delivered is set only from a provider receipt.
  - Read and acknowledged are separate user acts.
- **Preferences:**
  - channels, quiet hours (Asia/Tehran), per-category opt-out;
  - promotional by opt-in only, with a random unsubscribe token;
  - aggregation of frequent items (`groupKey`, 30 min).
- **Essential notices** ignore quiet hours and opt-outs: check-in open, your result rulings, payments, registration decisions, official messages and corrections.
- **Push:** no domestic provider is selected, so push is recorded as `skipped` and never blocks the in-site notice.
- **Sources:**
  - registration (incl. incomplete documents, check-in no-show), payment, refund, team invitation;
  - match readiness/check-in open, start, time change, result;
  - case and sanction decisions, corrections, honors.
- **Followers** get start, end and time-change notices only in the categories they keep.
- **Official group messages:**
  - audiences: participants, captains or event staff;
  - optional acknowledgement;
  - a per-recipient report of read, acknowledged, SMS sent and delivered.

## 6. Community (AUD-001/002, COM-005)

- **Reactions:** one per person per post, from a fixed set. Sharing uses the Web Share API or copies the canonical link.
- **Comments and spectator chat:**
  - kept separate from the official timeline;
  - rate limited (5 comments or 10 chat messages per minute);
  - reportable once per person; moderators (`community.moderate`, event or site) hide with a reason;
  - the reporter cannot decide their own report.
- **Private threads:** follow the recipient's messaging policy and blocks.
- **Team room:**
  - current members only;
  - history starts at the reader's join date;
  - former members lose access (D-045).
- **Match chat** (ESP-04) is reportable as `match_message`.

## 7. Search, home and deep links (UX-001/002/007)

- **Search:**
  - queries the source collections with the same filters as the public pages: profile privacy and blocks, public events, published non-spoiler-visible news, verified organizers, open ads;
  - private changes therefore take effect immediately, with no stale index;
  - Arabic and Persian forms of ی/ک are normalised (D-046).
- **Home:**
  - signed in: games from the profile and game follows, events in the person's city first, own upcoming matches, news from followed events and teams;
  - anonymous: a public overview.
- **Deep links after login:** `safeReturnPath` (shared by API and web) allows only same-origin relative paths. It rejects schemes, `//`, `/\` and control characters.

## 8. Not provided by this stage

- **Real streaming provider, push provider, SMS and email providers:**
  - Only development doubles exist (INTG-001), and production refuses them.
  - Without a provider the streaming status is shown explicitly.
- **Image resizing for low-data variants:** the platform has no image library. Low-data mode instead withholds images until asked.
