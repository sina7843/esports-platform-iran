/** New copy for the redesigned `results-admin` page (docs/redesign/03-specs/results-admin.md § Copy). */
export const fa = {
  'res.chkStages': "همه مراحل تمام شده‌اند",
  'res.chkMatches': "همه مسابقه‌ها قطعی شده‌اند",
  'res.chkCases': "پرونده باز نمانده",
  'res.chkCorrections': "اصلاح ناتمام نمانده",
  'res.noOfficials': "هنوز داوری منصوب نشده است.",
  'res.previewFirst': "مسابقه و برنده را انتخاب کنید و «پیش‌نمایش اثر» را بزنید.",
  'res.removeBody': "این شخص دیگر داور این رویداد یا مسابقه نخواهد بود.",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'res.chkStages': "All stages finished",
  'res.chkMatches': "All matches final",
  'res.chkCases': "No open cases",
  'res.chkCorrections': "No unfinished corrections",
  'res.noOfficials': "No officials appointed yet.",
  'res.previewFirst': "Pick the match and winner, then preview the impact.",
  'res.removeBody': "This person will no longer officiate this event or match.",
};
