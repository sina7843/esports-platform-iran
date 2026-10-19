# سیستم طراحی (web shell)

## توکن‌ها
فایل `apps/web/src/styles/tokens.css`: یک رنگ تأکید (سبزآبی)، مقیاس خنثی، رنگ‌های معنایی (ok/warn/danger/info)، فاصله‌ها `--sp-1..7`، شعاع‌ها، مقیاس تایپوگرافی `--fs-xs..2xl` و ارتفاع خط ۱٫۸۵ برای متن فارسی.
تم روشن پیش‌فرض است؛ `[data-theme="dark"]` تم تیره را اعمال می‌کند. در حالت «سیستم» ویژگی `data-theme` حذف می‌شود و `prefers-color-scheme` تصمیم می‌گیرد.

## تایپوگرافی
فونت Vazirmatn فقط از فایل‌های محلی بسته‌ی `vazirmatn` (بدون CDN و Google Fonts). ارقام با تنظیم کاربر نمایش داده می‌شوند و `font-variant-numeric: tabular-nums` برای اعداد (`.num`).

## RTL و BiDi
- `<html lang dir>` با زبان تنظیم می‌شود: `fa` به `rtl`، `en` به `ltr`.
- از ویژگی‌های منطقی CSS (`inline-start`، `margin-inline`…) استفاده شده تا چیدمان خودکار جهت عوض کند؛ نوار کناری سمت راست در فارسی.
- متن مختلط: `<bdi>`، `.bidi` و `.ltr` (`unicode-bidi: isolate`)؛ سلول‌های جدول `dir="auto"`؛ شناسه‌ها، نام‌های انگلیسی، نسخه‌ها و آدرس‌ها در `<bdi class="ltr">` یا `<code>`.
- ورودی‌های عددی `dir="ltr"` با تراز مطابق جهت صفحه.

## ارقام، تاریخ، پول
- ورودی: ارقام فارسی، عربی-هندی و لاتین با `normalizeDigits` یکسان به ASCII تبدیل می‌شوند (`DigitInput`)؛ مدل همیشه ASCII است.
- نمایش: ارقام فارسی/لاتین طبق تنظیمات؛ در زبان انگلیسی همیشه لاتین.
- تاریخ: `JalaliDate` با `formatInstant` و منطقه‌ی `Asia/Tehran`؛ ذخیره‌سازی UTC.
- پول: مبلغ به ریال صحیح؛ `MoneyLabel` با `formatToman` برچسب «تومان» را نشان می‌دهد.

## تم و دسترس‌پذیری (WCAG 2.2 AA)
چک‌لیست:
- [x] لینک «پرش به محتوا» و فوکوس روی `<main>` پس از هر ناوبری
- [x] حلقه‌ی فوکوس 3px در `:focus-visible`
- [x] برچسب برای تمام فیلدها، `aria-describedby` برای راهنما/خطا، `role="alert"` برای خطا
- [x] جدول با `<caption>` و `<th scope>`؛ در موبایل به‌صورت کارت‌های انباشته
- [x] وضعیت‌ها فقط با رنگ منتقل نمی‌شوند (متن برچسب)
- [x] حرکت کاهش‌یافته با `prefers-reduced-motion`
- [x] آیکن‌ها SVG درون‌خطی با `aria-hidden`
- [x] هدف لمسی حداقل ۲٫۵ rem برای دکمه‌های اصلی
- [ ] بررسی دستی کنتراست و صفحه‌خوان (انجام نشده؛ نیازمند مرورگر)

## ریسپانسیو
زیر ۹۰۰px نوار کناری به کشو تبدیل می‌شود (دکمه‌ی منو، Esc و پس‌زمینه برای بستن). زیر ۶۴۰px جدول‌ها انباشته می‌شوند.

## فهرست مؤلفه‌ها
`AppShell`، `TopBar` (چیپ اتصال، تم/زبان/ارقام)، `SideNav`، `PageHeader`، `DataState` (loading/empty/error/forbidden/offline؛ خطای NETWORK به offline و FORBIDDEN/UNAUTHENTICATED به forbidden نگاشت می‌شود)، `DataTable`، `FormField`، `DigitInput`، `JalaliDate`، `MoneyLabel`، `StatusBadge`، `ErrorNote`، `Icon`.

## i18n
`src/i18n.ts` با `t(key)` واکنشی؛ پیام‌ها در `locales/fa.ts` و `locales/en.ts` (کلیدهای انگلیسی از نوع فارسی اجباری می‌شوند). همه‌ی `ErrorCodes` و حالت‌ها (`statesFa` از contracts) پوشش دارند.
