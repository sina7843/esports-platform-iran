# امنیت، مجوزها و مدل تهدید (ESP-01)

## کنترل دسترسی زمینه‌دار (فصل ۳، ACL-001..004)
کد: `packages/contracts/src/acl.ts` (نقش‌ها، scopeهای مجاز هر نقش، ماتریس نقش→مجوز، وراثت scope)، `packages/core/src/acl/acl.ts`.
- **deny-by-default**: مجوز فقط با گرانت فعال (`revokedAt=null`, `expiresAt` نگذشته) که نقش آن مجوز را دارد و scope آن برابر scope منبع یا جد مجاز آن است.
- **اجداد از خود منبع** خوانده می‌شوند (match → event → organization → site)، نه از درخواست؛ تغییر شناسه در درخواست دسترسی بین رویدادها نمی‌دهد (آزمون `acl.test.ts`: داور A روی مدارک/لابی B رد می‌شود و رد ثبت می‌شود).
- **بدون نقش سراسری مبهم**: `platform_admin` ساختارها را مدیریت می‌کند اما `match.lobby.read` و `event.evidence.read` ندارد.
- **تفکیک وظایف (ACL-003)**: `Approvals` — درخواست‌کننده نمی‌تواند خودش تصمیم بگیرد (`SEPARATION_OF_DUTIES`)؛ approval پس از مصرف `executed` می‌شود و دوباره قابل استفاده نیست. گذارهای `secondApproval` در جدول وضعیت‌ها به آن وابسته‌اند.
- **تعارض منافع**: `requireNoConflict` عضو ترکیب هر طرف را از قضاوت همان رویارویی منع می‌کند (`CONFLICT_OF_INTEREST`).
- **لغو فوری (ACL-002, AC-23)**: نشست opaque + خواندن گرانت در هر درخواست؛ `aclVersion` اصل افزایش می‌یابد؛ hub بلادرنگ در هر تحویل نشست/مجوز را بازبینی می‌کند و نشست لغوشده اتصال را می‌بندد.
- **ثبت ارتقا (ACL-004)**: هر گرانت/لغو با اعطاکننده، گیرنده، scope، تاریخ، انقضا و دلیل در `grants` و `audit_log` و رخداد `acl.*` در outbox.

## نشست‌ها
توکن ۲۵۶ بیتی تصادفی؛ فقط sha256 ذخیره می‌شود؛ cookie `httpOnly; SameSite=Strict; Secure(prod)`؛ TTL پیکربندی‌شده؛ خروج از دستگاه (`DELETE /auth/sessions/:id`). CSRF: SameSite=Strict + header `X-Requested-With` برای تغییرها. ورود OTP، 2FA و بازیابی در ESP-02 روی همین مدل می‌نشینند.

## ممیزی مقاوم (SEC-007, BASE-004)
`audit_log` append-only با `seq` اتمیک و `hash = sha256(prevHash + canonical(entry))`؛ `verifyChain()` ویرایش عادی را تشخیص می‌دهد (`GET /ops/audit/verify`). در تولید نقش برنامه روی این collection فقط insert/find دارد (`docker/mongo/init-prod.md`). رد دسترسی‌ها نیز ثبت می‌شوند (`outcome: denied`).

## فایل‌ها (SEC-003/004, OPS-003)
نوع واقعی با magic bytes، فهرست مجاز به تفکیک عمومی/خصوصی، سقف اندازه، ذخیره خارج از مسیر اجرای کد با mode 0600 و کلید تصادفی، اسکن (dev: فقط EICAR؛ تولید: ClamAV خودمیزبان)، quarantine برای infected/failed، لینک کوتاه‌عمر HMAC بسته به principal و زمان، مجوز `file.read_private` در scope فایل، retentionClass و اعلان فارسی مدت نگهداری؛ دسته `identity_document` تا تصویب سیاست مسدود است (OPS-002).

## لاگ بدون راز (SEC-002)
pino با `redact` روی `authorization`, `cookie`, `*.otp`, `*.code`, `*.token`, `*.secret`, `*.apiKey`, `*.devCode`; OTP و کلید سرویس هرگز در لاگ قرار نمی‌گیرند. envelope خطا بدون stack trace.

