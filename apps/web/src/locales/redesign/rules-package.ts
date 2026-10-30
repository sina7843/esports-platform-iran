/** New copy for the redesigned `rules-package` page (docs/redesign/03-specs/rules-package.md § Copy). */
export const fa = {
  'rp.clauseId': "کلید",
  'rp.kind': "نوع",
  'rp.value': "مقدار",
  'rp.newer': "نسخه‌ی جدیدتر",
  'rp.submit': "ارسال برای بررسی",
  'rp.toDraft': "بازگشت به پیش‌نویس",
  'rp.publish': "انتشار",
  'rp.withdraw': "پس گرفتن بسته",
  'rp.withdrawTitle': "این بسته پس گرفته شود؟",
  'rp.withdrawBody': "رویدادهایی که این نسخه را پذیرفته‌اند همان نسخه را نگه می‌دارند؛ برای رویدادهای تازه دیگر قابل انتخاب نیست.",
  'rp.cancel': "انصراف",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'rp.clauseId': "Key",
  'rp.kind': "Kind",
  'rp.value': "Value",
  'rp.newer': "Newer version",
  'rp.submit': "Submit for review",
  'rp.toDraft': "Return to draft",
  'rp.publish': "Publish",
  'rp.withdraw': "Withdraw package",
  'rp.withdrawTitle': "Withdraw this package?",
  'rp.withdrawBody': "Events that accepted this version keep it; it can no longer be chosen for new events.",
  'rp.cancel': "Cancel",
};
