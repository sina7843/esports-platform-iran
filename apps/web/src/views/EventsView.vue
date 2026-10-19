<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type EventSummary } from '../api/client';
import DataState from '../components/DataState.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';
import type { ApiClientError } from '../api/client';

const items = ref<EventSummary[]>([]);
const next = ref<string | null>(null);
const { data, loading, error, load } = useLoad(() => api.events());
watch(data, (d) => {
  if (d) {
    items.value = d.items;
    next.value = d.page.nextCursor;
  }
});

const moreBusy = ref(false);
const moreError = ref<ApiClientError | null>(null);
async function more() {
  if (!next.value) return;
  moreBusy.value = true;
  moreError.value = null;
  try {
    const page = await api.events(next.value);
    items.value = [...items.value, ...page.items];
    next.value = page.page.nextCursor;
  } catch (e) {
    moreError.value = toClientError(e);
  } finally {
    moreBusy.value = false;
  }
}

const columns = () => [
  { key: 'name', label: t('events.name') },
  { key: 'state', label: t('events.state') },
  { key: 'startsAt', label: t('events.startsAt') },
  { key: 'endsAt', label: t('events.endsAt') },
];
</script>

<template>
  <PageHeader :title="t('events.title')" />
  <DataState :loading="loading" :error="error" :empty="!!data && items.length === 0" @retry="load">
    <DataTable :caption="t('events.title')" :columns="columns()" :rows="items" row-key="id" row-header="name">
      <template #cell-name="{ row }">
        <RouterLink :to="`/events/${(row as EventSummary).id}`"><bdi>{{ (row as EventSummary).name }}</bdi></RouterLink>
      </template>
      <template #cell-state="{ row }"><StatusBadge :state="(row as EventSummary).state" /></template>
      <template #cell-startsAt="{ row }"><JalaliDate :iso="(row as EventSummary).startsAt" :time-zone="(row as EventSummary).timeZone" /></template>
      <template #cell-endsAt="{ row }"><JalaliDate :iso="(row as EventSummary).endsAt" :time-zone="(row as EventSummary).timeZone" /></template>
    </DataTable>
    <div class="more stack">
      <ErrorNote :error="moreError" />
      <button v-if="next" type="button" class="btn" :disabled="moreBusy" @click="more">{{ moreBusy ? t('state.loading') : t('events.more') }}</button>
    </div>
  </DataState>
</template>

<style scoped>
.more { margin-block-start: var(--sp-4); }
</style>
