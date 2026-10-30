/** New copy for the redesigned `my-teams` page (docs/redesign/03-specs/my-teams.md § Copy). */
export const fa = {
  'mt.desc': "تیم‌هایی که عضوشان هستید، دعوت‌ها، انتقال مالکیت و درخواست‌های همکاری.",
  'mt.none': "هنوز عضو تیمی نیستید.",
  'mt.find': "یافتن تیم",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'mt.desc': "Your teams, invitations, ownership transfers and applications.",
  'mt.none': "You are not in a team yet.",
  'mt.find': "Find a team",
};
