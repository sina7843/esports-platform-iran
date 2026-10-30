/** New copy for the redesigned `admin-integrations` page (docs/redesign/03-specs/admin-integrations.md § Copy). */
export const fa = {
  'ai.revokeBody': "دسترسی این مشتری API فوراً قطع می‌شود و قابل بازگشت نیست.",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'ai.revokeBody': "This API client loses access immediately. This cannot be undone.",
};
