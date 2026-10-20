# Results, refereeing, disputes, ranking and honors (ESP-05)

Code: `packages/core/src/competition/results.ts`, `packages/core/src/integrity/*`, `packages/core/src/ranking/*`, `packages/core/src/honors/*`, API `apps/api/src/routes/integrity.ts`.

## 1. Result lifecycle (RES-001..005, AC-09)

| Step | Who | Effect |
|---|---|---|
| Submit | side representative or official | `live/paused → provisional`; stores the outcome, game units (validated by the game module), evidence and provenance; starts the confirmation window from `result.confirm_minutes` |
| Matching second submission / confirm | the other side | final (system), `competition.match.finalized` |
| Conflicting submission / contest | either side | `provisional → disputed`, plus a case; every finalisation path is refused while the case is open |
| Auto-confirm (worker) | system | only when the rules say `result.auto_confirm = true` and the deadline passed, no open case and no integration mismatch. Without the clause, an official finalises. |
| Integration ingest | system | a source, never an authority: a disagreement sets `result.review = integration_mismatch` and blocks auto-confirm |
| Finalize | referee / case decision / system | one transaction: state transition (version check), official result version, game units, audit, outbox event. Concurrent calls lead to exactly one winner. |

Provisional results never advance brackets, standings, ratings or honors. The generic `/matches/:id/transitions` endpoint refuses `submit_result`, `dispute`, `finalize`, `reopen`, `forfeit` and `reset_sides`.

## 2. Officials and cases (REF-001..006, AC-10)

- Appointments create scoped ACL grants. They are refused for conflicted people: a match participant, a member of an involved team, or the owner of that team's organisation. They are also refused for a referee double-booked at an overlapping match, unless someone with `schedule.override` gives a reason.
- Case states: `filed → assigned → defense_received → under_review → first_decision → appeal → closed`.
  - Deadlines (`dispute.deadline_minutes`, `dispute.defense_minutes`, `dispute.appeal_minutes`) come from the match's frozen rules. Event-level cases use the event disciplines' rules. A missing clause means an official decides.
  - The assignee is chosen by the head referee (`match.result.correct`). They must hold `dispute.decide_first` and must not be a party or conflicted.
  - Every decision cites a frozen clause (`citeClause`) and stores a public summary, private reasoning and an effect: `none`, `result_change` (finalize, or a correction when already final) or `sanction`.
  - Appeal: the system picks an appointed `appeal_authority` who is not the first decider or assignee and not conflicted. If none exists, the appeal is refused. Only that authority may decide it.
  - Projections: parties see the claim, public summaries, their own requests and evidence. Officials see everything. Each party viewing of a decision is recorded (service of notice). Public decisions show summary, clause and effect only.

## 3. Sanctions and integrity (REF-004, INT-001..005)

- A sanction needs `dispute.decide_first` in the scope plus a frozen clause. A platform-wide sanction needs `discipline.platform_wide` and a consumed `discipline.platform_extend` approval.
- Effects go through the competition machinery:
  - forfeit → `recordForfeit`;
  - disqualification → `withdraw`;
  - point penalty → subtracted in table and lobby standings before ranking;
  - suspension → registration eligibility issue `suspended`.
- Sanction appeals are decided by someone other than the issuer.
- Integrity reports: reporter receipt only; triage → investigate → refer (to a case) → close. The reporter cannot handle their own report.

## 4. Corrections (RES-006..008, AC-11)

1. `preview` (read-only) lists:
   - changed slots and resettable or started dependents;
   - rank changes;
   - rating events, honors, prizes, quotas and news events.
2. `request` (needs `match.result.correct` + a consumed independent approval, or a case decision). If any dependent match has started, the correction becomes `blocked_dependency` and a case is opened. Nothing is rewritten.
3. Saga under a stage lease. Each step is idempotent and recorded:
   - `freeze` (reopen);
   - `reset_dependents` (`reset_sides`);
   - `result` (finalize with the new outcome);
   - `standings` (sync + new standing version);
   - `transfers` (drop stale undrawn stage entries);
   - `ratings` (start rebuilds);
   - `honors` (revoke unsupported, issue new with `correctionOf`);
   - `prizes` (unpaid → `disputed`; paid → compensation case, ledger untouched);
   - `notify` (`competition.result.corrected`, once).
