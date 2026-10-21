<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { esp07 as esp07Api } from '../api/esp07';
import DataState from '../components/DataState.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/** Public, versioned legal texts (terms, privacy, marketing consent, retention policy). Plain text only. */
const esp07: typeof esp07Api = esp07Api;
const route = useRoute();
const kind = computed(() => String(route.params['kind']));
const { data, loading, error, load } = useLoad(() => esp07.legal(kind.value));
</script>

<template>
  <PageHeader :title="t(`a7.legal.${kind}` as never)" />
  <DataState :loading="loading" :error="error" :empty="data === null && !loading" @retry="load">
    <article v-if="data" class="card stack">
      <h2><bdi>{{ data.title }}</bdi></h2>
      <p class="muted small">{{ t('a7.legal.version', { v: num(data.version) }) }} · <JalaliDate :iso="data.effectiveAt" format="date" /></p>
      <div class="body" dir="auto">{{ data.body }}</div>
    </article>
  </DataState>
</template>

<style scoped>
.body { white-space: pre-wrap; line-height: 1.9; max-inline-size: 70ch; }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
