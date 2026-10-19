# ESP-02 module guide (conventions for every ESP-02 module)

Repository: pnpm monorepo. Read first: `docs/architecture/overview.md`, `packages/core/src/container.ts`, `packages/core/src/db/collections.ts`, `packages/core/src/db/collections-esp02.ts`, `packages/contracts/src/acl.ts`, `apps/api/src/routes/competition.ts` (route style), `apps/api/src/plugins/auth.ts`, `apps/api/src/app.test.ts` and `packages/core/src/acl/acl.test.ts` (test style), `packages/core/src/test/harness.ts`, `packages/core/src/db/seed.ts` (seed ids). Requirements: `Requirements.md` (Persian ESP-SRS; read the chapters for your IDs).

## Hard rules
- Edit ONLY files you own (listed in your brief). Never edit `.claude/`, `tools/`, `prompts/`, `Requirements.md`, `CLAUDE.md`, `IMPLEMENTATION_DECISIONS.md`, status docs, `container.ts`, `app.ts`, `seed.ts`, `acl.ts`, `collections.ts` (unless your brief says so). Never read or create `.env`. Do not commit. Do not run `pnpm install` or add dependencies (Node stdlib `node:crypto` covers hashing/HMAC/scrypt/TOTP).
- If you need a new ACL permission or role mapping, a container change or a seed change: do NOT edit those files; put the exact change in your final report under "Integration requests". Prefer constructing your service inside your route file: `const svc = new XService(container)`.
- Collections are already defined in `collections-esp02.ts` (+ extended `OrganizationDoc`, `TeamDoc`, `TeamMembershipDoc` in `collections.ts`). Indexes in migration `0002`. If a doc type is missing a field you need, you may edit ONLY the interface(s) for your domain in `collections-esp02.ts` and say so in the report. Unique index changes go in the report.
- Contracts (zod schemas) live in `packages/contracts/src/<your files>`; extend only your own files.

## Code conventions
- Service classes in `packages/core/src/<domain>/`, constructor `(container: Container)` or explicit deps; export from your domain `index.ts` (or the file already re-exported by `packages/core/src/index.ts`).
- Every mutation: server-side authorization (`container.acl.require(principalId, permission, scope, requestId)` or ownership check), validation (zod at API boundary + domain invariants), `version`-based optimistic concurrency (`expectedVersion` → `VERSION_CONFLICT`), audit (`container.audit.append`) and a domain event (`container.outbox.append`) in the SAME transaction (`container.dbh.withTransaction`) when more than one document changes.
- Throw `DomainError(code, message, details?)` from `@esp/contracts`; never leak stack traces, secrets, OTP codes, phone numbers of others or private fields.
- Instants: ISO UTC strings. Money: integer rial. IDs: `newId('prefix')`.
- Routes: `apps/api/src/routes/<your>.ts`, exported function already registered in `app.ts` with the given name. Use `app.withTypeProvider<ZodTypeProvider>()`, `schema: { tags, params, querystring, body, response }` with `ErrorResponse` for error statuses, `req.requireAuth()`, `req.requirePermission(perm, scope)`. Mutations via cookie need header `X-Requested-With: fetch` (tests must send it). Public responses must be explicit projections (never return raw docs).
- Role grants for contextual permissions are created with `container.acl.grant({principalId, role, scope, expiresAt, reason}, {principalId, requestId}, session?)` and revoked with `container.acl.revoke(grantId, actor, reason, session?)`.

## Tests
- Core tests: `packages/core/src/<domain>/*.test.ts` using `testContainer({ seed: true })` from `../test/harness.js` (fresh DB per file on the replica set at MONGO_URL, default `mongodb://127.0.0.1:27018/esports?directConnection=true`, already running). Run: `pnpm --filter @esp/core exec vitest run src/<domain>`.
- API tests: `apps/api/src/<domain>.test.ts` following `app.test.ts` (own DB, `buildApp`, `app.inject`). API imports `@esp/core` from `dist`: run `pnpm build:libs` first. Other agents work in parallel; if a build error is in a file you don't own, wait ~1 min and retry; never edit their files to fix it. Run: `pnpm --filter @esp/api exec vitest run src/<file>`.
- Lint your files: `pnpm eslint <paths>`. Typecheck: `pnpm --filter @esp/core typecheck`, `pnpm --filter @esp/api typecheck`.
- Only report a test as passed if you ran it. Report exact commands and results.

## Seed
Add a TEST ONLY seed function in your domain (e.g. `seedTeamsDomain(c, acl)`) that is idempotent (upsert by fixed ids) and labels data `TEST ONLY`. Do not edit `seed.ts`; report the function name so it can be wired in.

## Final report (keep it short)
Files created/changed; endpoints (method, path, permission); tests and exact results; requirement IDs covered and what is still missing/blocked; Integration requests (ACL permissions, seed wiring, container/worker jobs, index changes).
