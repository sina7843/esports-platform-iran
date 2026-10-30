/** New copy for the redesigned `match` page (docs/redesign/03-specs/match.md § Copy). */
export const fa = {
  'room.eyebrow': "اتاق مسابقه",
  'room.tbd': "نامشخص",
  'room.rosters': "ترکیب‌ها",
  'room.about': "درباره‌ی این مسابقه",
  'room.lobbyTitle': "اطلاعات لابی (خصوصی)",
  'room.privateGuest': "بخش خصوصی شرکت‌کنندگان",
  'room.privateGuestBody': "آمادگی، گفتگو، اطلاعات لابی و ثبت نتیجه فقط برای دو طرف و داوران نمایش داده می‌شود.",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'room.eyebrow': "Match room",
  'room.tbd': "TBD",
  'room.rosters': "Rosters",
  'room.about': "About this match",
  'room.lobbyTitle': "Lobby details (private)",
  'room.privateGuest': "Participants’ private area",
  'room.privateGuestBody': "Readiness, chat, lobby details and result entry are shown only to the two sides and officials.",
};
