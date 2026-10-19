# ثبت‌نام، ظرفیت و جریان مالی (ESP-03)

دامنه: EVT-001..008، STG-001..006، REG-001..010، ROS-001..006، CHK-001..004، FIN-001..012؛ پذیرش AC-01/02/03/04/19.
کد: `packages/core/src/{events,registration,finance}`، مسیرها در `apps/api/src/routes/{events-admin,registrations,finance}.ts`، صفحه‌ها در `apps/web/src/views`.

## ۱. مسیر کامل ثبت‌نام تا رسید

1. **ساخت رویداد** (`POST /events`، فقط `event.manage` در سازمان برگزارکننده). وضعیت `draft`. پس از انتشار فقط فیلدهای نمایشی قابل ویرایش‌اند.
2. **رشته و مرحله** (`POST /events/:id/disciplines`, `POST /disciplines/:id/stages`). ظرفیت، ورودی (ریال صحیح)، پنجره‌ها، فرم، مدارک، سیاست حضور و سهمیه‌ها در `DisciplineConfig` است. ظرفیت صفر یعنی «پیکربندی نشده» و مانع انتشار است؛ هیچ مقدار قانون رقابتی پیش‌فرض ساخته نمی‌شود.
3. **دروازه‌ی انتشار** (`GET /events/:id/publish-check`، `POST /events/:id/publish`). شرایط: برگزارکننده‌ی تأییدشده با سقف مجاز، بسته‌ی قوانین منتشرشده، آمادگی بازی/نسخه/حالت، شرایط لغو و اعتراض، سیاست بازپرداخت برای رویداد پولی، ظرفیت و پنجره‌ی ثبت‌نام.
   انتشار در یک تراکنش این کارها را انجام می‌دهد:
   - منجمد کردن snapshot قوانین (hash)؛
   - ساخت شمارنده‌های ظرفیت `capacity_counters`؛
   - ساخت نسخه‌ی قیمت ورودی (`entry:<disciplineId>`، کارمزد ۰)؛
   - ساخت سندهای جایزه (`guaranteed: false`)؛
   - برای `link_only`، ساخت توکن لینک؛
   - انتقال وضعیت و ثبت outbox `competition.event.published`.

   مسیر عمومی `transitions` برای `publish` و `cancel` بسته است.
4. **باز کردن ثبت‌نام** (`open_registration`). صفحه‌ی عمومی `GET /events/:id` این موارد را نشان می‌دهد: ظرفیت باقی‌مانده، تعداد فهرست انتظار، ورودی، پنجره‌ها، فرم، snapshot قوانین، شرایط، جوایز («تضمین نمی‌شود») و حامیان تأییدشده. رویداد link_only بدون توکن ۴۰۴ می‌دهد و `noindex` است.
5. **درخواست ثبت‌نام** (`POST /disciplines/:id/registrations`، بدنه با `acceptRulesHash`):
   - **بررسی‌ها:**
     - hash پذیرفته‌شده باید با snapshot منجمد برابر باشد؛
     - زمان باید داخل پنجره (یا پنجره‌ی دیرهنگام) باشد؛
     - کد سهمیه یا دعوت بررسی می‌شود؛
     - شرایط صلاحیت (روستر، چندتیمی، شناسه‌ی بازی، منطقه) بررسی می‌شوند. بندهای سن و رتبه به بررسی انسانی می‌روند.
   - **رزرو ظرفیت** با `$inc` شرطی (`held + confirmed < capacity`) در همان تراکنش انجام می‌شود:
     - **ظرفیت هست و ورودی صفر:** `awaiting_review`، سپس تأیید خودکار در صورت مجاز بودن.
     - **ظرفیت هست و ورودی پولی:** سفارش با نسخه‌ی قیمت ساخته می‌شود و وضعیت `awaiting_payment` است. مهلت نگه‌داری `paymentWindowMinutes` است.
     - **ظرفیت نیست:** `awaiting_capacity` با `waitlistSeq` اتمیک (FIFO قطعی).
     - **تیمی:** تا تأیید شخصی هر عضو روستر (`roster-response`) پیش‌نویس می‌ماند (ROS-002).