## پیکربندی و اسرار (SEC-005, OPS-005)
`loadConfig` در تولید/staging: `APP_SECRET` اجباری، `AUTH_DEV_LOGIN_ENABLED` ممنوع، adapterهای `dev` ممنوع، `TRUST_PROXY` اجباری — نبود هرکدام راه‌اندازی را متوقف می‌کند (هرگز سقوط خودکار به mock). اسرار فقط از محیط؛ عامل کدنویسی `.env` را نمی‌خواند.

## سخت‌سازی HTTP (SEC-001)
helmet (CSP در تولید)، CORS فقط برای `PUBLIC_WEB_ORIGIN` با credentials، rate limit (SEC-008 پایه؛ پایش ربات/اسپم و برنامه واکنش در ESP-07)، `X-Content-Type-Options`, `Referrer-Policy`, `nosniff` روی فایل‌ها، body limit. TLS در لبه داخلی (CDN/edge ایرانی) خاتمه می‌یابد و `TRUST_PROXY` IP واقعی را حفظ می‌کند.

## سیاست دامنه‌های شبکه (INTG-006, 13.1)
| مبدأ | مقصد مجاز | یادداشت |
|---|---|---|
| مرورگر کاربر | دامنه محصول (web, api, files/public) | فونت Vazirmatn، آیکون SVG و CSS محلی؛ هیچ CDN/فونت/analytics/چت خارجی. CSP در تولید `default-src 'self'`. |
| api/worker | mongo (شبکه داخلی)، adapterهای تأمین‌کننده ایرانی انتخاب‌شده (پیامک، درگاه، ایمیل، نقشه، ویدئو)، ClamAV خودمیزبان | فهرست دامنه هر تأمین‌کننده هنگام انتخاب (INTG-001) به این جدول افزوده می‌شود. |
| api/worker → ناشر بازی | فقط در استثنای ثبت‌شده همان عنوان (13.2) | پیش‌فرض `PUBLISHER_ADAPTER=none`؛ عملیات اصلی وابسته نیست (BASE-003). |
| هیچ‌کس | پایگاه داده و صف از اینترنت | mongo فقط `internal` network؛ پورت 27017 میزبان منتشر نمی‌شود. |

## مدل تهدید (خلاصه)
| تهدید | کنترل | وضعیت |
|---|---|---|
| IDOR بین رویدادها (AC-17) | ACL زمینه‌دار با اجداد از DB، projection عمومی بدون lobby/مدارک، 404 بدون افشای وجود رویداد خصوصی | آزمون‌شده (core + api) |
| ربودن/بازپخش نشست | توکن opaque hash شده، httpOnly, Strict, Secure, لغو فوری، لیست نشست‌ها | آزمون‌شده |
| CSRF | SameSite=Strict + header الزامی | آزمون‌شده |
| تغییر وضعیت دلخواه | فقط گذار نام‌دار + نسخه + نقش + تأیید دوم | آزمون‌شده |
| اثر مالی/نتیجه تکراری | outbox idempotent، approval تک‌مصرف، ایندکس‌های یکتا، نسخه خوش‌بینانه | پایه آزمون‌شده؛ جریان‌های مالی در ESP-03 |
| بارگذاری مخرب | sniff نوع، سقف، quarantine، خارج از مسیر اجرا، nosniff | آزمون‌شده (EICAR) |
| دستکاری ممیزی | زنجیره hash + نقش DB بدون update/remove | verify آزمون‌شده؛ نقش DB سند تولید |
| نشت راز در لاگ | redact | پیکربندی‌شده |
| Brute force OTP/ورود | rate limit پایه؛ قفل OTP در ESP-02 | جزئی |
| DoS حجمی | لبه ایرانی + rate limit | ESP-07 با آزمون بار |
| سقوط به mock در تولید | guard پیکربندی | آزمون‌شده (`audit.test.ts`) |

## ارزیابی مستقل (SEC-009)
هنوز انجام نشده؛ در ESP-07 با شواهد ثبت می‌شود. هیچ گواهی ادعا نمی‌شود.
