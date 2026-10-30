/** New copy for the redesigned `finance` page (docs/redesign/03-specs/finance.md § Copy). */
export const fa = {
  'fin.catEmpty': "در این دسته موردی نیست.",
  'fin.colAmount': "مبلغ (تومان)",
  'fin.colId': "شناسه",
  'fin.colState': "وضعیت",
  'fin.colTime': "زمان",
  'fin.done': "انجام شد.",
  'fin.feePct': "{p}٪",
  'fin.fromQueue': "از صف بارگذاری‌شده",
  'fin.pricesTab': "قیمت و تخفیف",
  'fin.queueHint': "پولی که تکلیفش روشن نیست اینجا می‌ماند تا یکی از اقدام‌ها انجام شود. شمارش‌ها فقط از همین صف است.",
  'fin.reconDone': "تطبیق اجرا شد.",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'fin.catEmpty': "Nothing in this category.",
  'fin.colAmount': "Amount (toman)",
  'fin.colId': "ID",
  'fin.colState': "Status",
  'fin.colTime': "Time",
  'fin.done': "Done.",
  'fin.feePct': "{p}%",
  'fin.fromQueue': "From the loaded queue",
  'fin.pricesTab': "Prices & discounts",
  'fin.queueHint': "Money without a disposition stays here until an action is taken. Counts come from this queue only.",
  'fin.reconDone': "Reconciliation ran.",
};