6. **پرداخت** (`POST /orders/:id/pay`، returnUrl فقط روی `PUBLIC_WEB_ORIGIN`). در هر سفارش فقط یک پرداخت در جریان مجاز است (partial unique index). مرورگر به درگاه می‌رود.
7. **بازگشت مرورگر** (`/payments/return?order=`). صفحه `POST /payments/:id/verify` را صدا می‌زند و سفارش را poll می‌کند. بازگشت مرورگر هرگز دلیل پرداخت نیست.
8. **Callback درگاه** (`POST /payments/callback`). امضای HMAC بررسی می‌شود و سپس **استعلام سمت سرور** از درگاه انجام می‌شود. مبلغ، سفارش و merchant باید برابر باشند. نتیجه idempotent است و با gatewayRef یکتا ثبت می‌شود.
   - سفارش `paid` می‌شود، رسید `RC-…` صادر می‌شود، ثبت دفتر کل دوطرفه انجام می‌شود و outbox `finance.order.paid` ثبت می‌شود.
   - مصرف‌کننده‌ی `order-paid-fulfilment` ثبت‌نام را به `awaiting_review` و سپس `confirmed` می‌برد. snapshot مشارکت (`participations`) فقط در تأیید ساخته می‌شود.
9. **پس از تأیید:**
   - قفل روستر (`/roster-locks`، تغییرناپذیر)؛
   - تعویض بازیکن طبق بندهای قوانین؛
   - اعلام حضور در پنجره (`/checkins`)؛
   - ثبت غایبان (`/checkins/finalize`)؛
   - رسید در «ثبت‌نام‌های من».

## ۲. API و صفحه‌ها

| صفحه | مسیرها |
|---|---|
| `/events/:id` | `GET /events/:id?t=`, `POST /disciplines/:id/registrations`, `POST /orders/:id/pay`, `POST /events/:id/tickets` |
| `/payments/return` | `GET /orders/:id`, `POST /payments/:id/verify` |
| `/account/registrations` | `GET /me/registrations`, `/me/orders`, `/me/tickets`, `/me/subscriptions`, `POST /registrations/:id/{roster-response,withdraw,re-review}`, `POST /checkins`, `POST /subscriptions` |
| `/organizer` | `GET /organizations/:id/events`, `POST /events` |
| `/organizer/events/:id` | `GET /events/:id/manage`, `publish-check`, `publish`, `schedule`, `duplicate`, `cancel`, `transitions`, `disciplines`, `stages`, `registrations`, `decision`, `registrations.csv`, `invites/import`, `entry-codes`, `roster-locks`, `checkins*`, `financials`, `prizes`, `prizes/:id/recipient`, `tickets/config`, `tickets/use`, `sponsors` |
| `/finance` | `GET /finance/reconciliation`, `POST /finance/reconciliation/run`, `POST /payments/:id/refunds`, `POST /finance/manual-payments`, `POST /finance/prices`, `GET /finance/prices/:key`, `POST /finance/discounts`, `GET /organizations/:id/balance`, `POST /organizations/:id/settlements`, `POST /prizes/:id/{payout,paid}`, `GET /finance/ledger.csv` |

جزئیات بدنه‌ها در `docs/api/openapi.json` و ماشین‌های وضعیت در `docs/state-transitions.md` است.

## ۳. جریان مالی

- **پول:** پول همیشه ریال صحیح است و نمایش آن «تومان» با برچسب است. قیمت‌ها نسخه‌دار هستند (`price_lists`، با `feeBps`) و سفارش نسخه‌ی قیمت را نگه می‌دارد. تخفیف با `$inc` شرطی روی سقف استفاده اتمیک است.
- **دفتر کل:** دوطرفه و append-only است. هر تراکنش جمع صفر دارد و `seq` آن از شمارنده می‌آید. اصلاح فقط با ثبت معکوس انجام می‌شود. حساب‌ها: `cash:psp`، `revenue:platform_fee`، `payable:organization:<id>`، `refund:*` و دیگر حساب‌ها. `unbalancedTransactions()` در آزمون‌ها صفر است.
- **بازپرداخت** (FIN-006):
  - کلید idempotency یکتا دارد و `refundedRial` به‌صورت اتمیک رزرو می‌شود (`$expr` ≤ مبلغ پرداخت). درخواست هم‌زمان با همان کلید همان بازپرداخت را برمی‌گرداند.
  - مبلغ بالاتر از `REFUND_APPROVAL_THRESHOLD_RIAL` تأیید فرد دوم می‌خواهد.
  - پرداخت دستی با مدرک بیرون از درگاه بازپرداخت می‌شود.
