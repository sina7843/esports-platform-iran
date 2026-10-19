<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import { t } from '../i18n';

const route = useRoute();
const title = computed(() => (route.meta.title ? t(route.meta.title) : ''));
</script>

<template>
  <PageHeader :title="title" />
  <!-- Honest placeholder: the domain feature and its data arrive in a later stage. -->
  <div class="state" data-state="later">
    <p class="msg">{{ t('state.stageLater') }}</p>
    <p class="muted">{{ t('state.stageLaterHint') }}</p>
  </div>
</template>

<style scoped>
.state { padding: var(--sp-7) var(--sp-4); text-align: center; border: 1px dashed var(--border); border-radius: var(--radius-lg); }
.msg { font-weight: 700; font-size: var(--fs-lg); margin: 0 0 var(--sp-2); }
</style>
