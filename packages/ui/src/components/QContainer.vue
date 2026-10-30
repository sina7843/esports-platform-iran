<script setup lang="ts">
/** Kit layout helper: the page container (content-max, side padding space-7 / space-4 on phones). `wide` = 1440px. */
defineProps<{ wide?: boolean }>();
</script>

<template>
  <div :class="['k-container', { 'k-container--wide': wide }]"><slot /></div>
</template>
