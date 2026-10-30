/** New copy for the redesigned `admin-reviews` page (docs/redesign/03-specs/admin-reviews.md § Copy). */
export const fa = {
  'rv.lead': "همه صف‌های بررسی انسانی در یک جا؛ هر تصمیم دلیل می‌خواهد و ثبت می‌شود.",
  'rv.done': "ثبت شد.",
  'rv.levels': "سطح و نشان",
  'rv.act.start_review': "شروع بررسی",
  'rv.act.request_info': "درخواست اطلاعات",
  'rv.act.approve': "تأیید",
  'rv.act.reject': "رد",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'rv.lead': "Every human-review queue in one place; each decision needs a reason and is audited.",
  'rv.done': "Saved.",
  'rv.levels': "Levels & badges",
  'rv.act.start_review': "Start review",
  'rv.act.request_info': "Request info",
  'rv.act.approve': "Approve",
  'rv.act.reject': "Reject",
};
