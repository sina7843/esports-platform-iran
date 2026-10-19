# معماری — نمای کلی (ESP-01)

## سبک معماری
**Modular monolith دامنه‌محور** با سه runtime و دو بسته مشترک:

| مؤلفه | مسیر | مسئولیت |
|---|---|---|
| `@esp/contracts` | `packages/contracts` | قراردادهای مشترک: خطای یکسان، pagination، پول/زمان، ماتریس ACL، ماشین‌های وضعیت فصل ۱۵، رخدادهای outbox/realtime، schemaهای API (zod). بدون وابستگی به Node (قابل استفاده در مرورگر). |
| `@esp/core` | `packages/core` | ماژول‌های دامنه و زیرساخت: پیکربندی، MongoDB (transaction, migration, seed)، audit، نشست، ACL زمینه‌دار، approvals، outbox writer/consumer، realtime hub، گذار وضعیت، فایل‌ها، adapterهای تأمین‌کننده. |
| `@esp/api` | `apps/api` | Fastify + OpenAPI (zod type provider)، احراز نشست، CSRF، rate limit، routeهای REST/SSE/WS. |
| `@esp/worker` | `apps/worker` | حلقه consumer برای outbox (lease، retry، dead-letter) و جای jobهای زمان‌بندی‌شده مراحل بعد. |
| `@esp/web` | `apps/web` | shell رابط Vue 3 (فارسی RTL پیش‌فرض، انگلیسی، روشن/تاریک). |

از microservice پرهیز شده؛ مقیاس‌پذیری مستقل (NFR-011) از طریق replicaهای api/worker و تفکیک stateless/stateful به‌دست می‌آید.

## مرزهای دامنه و مالک هر مرز
همه ماژول‌ها در `packages/core/src/<domain>` یا در routeهای `apps/api/src/routes/<domain>.ts` قرار می‌گیرند. مرزها:

| دامنه | مالک قرارداد در ESP-01 | پر‌کننده رفتار |
|---|---|---|
| identity | `identity/sessions.ts`، `PrincipalDoc`، login-double | ESP-02 (OTP، پروفایل، نشست‌ها، 2FA) |
| organization | `OrganizationDoc`, `TeamDoc`, `TeamMembershipDoc`، scope `organization/team` | ESP-02 |
| game/rules | `RulesSnapshot` (نسخه، منبع، hash، بندهای اجباری/قابل‌تنظیم/انسانی) | ESP-02 |
| competition | `events → disciplines → stages → matches → game_units`، `participations`، گذارهای event/match | ESP-03/04/05 |
| finance | ماشین‌های payment/prize، `Money` (ریال صحیح)، approval مالی، adapter پرداخت | ESP-03 |
| ranking | `result_versions` (نسخه محاسبه و منشأ، DATA-007) | ESP-05 |
| newsroom | ماشین news، کانال realtime با `visibleAt` (تأخیر سمت سرور) | ESP-06 |
| communication | realtime hub (SSE/WS/polling)، adapter پیامک/ایمیل، کانال `system` | ESP-06 |
| operations | migrations، seed، audit chain، outbox replay، health، provider health | ESP-07 |

قاعده وابستگی: `apps/*` → `@esp/core` → `@esp/contracts`. دامنه‌ها از طریق رخداد outbox با هم صحبت می‌کنند، نه import متقابل.

## جریان یک درخواست
1. `onRequest`: نشست از cookie `esp_session` (httpOnly, SameSite=Strict) یا Bearer حل می‌شود؛ هیچ claim کش نمی‌شود.
2. route: validation ورودی با zod → `req.requirePermission(permission, scope)` → ACL گرانت‌ها را از DB و اجداد scope را از خود منبع می‌خواند (deny-by-default).
3. تغییر دامنه + audit + رخداد outbox در **یک transaction** (`dbh.withTransaction`).
4. پس از commit: realtime hub اعلام می‌کند (`afterCommit`)، worker رخداد را با lease برمی‌دارد و consumerهای idempotent را اجرا می‌کند.
5. خطا: `DomainError` → envelope یکسان `{error:{code,message,requestId,details?}}`؛ stack trace هرگز به client نمی‌رسد.

## قراردادهای ثابت
- شناسه‌ها ULID رشته‌ای با پیشوند (`evt_`, `mch_`, …)، پایدار و مرتب‌شونده.
- زمان: ذخیره UTC ISO-8601 با `Z`؛ نمایش Asia/Tehran، تقویم شمسی، ارقام فارسی/لاتین (`@esp/contracts/time`).
- پول: ریال صحیح؛ نمایش تومان با برچسب (`@esp/contracts/money`).
- وضعیت: فقط گذار نام‌دار + `expectedVersion` (`docs/state-transitions.md`).
- pagination: cursor مبهم base64url، `limit ≤ 100`.
- realtime: `seq` یکتای صعودی به‌عنوان cursor؛ `visibleAt` برای projection تأخیری.

## مستندات مرتبط
- `data-model.md`، `api-contract.md`، `outbox-and-realtime.md`، `security.md`، `backup-restore.md`، `deployment.md`
- `docs/state-transitions.md` (تولیدی)، `docs/api/openapi.json` (تولیدی)، `docs/ux/*`
