/** New copy for the redesigned `security` page (docs/redesign/03-specs/security.md § Copy). */
export const fa = {
  'sc.desc': "ورود دومرحله‌ای، دستگاه‌ها، دریافت داده‌ها و حذف حساب.",
  'sc.qr': "کد QR برای افزودن به برنامه‌ی احراز هویت",
  'sc.copy': "کپی",
  'sc.devices': "دستگاه‌ها",
  'sc.sessions': "نشست‌های فعال",
  'sc.data': "داده‌های من",
  'sc.cancel': "انصراف",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'sc.desc': "Two-step sign-in, devices, data export and account deletion.",
  'sc.qr': "QR code to add to your authenticator app",
  'sc.copy': "Copy",
  'sc.devices': "Devices",
  'sc.sessions': "Active sessions",
  'sc.data': "My data",
  'sc.cancel': "Cancel",
};
