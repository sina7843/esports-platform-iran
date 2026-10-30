<script setup lang="ts">
import { provide } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { QLinkKey } from '@esp/ui';
import AppShell from './components/AppShell.vue';

/** @esp/ui links navigate in-app through the router. Displays (hall, broadcast overlays) render bare, without the site chrome. */
provide(QLinkKey, RouterLink);
const route = useRoute();
</script>

<template>
  <div v-if="route.meta.layout === 'bare'" class="k-bare">
    <main id="main" class="k-main" tabindex="-1"><RouterView /></main>
  </div>
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>
