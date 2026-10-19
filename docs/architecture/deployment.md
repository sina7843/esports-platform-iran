# استقرار، محیط‌ها و تأمین‌کنندگان

## محیط‌ها
| محیط | `APP_ENV` | پایگاه | adapterها | ورود توسعه |
|---|---|---|---|---|
| local | local | `compose.yaml` + `compose.local-tools.yaml` (mongo روی 127.0.0.1:27018) یا داخل Compose | dev doubles | فعال با `AUTH_DEV_CODE` |
| ci | ci | mongo سرویس CI با `rs.initiate` | dev doubles | فعال در آزمون‌ها |
| staging | staging | replica set با auth | **تأمین‌کننده واقعی sandbox** (dev ممنوع) | غیرفعال |
| production | production | replica set ۳ عضوی با auth و keyfile، فقط شبکه داخلی | تأمین‌کننده واقعی | غیرفعال |

`loadConfig` در staging/production هر پیکربندی ناقص را با پیام روشن متوقف می‌کند (هرگز سقوط به mock).

## Compose
- `compose.yaml`: mongo (replica set تک‌عضوی با initialization قطعی در healthcheck، named volume، بدون پورت میزبان)، api (127.0.0.1:3000)، worker، web (127.0.0.1:8080). شبکه `internal` بدون دسترسی اینترنت برای mongo/worker.
- `compose.local-tools.yaml`: انتشار mongo روی loopback برای اجرای api/worker/آزمون روی میزبان (opt-in).
- `compose.prod.yaml`: auth + keyfile، read-only rootfs، cap_drop، no-new-privileges، بدون پورت پایگاه/صف، web پشت لبه داخلی.

Imageها چندمرحله‌ای، non-root (`esp` / nginx-unprivileged)، فقط وابستگی تولید (`pnpm deploy --prod`)، healthcheck. lockfile `pnpm-lock.yaml` پین شده و با `--frozen-lockfile` نصب می‌شود.

## میزبانی داخل ایران (BASE-002, 13.1)
| نیاز | انتخاب فعلی | وضعیت |
|---|---|---|
| میزبانی/پردازش/پایگاه | زیرساخت ایرانی تحت کنترل محصول (VM/Kubernetes)؛ Arvan صرفاً نامزد ارزیابی | **تصمیم مالک پس از ارزیابی (INTG-001)** |
| ذخیره فایل | adapter `local` روی volume پشتیبان‌گیری‌شده؛ object storage داخلی در ارزیابی | پیاده‌شده (local) |
| CDN/DNS/لبه/TLS | ارائه‌دهنده داخلی؛ TLS در لبه؛ `TRUST_PROXY=true` | تصمیم مالک |
| پیامک/OTP | adapter با interface `SmsAdapter` + double توسعه | تأمین‌کننده انتخاب نشده |
| پرداخت | `PaymentAdapter` (create/verify/refund با idempotency) + double | تأمین‌کننده/قرارداد انتخاب نشده |
| ایمیل | `EmailAdapter` + double | انتخاب نشده (سرور تحت کنترل محصول گزینه است) |
| نقشه | `MapAdapter`؛ آدرس متنی همیشه نمایش داده می‌شود | انتخاب نشده |
| پخش/ویدئو | `VideoAdapter` | انتخاب نشده (ESP-06) |
| اسکن فایل | `ScannerAdapter`: dev / clamav خودمیزبان | ClamAV در ESP-07 نصب و آزمون می‌شود |
| کپچا/ضدسوءاستفاده | راهکار داخلی/خودمیزبان | ESP-02/07 |
| آمار/خطا/جست‌وجو | خودمیزبان | ESP-06/07 |
| ناشر بازی | استثنای هر عنوان، پیش‌فرض `none` | فقط با مجوز و امکان واقعی (13.2) |

هر adapter `health()` با `mode: development_double|production`, `capabilities` و `status` برمی‌گرداند و در `GET /health` و `GET /ops/providers` دیده می‌شود (INTG-002, OPS-007).

## راه‌اندازی بدون credential واقعی
`README.md` → نصب، `docker compose up`, `pnpm db:migrate`, `pnpm db:seed`. هیچ حساب سرویس، پرداخت واقعی یا ارسال پیامک واقعی در این مرحله انجام نمی‌شود. مقادیر محلی را مالک با `06-CREATE-LOCAL-ENV.cmd` می‌سازد.

## CI
`.github/workflows/ci.yml`: install (frozen lockfile) → replica set → typecheck → lint → test → build → docker build سه image. اجرای واقعی CI به مخزن GitHub/Gitea مالک وابسته است و این‌جا فقط محلی اجرا شده است.

## مقیاس (NFR-011)
api و worker stateless و قابل تکثیر؛ mongo replica set؛ فایل روی storage مشترک؛ realtime در چند replica به change stream/pub-sub نیاز دارد (ESP-07). اهداف فصل ۱۴ هنوز اندازه‌گیری نشده‌اند.