- **پرداخت دستی** (FIN-005): تأیید مستقل `finance.manual_payment` و فایل مدرک خصوصی با اسکن تمیز لازم است. با برچسب «manual» ثبت می‌شود.
- **لغو رویداد** (AC-19): `event.cancel` با تأیید مستقل انجام می‌شود و outbox `competition.event.cancelled` ثبت می‌شود. مصرف‌کننده این کارها را انجام می‌دهد:
  - حذف ثبت‌نام‌های فعال؛
  - بازپرداخت طبق درصد لغو؛
  - باطل کردن بلیت‌ها؛
  - لغو جوایز.

  هر گام idempotent است.
- **جوایز** (FIN-007/008):
  - چرخه: `defined → recipient_verified → ready_to_pay → paying → paid`.
  - آزادسازی به `finance.payout` و نتیجه‌ی نهایی (`result_versions.data.final`) نیاز دارد. قرارداد این نتیجه از ESP-05 می‌آید.
  - شروع پرداخت یک تأیید مستقل مصرف می‌کند. «پرداخت‌شده» مدرک یا شماره‌ی پیگیری بانک می‌خواهد.
  - تغییر دریافت‌کننده‌ی تأییدشده تأیید مستقل می‌خواهد.
- **اشتراک، بلیت، حامی و تسویه:**
  - امکانات اشتراک فقط ابزاری هستند و هرگز امتیاز رقابتی یا اختیار داوری نمی‌دهند.
  - بلیت ظرفیت جدا دارد و کد آن یک‌بارمصرف است.
  - حامی تا تأیید (با بررسی محدودیت ناشر) عمومی نمی‌شود.
  - تسویه با برگزارکننده از مانده‌ی `payable:organization` کم می‌شود. کلید idempotency، تأیید و مدرک لازم است.
- **خروجی حسابداری:** `GET /finance/ledger.csv` با BOM UTF-8 است و خنثی‌سازی تزریق فرمول دارد.

## ۴. تهدیدها و سناریوهای رقابتی

