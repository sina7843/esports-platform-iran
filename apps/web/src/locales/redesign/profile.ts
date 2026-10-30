/** New copy for the redesigned `profile` page (docs/redesign/03-specs/profile.md § Copy). */
export const fa = {
  'pf.desc': "اطلاعات عمومی، حریم خصوصی هر فیلد، بازی‌ها و شناسه‌های بازی.",
  'pf.identity': "مشخصات",
  'pf.privacyDesc': "برای هر فیلد مشخص کنید چه کسی آن را ببیند.",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'pf.desc': "Public details, per-field privacy, games and game IDs.",
  'pf.identity': "Details",
  'pf.privacyDesc': "Choose who can see each field.",
};
