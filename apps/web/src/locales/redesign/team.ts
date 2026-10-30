/** New copy for the redesigned `team` page (docs/redesign/03-specs/team.md § Copy). */
export const fa = {
  'tm.record': "کارنامه",
  'tm.recordDesc': "فقط از نتایج رسمی نهایی ساخته می‌شود.",
  'tm.played': "بازی رسمی",
  'tm.wins': "برد",
  'tm.losses': "باخت",
  'tm.draws': "تساوی",
  'tm.verify': "استعلام",
  'tm.kickBody': "عضو از ترکیب فعلی تیم خارج می‌شود؛ سابقه‌اش در تیم باقی می‌ماند.",
  'tm.leaveBody': "از ترکیب این تیم خارج می‌شوید.",
  'tm.cancel': "انصراف",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'tm.record': "Record",
  'tm.recordDesc': "Built from final official results only.",
  'tm.played': "Official games",
  'tm.wins': "Wins",
  'tm.losses': "Losses",
  'tm.draws': "Draws",
  'tm.verify': "Verify",
  'tm.kickBody': "The member leaves the current roster; their history with the team is kept.",
  'tm.leaveBody': "You will leave this team’s roster.",
  'tm.cancel': "Cancel",
};
