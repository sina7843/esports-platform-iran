# Outbox پایدار و انتشار بلادرنگ

کد: `packages/core/src/outbox/*`, `packages/core/src/realtime/realtime.ts`, `apps/api/src/routes/realtime.ts`, `apps/worker/src/main.ts`. آزمون: `packages/core/src/outbox/outbox.test.ts`, `packages/core/src/realtime/realtime.test.ts`, `apps/api/src/app.test.ts` (SSE).

## نوشتن (atomic)
`OutboxWriter.append(event, session)` در همان transaction تغییر دامنه و audit فراخوانی می‌شود. اگر transaction rollback شود، نه تغییر و نه رخداد باقی می‌ماند (آزمون «rollback drops both»). رخداد: `{id (ULID = کلید idempotency), type 'domain.entity.action', aggregate{type,id}, aggregateVersion, occurredAt, actor, payload, correlationId}`.

## مصرف (worker)
1. `claim()`: `findOneAndUpdate` روی `pending` با `nextAttemptAt<=now` یا `processing` با lease منقضی → `processing` + `leaseUntil` + `attempts++`. چند replica هم‌زمان یک رکورد را نمی‌گیرند.
2. برای هر consumer منطبق (`matches: ['acl.']` پیشوند یا نام کامل): در یک transaction، اگر `processed_events[_id = consumer:eventId]` موجود باشد → skip؛ وگرنه handler اجرا و marker درج می‌شود. crash بعد از اثر جانبی و قبل از marker = rollback کامل؛ اجرای بعدی دقیقاً یک بار اعمال می‌کند (آزمون «exactly once even when the worker crashes»).
3. موفق → `done`؛ خطا → `pending` با backoff نمایی (حداکثر ۶۰ ثانیه) تا `maxAttempts` (پیش‌فرض ۸) → `dead_letter` + audit.
4. `stop()` leaseهای همان worker را آزاد می‌کند (restart بدون از دست‌رفتن کار؛ آزمون «survives a restart»).
5. `replay(id)` فقط برای `dead_letter`، رکورد تازه با `replayOf` می‌سازد و audit می‌نویسد (`POST /ops/outbox/:id/replay`، مجوز `outbox.replay`). replay یعنی consumer دوباره اجرا می‌شود؛ consumerها باید در سطح دامنه نیز idempotent باشند (کلید دامنه‌ای، نه فقط eventId).

اثر جانبی بیرونی (پیامک، درگاه): consumer باید `idempotencyKey` تأمین‌کننده را بر پایه `event.id` بسازد تا تکرار بیرونی اثر دوم نسازد (FIN-004, COM-004).

## realtime
- `Realtime.publish({channel, type, audience, payload, visibleAt?}, session?)`: درج در `realtime_events` با `seq` اتمیک؛ اعلام درون‌پردازه‌ای فقط پس از commit (`afterCommit`). اگر پردازه بمیرد، polling/catch-up خلأ را پر می‌کند (gap-free).
- `audience`: `public` | `principals[]` | `scope+permission`. در **هر تحویل** نشست و مجوز دوباره بررسی می‌شود؛ لغو گرانت تحویل را قطع و لغو نشست اتصال را می‌بندد (AC-23؛ آزمون‌های realtime و SSE).
- cursor: `seq`. client آخرین `seq` را نگه می‌دارد و با `after` یا `Last-Event-ID` وصل می‌شود؛ تحویل با `seq <= last` حذف می‌شود (بدون تکرار، LIVE-006).
- transportها: SSE (اصلی)، WebSocket (اختیاری)، polling (fallback). انتخاب در client؛ قرارداد یکسان.
- **projection تأخیری (CAST-005/006):** `visibleAt` در آینده → رخداد از poll، stream و ws پنهان است تا آن لحظه؛ سپس خودکار اعلام می‌شود. ESP-06 برای هر استریم `delaySeconds` تعریف می‌کند و هنگام publish `visibleAt = occurredAt + delay` می‌گذارد؛ نمای «آخرین نتیجه» کانال جدا و برچسب‌دار با `visibleAt` خالی است. داده محرمانه (رمز لابی، مدارک) هرگز در payload کانال عمومی قرار نمی‌گیرد.

## مقیاس
اعلام درون‌پردازه‌ای است؛ با چند replica api، هر replica catch-up را از DB انجام می‌دهد و برای live push باید به تغییرات DB گوش دهد. گزینه ESP-07: change stream روی `realtime_events` (replica set آماده است) یا pub/sub خودمیزبان داخل ایران.
