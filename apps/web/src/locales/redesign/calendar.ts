/** New copy for the redesigned `calendar` page (docs/redesign/03-specs/calendar.md § Copy). */
export const fa = {
  'cl.empty': "مسابقه‌ای در تقویم شما نیست.",
  'cl.sent': "درخواست تغییر زمان ارسال شد.",
  'cl.agreed': "موافقت ثبت شد.",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'cl.empty': "No matches in your calendar.",
  'cl.sent': "Reschedule request sent.",
  'cl.agreed': "Agreement recorded.",
};
