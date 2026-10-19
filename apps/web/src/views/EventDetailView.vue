<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';
import DataState from '../components/DataState.vue';
import DataTable from '../components/DataTable.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

const route = useRoute();
const id = computed(() => String(route.params.id));
const { data, loading, error, load } = useLoad(() => api.event(id.value));
watch(id, () => void load());

const stageCols = () => [
  { key: 'order', label: '#' },
  { key: 'name', label: t('events.stage') },
  { key: 'format', label: t('events.format') },
  { key: 'state', label: t('events.state') },
];
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <PageHeader :title="data.event.name">
        <template #title><bdi>{{ data.event.name }}</bdi></template>
        <template #actions><StatusBadge :state="data.event.state" /></template>
      </PageHeader>
      <dl class="meta">
        <div><dt>{{ t('events.startsAt') }}</dt><dd><JalaliDate :iso="data.event.startsAt" :time-zone="data.event.timeZone" /></dd></div>
        <div><dt>{{ t('events.endsAt') }}</dt><dd><JalaliDate :iso="data.event.endsAt" :time-zone="data.event.timeZone" /></dd></div>
        <div><dt>{{ t('events.timeZone') }}</dt><dd><bdi class="ltr">{{ data.event.timeZone }}</bdi></dd></div>
      </dl>

      <h2>{{ t('events.disciplines') }}</h2>
      <p v-if="data.disciplines.length === 0" class="muted">{{ t('events.noDisciplines') }}</p>
      <section v-for="d in data.disciplines" :key="d.id" class="card disc">
        <h3><bdi>{{ d.name }}</bdi> <span class="muted"><bdi class="ltr">{{ d.platform }} / {{ d.mode }}</bdi></span></h3>
        <DataTable :caption="d.name" :columns="stageCols()" :rows="d.stages" row-key="id" row-header="name">
          <template #cell-state="{ row }"><StatusBadge :state="(row as { state: string }).state" /></template>
        </DataTable>
      </section>
      <p class="muted">{{ t('events.matchesLater') }}</p>
    </template>
  </DataState>
</template>

<style scoped>
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--sp-4); margin: 0 0 var(--sp-6); }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; }
.disc { margin-block-end: var(--sp-4); }
</style>
