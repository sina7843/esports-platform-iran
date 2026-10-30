/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // two workers: DOM workers abort (exit 134) when the dev machine runs low on memory
  test: { environment: 'happy-dom', include: ['src/**/*.test.ts'], maxWorkers: 2 },
});
