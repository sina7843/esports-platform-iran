/** New copy for the redesigned `organizer-event` page (docs/redesign/03-specs/organizer-event.md § Copy). */
export const fa = {
  'oe.tools': "ابزارهای رویداد",
  'oe.publishGate': "شرایط انتشار",
  'oe.checkinLater': "قفل ترکیب و حضور پس از انتشار رویداد فعال می‌شود.",
  'evm.disciplines': "رشته‌ها و ثبت‌نام",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'oe.tools': "Event tools",
  'oe.publishGate': "Publication gate",
  'oe.checkinLater': "Roster lock and check-in open after the event is published.",
  'evm.disciplines': "Disciplines & registrations",
};
