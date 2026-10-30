/** New copy for the redesigned `support` page (docs/redesign/03-specs/support.md § Copy). */
export const fa = {
  'su.none': "هنوز تیکتی ندارید.",
  'su.broken': "گزارش پیوند خراب",
  'su.brokenPath': "نشانی:",
  'su.brokenRef': "صفحه‌ی قبلی:",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'su.none': "You have no tickets yet.",
  'su.broken': "Broken link report",
  'su.brokenPath': "Address:",
  'su.brokenRef': "Previous page:",
};
