/** New copy for the redesigned `registrations` page (docs/redesign/03-specs/registrations.md § Copy). */
export const fa = {
  'rg.empty': "هنوز در رویدادی ثبت‌نام نکرده‌اید.",
  'rg.find': "کشف مسابقات",
  'rg.regs': "ثبت‌نام‌ها",
  'rg.pass': "کارت حضور",
  'rg.cancel': "انصراف",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'rg.empty': "You have not registered for any event yet.",
  'rg.find': "Discover events",
  'rg.regs': "Registrations",
  'rg.pass': "Attendance pass",
  'rg.cancel': "Cancel",
};
