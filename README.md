# پلتفرم تخصصی ورزش‌های الکترونیک ایران — مخزن محصول

Modular monolith: `apps/web` (Vue 3)، `apps/api` (Fastify)، `apps/worker` (outbox consumer)، `packages/contracts`، `packages/core`. MongoDB 8 replica set. مستندات معماری در `docs/architecture/`، رابط در `docs/ux/`، قرارداد API در `docs/api/openapi.json`، گذار وضعیت‌ها در `docs/state-transitions.md`.

## پیش‌نیاز
Node.js ≥ 22.12 (LTS 24 آزمون‌شده)، pnpm 11.5.2 (`corepack enable`)، Docker Desktop/Engine با Compose v2.

## نصب و اجرای محلی
```sh
pnpm install --frozen-lockfile
# پایگاه داده (replica set) روی loopback 27018 برای اجرای روی میزبان:
docker compose -f compose.yaml -f compose.local-tools.yaml up -d mongo
# متغیرهای محیطی: .env.example مرجع نام‌هاست؛ مقادیر محلی را با 06-CREATE-LOCAL-ENV.cmd بسازید (پیش‌فرض‌ها برای توسعه کافی است).
pnpm build:libs
pnpm db:migrate          # مهاجرت نسخه‌دار (idempotent)
pnpm db:seed             # داده مصنوعی TEST ONLY
pnpm dev:api             # http://127.0.0.1:3000  (Swagger UI: /docs)
pnpm dev:worker          # consumer outbox
pnpm dev:web             # http://localhost:5173 (proxy /api → 3000)
```
ورود توسعه: `AUTH_DEV_LOGIN_ENABLED=true` و `AUTH_DEV_CODE=<code>` در محیط، سپس صفحه `/login` با یکی از principalهای seed (`usr_seed_admin`, `usr_seed_organizer`, `usr_seed_referee`, `usr_seed_captain`, `usr_seed_player`, `usr_seed_reporter`, `usr_seed_finance`, `usr_seed_finance_2`). این یک double توسعه است؛ ESP-02 ورود با موبایل/OTP را جایگزین می‌کند.

## اجرای کامل با Docker
```sh
docker compose up -d --build      # mongo (داخلی)، api (127.0.0.1:3000)، worker، web (127.0.0.1:8080)
docker compose exec api node -e "import('@esp/core').then(async m=>{const c=await m.createContainer({serviceName:'seed'});await m.runMigrations(c.dbh.db);await m.seedDatabase(c.c,c.acl);await c.close();})"
```
توقف با حفظ داده: `docker compose down` (بدون `-v`).

## بررسی‌ها
```sh
pnpm check        # build:libs + typecheck + lint + test + build
pnpm test         # آزمون‌های واحد/یکپارچه (نیازمند Mongo replica set روی MONGO_URL)
pnpm docs:generate
```

## ساختار
```
apps/api        Fastify, OpenAPI, routes (auth, acl, approvals, realtime, competition, ops, files)
apps/worker     outbox consumer loop (+ --once)
apps/web        Vue 3 shell (fa RTL پیش‌فرض، en، روشن/تاریک)
packages/contracts  خطا، pagination، پول/زمان، ACL matrix، state machines، event contracts، API schemas
packages/core   config, db (transactions, migrations, seed), audit, sessions, acl, approvals, outbox, realtime, files, adapters
docs/           architecture, ux, api, state-transitions
docker/mongo    runbook تولید
```

## وضعیت
مرحله ESP-01 (زیرساخت). وضعیت و شواهد در `IMPLEMENTATION_STATUS.md` و `REQUIREMENTS_TRACEABILITY.md`. هیچ تأمین‌کننده واقعی، پرداخت واقعی یا انتشار عمومی انجام نشده است.
