# قرارداد API

سند تولیدی: `docs/api/openapi.json` (OpenAPI 3.1 از schemaهای zod؛ `pnpm docs:generate`). در توسعه Swagger UI روی `/docs` فعال است و در تولید ثبت نمی‌شود.

## اصول
- پیشوند `/api/v1`. نسخه در مسیر؛ تغییر ناسازگار = `/api/v2`.
- همه ورودی‌ها (body/query/params) با zod اعتبارسنجی می‌شوند و همه پاسخ‌ها با schema پاسخ serialize می‌شوند؛ خروج فیلد اضافی (مثلاً رمز لابی) از نظر ساختاری ناممکن است.
- خطا همیشه `{ "error": { "code", "message", "requestId", "details?" } }` با کدهای ثابت `ErrorCodes` (`packages/contracts/src/errors.ts`) و نگاشت وضعیت HTTP ثابت. پیام انگلیسی ایمن؛ رابط فارسی را از `code` ترجمه می‌کند.
- `requestId` در header `x-request-id` قابل ارسال/دریافت است و در audit و log ثبت می‌شود.

## احراز هویت و CSRF
- cookie `esp_session` (httpOnly, SameSite=Strict, Secure در تولید) یا `Authorization: Bearer <token>` برای client های غیرمرورگری.
- درخواست‌های تغییردهنده با cookie باید header `X-Requested-With: fetch` داشته باشند (در کنار SameSite=Strict).
- `POST /auth/dev-session` فقط در توسعه با `AUTH_DEV_LOGIN_ENABLED=true` و `AUTH_DEV_CODE` ثبت می‌شود؛ در تولید وجود ندارد. ESP-02 ورود OTP را جایگزین می‌کند.

## pagination
`?cursor=<opaque>&limit=1..100` → `{ items, page: { nextCursor, limit } }`. cursor base64url از کلید مرتب‌سازی؛ client آن را نمی‌سازد (`decodeCursor` نامعتبر = شروع از ابتدا).

## مدل concurrency
- هر موجودیت قابل تغییر `version` دارد؛ تغییر وضعیت فقط با `POST /<entity>/:id/transitions { transition, expectedVersion, approvalId? }`. ناسازگاری نسخه → `409 VERSION_CONFLICT`؛ گذار نامجاز → `409 ILLEGAL_TRANSITION`؛ نیاز به تأیید دوم → `412 PRECONDITION_FAILED` با `details.secondApproval=true`.
- نوشتن مستقیم `state` (مثلاً `PATCH /events/:id {state}`) با `ILLEGAL_TRANSITION` رد می‌شود.
- عملیات حساس (ACL-003) ابتدا `POST /approvals` توسط درخواست‌کننده، سپس `POST /approvals/:id/decision` توسط شخص دیگر با مجوز `approval.decide` در همان scope، و سپس مصرف یک‌باره approval در گذار. خودتأییدی → `403 SEPARATION_OF_DUTIES`.
- idempotency بیرونی: شناسه سفارش/مرجع درگاه و `idempotencyKey` در adapterها؛ consumerهای outbox با `processed_events` idempotent هستند.

## realtime
- `GET /realtime/events?after=<seq>&channels=a,b&limit` (polling fallback)
- `GET /realtime/stream?after=&channels=` (SSE؛ `id:` = seq، `Last-Event-ID` پشتیبانی می‌شود، `event: close` با دلیل هنگام لغو نشست)
- `GET /realtime/ws?after=&channels=` (WebSocket؛ بستن با کد 4401 هنگام لغو نشست)
- قرارداد projection تأخیری: رخداد با `visibleAt` آینده در هیچ transport/API پیش از آن زمان دیده نمی‌شود (CAST-005/006؛ ESP-06 تأخیر هر استریم را روی این فیلد می‌نشاند).

## فهرست مسیرهای ESP-01
health (`/health`, `/health/live`, `/health/ready`), auth (`/auth/dev-session`, `/auth/me`, `/auth/logout`, `/auth/sessions`, `/auth/sessions/:id`, `/auth/grants/self`), acl (`/acl/grants`), approvals (`/approvals`, `/approvals/:id/decision`), realtime (۳ transport), competition (`/events`, `/events/:id`, `/events/:id/matches`, `/events/:id/transitions`, `PATCH /events/:id`, `/matches/:id`, `/matches/:id/lobby`, `/matches/:id/transitions`, `/meta/state-machines`), ops (`/ops/providers`, `/ops/outbox`, `/ops/outbox/:id/replay`, `/ops/audit`, `/ops/audit/verify`), files (`/files`, `/files/:id`, `/files/:id/link`, `/files/private/:id`, `/files/public/*`, `/files/retention-classes`).

## محدودیت‌ها
- rate limit پیش‌فرض ۳۰۰ درخواست/دقیقه به ازای IP با store درون‌حافظه‌ای؛ برای چند replica در تولید store مشترک (Mongo/Redis خودمیزبان داخل ایران) لازم است — ESP-07.
- body limit 1MiB برای JSON؛ آپلود multipart تا `UPLOAD_MAX_BYTES_PRIVATE`.
