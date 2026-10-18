# Implementation baseline — Esports Platform

Date: 2026-10-18. These are adapted template engineering defaults, not newly approved commercial policies or external-law claims.

## 1. Source and scope
Requirements.md is a byte-for-byte copy of the supplied ESP-SRS 1.0. All functionality is full-product scope. Sequential prompts express dependencies, not partial releases. If a template policy conflicts with ESP-SRS, ESP-SRS wins and the conflict is recorded in DECISIONS.md. Never import Dragon economy, five-phase scope, fixed age 13, a 1,000-participant ceiling, mock-only production, or a no-backup exemption.

## 2. Template stack retained
- Vue 3, Vite, TypeScript strict, Vue Router; Node.js LTS, TypeScript and Fastify API.
- MongoDB 8.x baseline from the template. Resolve supported patch/image versions at implementation time, pin dependencies and lockfiles, and document compatibility. No claim is made that the attached template pins current versions.
- Modular monolith with explicit domain contracts and a worker, not mandatory microservices.
- Docker Compose web/api/mongo and worker as needed; self-hosted supporting services inside Iran. Select additional components only when justified and record the tradeoff.
- Multi-document financial/capacity/result invariants need transactions or an equally proven atomic design. Mongo replica-set initialization must be deterministic, with transaction tests and production topology documented.
- Internal Mongo DNS mongo:27017, no default host publish of port 27017, named-volume persistence, non-root application containers, health/readiness and graceful shutdown. Never mount Docker socket or use privileged containers.
- Hosting must satisfy Iranian deployment and ESP-SRS targets. Arvan is an evaluation candidate from the old template, not an exclusive selected provider.

## 3. State and domain consistency
- UTC storage, Asia/Tehran default display, Persian-calendar display and normalized Persian/Latin digits.
- Money is integer IRR, Toman display with explicit unit and tested conversion; no unrequested wallet or coin.
- Scope-aware authorization and immediate revocation, immutable historical roster/rules/result versions and append-only sensitive audit.
- Idempotency, unique constraints, concurrency control, durable outbox, deduplicating consumers and explicit compensation/reconciliation. No promise of network exactly-once delivery; domain effects must occur once.
- Ruleset age, roster size, pauses, tie-breaks and disciplinary policies are per approved game/event. Do not invent one global rulebook.
- State transitions have authorized actor, preconditions, effects, notification and reversal/compensation rules.

## 4. Provider policy
- Operational site providers must be Iranian or self-hosted under product control inside Iran. Local assets instead of foreign font/CDN/analytics SDK dependencies.
- Publisher APIs, game servers and anti-cheat are optional, documented exceptions per title with actual availability and permission. Core site workflows retain authorized manual paths.
- Provider adapters with deterministic development/test doubles are required. Test doubles must never activate silently in production and are not completed live integrations.
- Provide real production paths using current official provider contracts where an eligible provider is selected; record provider/credential/contract blockers where not available. Do independent work without asking the owner to redefine settled scope.
- No live charge, payout, credential creation, secret-file read or real SMS send is implied by these implementation prompts. Use local tests and authorized provider sandbox configuration. Owner configures secrets outside the coding agent.
- Provider health, quotas, bounded retries, dedupe, failure isolation, alternative paths and reconciliation must be visible.
- Payment, refunds, subscriptions, tickets, organizer services and prize settlements follow FIN and END. No inherited non-refundable-coin policy applies.

## 5. Public realtime data
- Durable cursors, gap-free snapshot/subscription handoff, dedupe, reconnect recovery and polling fallback.
- A server-side publication policy covers delayed views, their APIs, streams, caches, overlays, share images and notifications. Explicit latest-result views are separately labeled.
- Private lobby credentials and confidential evidence never enter public projections, even after delay.

## 6. Readiness and operations
- ESP-SRS chapter 14 targets apply, including backups and restore, RPO<=15min and RTO<=2h, not the template's removed-backup policy.
- 10,000 concurrent sessions, 300 live matches, 100 operators, 500 dynamic RPS (80/20 read/write), 60 minutes, <1% unexpected errors, p95 read<=800ms/write<=1500ms and live<=3s are acceptance targets, not claimed measured results.
- 99.9% monthly availability and field p75 web metrics need actual observation; local tests alone cannot prove them.
- Independent security assessment OR documented specialist review is required by SEC-009. No fabricated certification.
- Required backups are encrypted with a failure domain independent from the primary; restore and financial reconciliation are tested. Legal holds override retention deletion.
- Unapproved identity/financial-document retention policies block collection of those sensitive documents, not all unrelated development.
- Brand, domain, actual game readiness, provider contracts, fees/prices, exact rating formula and publisher permissions remain configured/approved through their named owners in chapter 17.2.
- Production readiness requires chapter 17.3, actual evidence and no open critical money/authorization/results/recovery defects. Missing evidence stays visible.

## 7. Repository workflow
- Use prompts/prompt-manifest.json: ESP-01..07, sequential, no slices.
- A baseline Git commit precedes any implementation; Windows setup creates .esports-backups/baseline.bundle on a fresh repository.
- Preserve protected source, LF Linux runtime/config files, UTF-8 prompt text and a pinned dependency lockfile. Human local config uses 06-CREATE-LOCAL-ENV.cmd.
- Keep per-requirement code/test/result evidence and update statuses only when verified. A partial implementation remains unchecked and resumes under the same prompt.
