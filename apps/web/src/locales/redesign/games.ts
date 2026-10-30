/** New copy for the redesigned `games` page (docs/redesign/03-specs/games.md § Copy). */
export const fa = {
  'gm.state': "وضعیت پشتیبانی",
  'gm.allStates': "همه وضعیت‌ها",
  'gm.search': "جست‌وجوی بازی",
  'gm.count': "{n} بازی",
  'gm.empty': "هنوز بازی‌ای در فهرست نیست.",
  'gm.noMatch': "بازی‌ای با این فیلتر پیدا نشد.",
  'gm.created': "بازی به فهرست اضافه شد.",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'gm.state': "Support status",
  'gm.allStates': "All statuses",
  'gm.search': "Search games",
  'gm.count': "{n} games",
  'gm.empty': "No games in the catalogue yet.",
  'gm.noMatch': "No game matches this filter.",
  'gm.created': "Game added to the catalogue.",
};
