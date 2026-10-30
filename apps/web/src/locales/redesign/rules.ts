/** New copy for the redesigned `rules` page (docs/redesign/03-specs/rules.md § Copy). */
export const fa = {
  'rl.state': "وضعیت بسته",
  'rl.testOnly': "فقط آزمایشی",
} satisfies Record<string, string>;

export const en: Record<keyof typeof fa, string> = {
  'rl.state': "Package state",
  'rl.testOnly': "Test only",
};
