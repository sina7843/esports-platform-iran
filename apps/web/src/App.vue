<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router';
import AppShell from './components/AppShell.vue';

/** Broadcast overlays (OBS browser sources) render without the site chrome. */
const route = useRoute();
</script>

<template>
  <RouterView v-if="route.meta['bare']" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>
