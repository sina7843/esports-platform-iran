import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'docs/**', 'tools/**', 'prompts/**', '.claude/**', '.esports-backups/**', 'data/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'], sourceType: 'module' } },
    rules: { 'vue/multi-word-component-names': 'off', 'vue/max-attributes-per-line': 'off', 'vue/singleline-html-element-content-newline': 'off', 'vue/html-self-closing': 'off', 'vue/html-indent': 'off', 'vue/attributes-order': 'off', 'vue/first-attribute-linebreak': 'off', 'vue/html-closing-bracket-newline': 'off', 'vue/multiline-html-element-content-newline': 'off' },
  },
  {
    files: ['**/*.{ts,vue,js,mjs}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // TypeScript (tsc / vue-tsc) already reports undefined identifiers with real lib types; per typescript-eslint guidance.
      'no-undef': 'off',
      'no-console': 'off',
    },
  },
);
