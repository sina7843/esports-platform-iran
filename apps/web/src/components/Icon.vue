<script setup lang="ts">
const paths = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18v.5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  'wifi-off': 'M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5v.5M3 3l18 18',
  inbox: 'M3 13l3-8h12l3 8v6H3v-6zM3 13h5l1 3h6l1-3h5',
  loader: 'M12 3a9 9 0 109 9',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  refresh: 'M20 11a8 8 0 10-2 6M20 4v7h-7',
  chevron: 'M9 6l6 6-6 6',
  trophy: 'M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3M12 14v4M8 21h8',
} as const;
export type IconName = keyof typeof paths;
defineProps<{ name: IconName; size?: number }>();
</script>

<template>
  <svg :class="['icon', { spin: name === 'loader' }]" :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[name]" />
  </svg>
</template>

<style scoped>
.icon { flex: none; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