4. A failure leaves `failed` + the error, and the lease is released. `resume` continues from the first missing step.
5. `reopen` moves a final match into a case (only before the event is closed).

## 5. Ranking (RANK-001..008)

- A rating system is versioned per game, mode, platform, subject and season: `draft → published → retired`.
  - Publishing starts a build.
  - The "official" label needs an approval with a reference, by someone other than the author (`ranking.approve`). Until then every leaderboard reads `internal_unapproved`.
- Glicko-2 follows Glickman (2013). One match is one rating period.
  - Opponent groups enter as composites (mean rating and RD).
  - A lobby is pairwise by placement.
  - The event weight scales the rating delta only.
  - Inactivity widens RD per empty period (capped at the initial RD).
  - Worked example (tested): 1500/200/0.06 vs 1400/30 (W), 1550/100 (L), 1700/300 (L), τ = 0.5 → **1464.06 / 151.52 / 0.05999**.
- Lobby points: placement table and kill points with a cited rules source. Validation: non-increasing whole numbers.
- Eligibility:
  - final results of events with `config.rated = true` (and the system's season);
  - forfeits, double forfeits and attempts formats are excluded;
  - region is the profile province/city at processing time.
- Builds:
  - a new build id replays matches in `(run.endedAt, _id)` order;
  - each match is one transaction (contributions + ratings + cursor), with the unique contribution index;
  - a crash resumes without double counting;
  - only a finished newest build becomes `activeBuild`, so a half build is never shown.
- Read models:
  - leaderboard (region and time-window filters, inactive listed last without rank);
  - records (peak, biggest gain, most games);
  - trend;
  - career (record, per-game totals, placements) and head-to-head from final results.

## 6. Honors, certificates, close (END-001..007, AWD-001..004, AC-12/13)

- `finish`: all stages finished and all matches final or cancelled.
- `close`: no open case and no open correction, plus a consumed `event.close` approval. After that, idempotent effects run:
  - honors from the last stage's final standing (`honors.medal_places`, default 3);
  - certificates (attendance for recorded presence, placement for eligible recipients);
  - rating rebuilds when the event is rated;
  - season quotas (unique counters);
  - prize entitlements bound to the final standing version;
  - the archive snapshot;
  - `competition.event.closed` once.
  A close that crashed after the state change is completed by calling close again.
- Presence condition: an individual honor goes only to roster members recorded present (`room.setLineup`, or readiness declaration) in at least `honors.presence_min_matches` matches (default 1). Others are listed `eligible: false` with the reason.
- Team honors store `teamId` and `nameAtTime`. Renames and roster moves never rewrite them.
- Honors and certificates carry 48-bit public codes (`/verify/:code`). The share card is a self-contained SVG with the code and no remote assets.
- Revocation needs `honor.revoke` and a reason. Correcting a certificate keeps the old one as `corrected → newId`.
- Special awards (MVP etc.): proposed with method and approver role, then approved by someone in that role other than the proposer.
- Declared achievements are reviewed by `account.review` (not self) and always shown apart from platform honors.
- Feedback: one per participant. The organizer/sponsor report contains recorded facts only.

## 7. Newsroom and notifications

Outbox events:

- `competition.match.finalized`
- `competition.participant.advanced` / `eliminated` (stable `dedupeKey` = match + result version)
- `competition.event.finished` / `closed`
- `competition.result.corrected`, `competition.result.correction_blocked`, `competition.match.reopened`
- `honors.issued` / `revoked`
- `integrity.dispute.*`, `integrity.sanction.issued`
- `ranking.rebuild.requested`

The `integrity-notifications` consumer pushes events carrying `principals` to those users' realtime channel. The ESP-06 notification center consumes the same stream.

## 8. Defaults and missing rules

The rules package decides every value. These are the platform defaults when a clause is absent:

| Clause | Default |
|---|---|
| `result.confirm_minutes` | no deadline |
| `result.auto_confirm` | an official finalises |
| `dispute.*_minutes` | an official decides |
| `honors.medal_places` | 3 |
| `honors.presence_min_matches` | 1 |

No game publisher rule set has been approved. The game modules and lobby points in the seed are TEST ONLY.
