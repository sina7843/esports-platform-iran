# مسیرها و صفحه‌ها (ESP-Web shell)

منبع داده «اکنون» یعنی API واقعی؛ «مرحله بعد» یعنی صفحه فقط حالت خالی صادقانه («این بخش در مرحله بعد تکمیل می‌شود») نشان می‌دهد و هیچ داده‌ی ساختگی تولید نمی‌شود.
محافظ مسیر سمت مرورگر فقط راهنماست؛ سرور مرجع نهایی است و خطای `FORBIDDEN` سرور همیشه به حالت «دسترسی ندارید» نگاشت می‌شود.
حالت‌ها: L = loading، E = empty، Err = error (با requestId)، F = forbidden، O = offline.

| مسیر | مخاطب / نقش | هدف | منبع داده اکنون | مرحله بعد | حالت‌ها |
|---|---|---|---|---|---|
| `/` | همه | صفحه اصلی و وضعیت سرویس | `GET /health` | اخبار و رویدادهای ویژه | L, Err, O |
| `/events` | همه | فهرست رویدادهای عمومی، صفحه‌بندی با cursor | `GET /events` | فیلتر و جستجو | L, E, Err, O |
| `/events/:id` | همه | جزئیات رویداد، رشته‌ها و مراحل | `GET /events/:id` | فهرست مسابقه‌ها و درخت حذفی | L, Err, O |
| `/matches/:id` | همه؛ لابی فقط با `match.lobby.read` | پروژکشن عمومی مسابقه + پنل خصوصی لابی | `GET /matches/:id`، `GET /matches/:id/lobby` (فقط با کلیک) | نتیجه، شواهد | L, Err, F (لابی), O |
| `/news` `/rankings` `/teams` `/organizers` `/search` | همه | پوسته‌ی عمومی | — | دامنه‌ی مربوطه | پیام «مرحله بعد» |
| `/login` | مهمان | ورود توسعه‌ای (development double) | `POST /auth/dev-session` | ورود واقعی با پیامک | Err، فرم دارای اعتبارسنجی |
| `/403` | همه | حالت دسترسی ندارید | — | — | F |
| `/offline` | همه | حالت آفلاین | — | — | O |
| `/*` | همه | ۴۰۴ | — | — | — |
| `/account` | کاربر واردشده | هویت، دسترسی‌ها، نشست‌ها (پایان نشست، خروج) | `GET /auth/me`، `/auth/sessions`، `DELETE /auth/sessions/:id`، `POST /auth/logout` | پروفایل | L, E, Err, F, O |
| `/account/notifications` | کاربر واردشده | اعلان‌ها | — | اعلان‌ها | پیام «مرحله بعد» |
| `/account/settings` | همه | زبان، پوسته، ارقام، منطقه زمانی (localStorage) + فرم نمونه موبایل/تاریخ شمسی/مبلغ | محلی | ذخیره در پروفایل | اعتبارسنجی خطا |
| `/team` | `team.read_private` | پنل تیم | — | فهرست اعضا و ثبت‌نام | 403 / «مرحله بعد» |
| `/organizer` | `event.manage` | پنل برگزارکننده | — | مدیریت رویداد | 403 / «مرحله بعد» |
| `/organizer/access` | `acl.read` | فهرست، ایجاد و لغو دسترسی در یک حوزه | `GET/POST /acl/grants`، `DELETE /acl/grants/:id` | — | L, E, Err, F, O |
| `/referee` | `match.result.verify` | پنل داور | — | تأیید نتیجه | 403 / «مرحله بعد» |
| `/newsroom` | `news.draft` | اتاق خبر | — | پیش‌نویس و انتشار | 403 / «مرحله بعد» |
| `/finance` | `finance.read` | پنل مالی | — | پرداخت و بازپرداخت | 403 / «مرحله بعد» |
| `/finance/approvals` | `approval.read` | فهرست تأییدیه‌های حوزه‌ی site و فرم تصمیم | `GET /approvals`، `POST /approvals/:id/decision` | — | L, E, Err, F, O |
| `/admin` | `platform.settings` | مدیریت پلتفرم | — | تنظیمات | 403 / «مرحله بعد» |
| `/admin/ops` | `outbox.read` | سلامت سرویس‌ها، outbox، dead-letter، صحت زنجیره‌ی ممیزی | `GET /ops/providers`، `/ops/outbox`، `POST /ops/outbox/:id/replay`، `GET /ops/audit/verify` | — | L, E, Err, F, O |

## بازگشت پس از ورود (UX-007)
مسیرهای دارای `requiresAuth` کاربر ناشناس را به `/login?redirect=<fullPath>` می‌فرستند. فقط مسیرهای نسبی هم‌مبدأ (`/...` و نه `//`) پذیرفته می‌شوند.

## اتصال زنده
نوار بالا از `EventSource` روی `/api/v1/realtime/stream?after=N&channels=system` استفاده می‌کند. در خطا هر ۱۵ ثانیه `/realtime/events?after=N` را poll می‌کند و پس از هر poll دوباره SSE را امتحان می‌کند.
