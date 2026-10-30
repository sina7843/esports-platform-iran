/** New copy for the redesigned `search` page (docs/redesign/03-specs/search.md § Copy). */
export const fa = {
  'sr.start': "چیزی بنویسید تا جست‌وجو کنیم.",
  'sr.noneBody': "واژه‌ی دیگری را امتحان کنید یا فیلترها را کم کنید.",
  'sr.count': "{n} نتیجه",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'sr.start': "Type something to search.",
  'sr.noneBody': "Try another word or fewer filters.",
  'sr.count': "{n} results",
};
