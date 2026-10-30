/** New copy for the redesigned `offline` page (docs/redesign/03-specs/offline.md § Copy). */
export const fa = {
  'off.noConnection': 'بدون اتصال',
  'off.checking': 'در حال بررسی اتصال…',
  'off.last': 'آخرین اتصال {time}',
  'off.title': 'آفلاین هستید',
  'off.body': 'اتصال اینترنت برقرار نیست، برای همین این صفحه باز نشد. وقتی اتصال برگردد، صفحه خودش دوباره بارگذاری می\u200cشود.',
  'off.retry': 'تلاش دوباره',
  'off.back': 'صفحه\u200cی قبل',
  'off.badge': 'آفلاین',
  'off.helpWifi': 'اتصال وای\u200cفای یا داده\u200cی همراه را بررسی کنید.',
  'off.helpVpn': 'اگر از فیلترشکن یا پروکسی استفاده می\u200cکنید، یک بار خاموش و روشنش کنید.',
  'off.helpMatch': 'در اتاق مسابقه هستید؟ به داور اطلاع دهید؛ قطعی اتصال طبق قوانین رویداد بررسی می\u200cشود.',
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'off.noConnection': 'No connection',
  'off.checking': 'Checking connection…',
  'off.last': 'Last connected {time}',
  'off.title': 'You are offline',
  'off.body': 'There is no internet connection, so this page could not open. When the connection comes back, the page reloads by itself.',
  'off.retry': 'Try again',
  'off.back': 'Go back',
  'off.badge': 'Offline',
  'off.helpWifi': 'Check your Wi-Fi or mobile data.',
  'off.helpVpn': 'If you use a VPN or proxy, turn it off and on again.',
  'off.helpMatch': 'In a match room? Tell the referee; disconnections are handled under the event rules.',
};