| سناریو | دفاع | آزمون |
|---|---|---|
| دو درخواست هم‌زمان برای آخرین جا | `$inc` شرطی روی شمارنده؛ دومی به فهرست انتظار FIFO | `registration.test.ts` «AC-03 …» |
| پرداخت هم‌زمان با انقضای رزرو | پرداخت دیرهنگام: اگر ظرفیت آزاد باشد تخصیص، وگرنه بازپرداخت ۱۰۰٪ و رد؛ هیچ‌گاه تأیید بدون ظرفیت | «payment racing the reservation expiry …» |
| قطع مرورگر پس از پرداخت | callback + reconciliation، بدون نیاز به مرورگر | «browser drop after payment …» (AC-04)، `payments.test.ts` «browser return alone never confirms …» |
| callback جعلی | HMAC + استعلام سرور؛ ممیزی تلاش جعلی؛ هیچ تغییری | «rejects a forged callback signature …»، API `esp03.test.ts` |
| callback تکراری یا خارج از ترتیب | gatewayRef یکتا؛ شکست پس از موفقیت نادیده؛ موفقیت پس از شکست → صف تطبیق | «out-of-order callbacks …» |
| کلیک هم‌زمان «پرداخت» | partial unique index پرداخت در جریان | «parallel "pay" clicks …» |
| بازپرداخت جزئی تکراری | کلید idempotency یکتا + بازگرداندن برنده | «a repeated partial refund with the same key …» |
| بازپرداخت‌های هم‌زمان متفاوت | رزرو اتمیک `refundedRial` | «concurrent different refunds cannot over-refund» |
| لغو رویداد | تأیید مستقل؛ تسویه‌ی idempotent | «needs an independent approval; removes registrations …» (AC-19) |
| نقش مالی بدون اختیار داوری | ACL: `finance_officer` مجوز تصمیم ثبت‌نام و داوری ندارد | «a finance officer has no refereeing …» |
| تغییر تیم پس از تأیید | snapshot مشارکت تغییرناپذیر | «team registration needs member confirmation; snapshots survive …» (AC-02) |
| تزریق فرمول در CSV | پیشوند `'` و BOM | `csv.test.ts`، «CSV export neutralises …» |
| بازگشت به دامنه‌ی بیرونی | returnUrl فقط روی origin وب | API `esp03.test.ts` |
| دور زدن دروازه‌ی انتشار | `transitions` برای publish/cancel بسته | API `esp03.test.ts` |
| دو رشته با ظرفیت مستقل | شمارنده‌ی جدا برای هر رشته/سهمیه | «AC-01 …» |
| خرید هم‌زمان آخرین بلیت‌ها | `$inc` شرطی روی شمارنده‌ی بلیت؛ کد بلیت یک‌بارمصرف | `commerce.test.ts` «capacity is atomic, a paid ticket admits once …» |
| خرید هم‌زمان دو اشتراک یکسان | partial unique index `uniq_open_subscription` (مهاجرت 0007) | «activate on payment, renew before the end …» |
| تسویه‌ی تکراری یا بیش از مانده | کلید idempotency + قفل شمارنده + بررسی مانده در تراکنش | «settles at most the owed balance, once per key …» |
| شروع مرحله‌ی وابسته پیش از مبدأ | `canStartStage` + استثنا فقط با تأیید مستقل `stage.start_exception` | `events.test.ts` «a dependent stage waits for its source …» |
| سهمیه‌ی صعود بدون نتیجه‌ی نهایی یا تکراری | نتیجه‌ی نهایی منشأ لازم؛ unique index روی دارنده | «a stage slot needs a final result …» |
| انتشار زمان‌بندی‌شده | همان دروازه‌ی انتشار با نقش `system`؛ زمان‌بندی فقط توسط دارنده‌ی `event.publish` | «scheduled publication runs through the same gate when due» |

## ۵. تطبیق (reconciliation)

`startEsp03Jobs` (worker، هر ۳۰ ثانیه) این کارها را انجام می‌دهد:
- انقضای رزروها و آزادسازی دقیقاً یک‌باره؛
- ارتقای FIFO فهرست انتظار؛
- استعلام مجدد از درگاه برای پرداخت‌های `unknown`، `awaiting_gateway` منقضی و `failed` در ۲۴ ساعت اخیر؛
- تکرار بازپرداخت‌های `sent`؛
- انتشار زمان‌بندی‌شده؛
- هر ۱ ساعت، تمدید و انقضای اشتراک‌ها.

پولِ بدون تکلیف همیشه در `GET /finance/reconciliation` و صفحه‌ی `/finance` دیده می‌شود. چهار صف وجود دارد:
- پرداخت‌های نامعلوم؛
- تأیید درگاه پس از شکست (`provider_verified_after_failure`)؛
- بازپرداخت‌های باز (`requested`، `awaiting_approval`، `sent`، `failed`)؛
- ثبت‌نام‌های پرداخت‌شده‌ی بدون ظرفیت.

اجرای دستی: `POST /finance/reconciliation/run` (`finance.read`).

## ۶. محدودیت‌های صادقانه

- **درگاه:** درگاه پرداخت ایرانی انتخاب نشده است. `DevGatewayAdapter` شبیه‌ساز Mongo-محور و برچسب‌دار «TEST ONLY» است و صفحه‌ی `/dev/gateway/*` فقط خارج از production ثبت می‌شود. production بدون آداپتر واقعی پیکربندی‌نشده می‌ماند و هرگز به شبیه‌ساز برنمی‌گردد.
- **آزادسازی جایزه:** به قرارداد نتیجه‌ی نهایی ESP-05 وابسته است.
- **اعلان‌ها:** کانال‌های پیامک و ایمیل در ESP-06 تکمیل می‌شوند. اکنون فقط کانال realtime `notifications` وجود دارد.
- **OpenAPI:** طرح پاسخ چند مسیر هنوز `record<string, unknown>` است.
