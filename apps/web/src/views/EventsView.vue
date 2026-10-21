<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type EventSummary } from '../api/client';
import Icon from '../components/Icon.vue';
import DataState from '../components/DataState.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, stateLabel, t } from '../i18n';
import { useLoad } from '../useLoad';
import type { ApiClientError } from '../api/client';

const query = ref('');
const state = ref('');
const view = ref<'cards' | 'list'>('cards');
const items = ref<EventSummary[]>([]);
const next = ref<string | null>(null);
const { data, loading, error, load } = useLoad(() => api.events());
watch(data, (d) => {
  if (d) {
    items.value = d.items;
    next.value = d.page.nextCursor;
  }
});

const states = computed(() => [...new Set(items.value.map(e => e.state))]);
const filtered = computed(() => items.value.filter(e => (!state.value || e.state === state.value) && e.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
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
  <PageHeader :title="t('events.title')" :lead="t('events.leadNew')" />
  <div class="event-toolbar">
    <div class="event-search"><Icon name="search" :size="20" /><label for="event-search" class="sr-only">{{ t('events.searchNew') }}</label><input id="event-search" v-model="query" type="search" class="input" :placeholder="t('events.searchNew')" /></div>
    <label class="sr-only" for="event-state">{{ t('events.state') }}</label><select id="event-state" v-model="state" class="input event-state"><option value="">{{ t('events.allNew') }}</option><option v-for="value in states" :key="value" :value="value">{{ stateLabel(value) }}</option></select>
    <div class="view-toggle"><button type="button" class="btn" :aria-pressed="view === 'cards'" @click="view = 'cards'"><Icon name="dashboard" :size="16" />{{ t('events.cardsNew') }}</button><button type="button" class="btn" :aria-pressed="view === 'list'" @click="view = 'list'"><Icon name="menu" :size="16" />{{ t('events.listNew') }}</button></div>
  </div>
  <DataState :loading="loading" :error="error" :empty="!!data && items.length === 0" @retry="load">
    <p v-if="items.length && !filtered.length" class="card muted">{{ t('events.noFilter') }}</p>
    <div v-if="view === 'cards'" class="event-grid">
      <article v-for="(event, index) in filtered" :key="event.id" class="event-card">
        <div class="event-art" aria-hidden="true"><span class="event-number">{{ num(index + 1) }}</span><Icon name="trophy" :size="64" /><span class="art-line" /></div>
        <div class="event-body"><StatusBadge :state="event.state" /><h2><RouterLink :to="`/events/${event.id}`"><bdi>{{ event.name }}</bdi></RouterLink></h2><dl><div><dt>{{ t('events.startsAt') }}</dt><dd><JalaliDate :iso="event.startsAt" :time-zone="event.timeZone" /></dd></div><div><dt>{{ t('events.endsAt') }}</dt><dd><JalaliDate :iso="event.endsAt" :time-zone="event.timeZone" /></dd></div></dl><RouterLink :to="`/events/${event.id}`" class="btn event-link">{{ t('events.detailsNew') }}<Icon name="forward" :size="18" /></RouterLink></div>
      </article>
    </div>
    <DataTable v-else-if="filtered.length" :caption="t('events.title')" :columns="columns()" :rows="filtered" row-key="id" row-header="name">
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
.event-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); margin-block-end: var(--sp-5); padding: var(--sp-4); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
.event-search { position: relative; flex: 1 1 18rem; }
.event-search > svg { position: absolute; inset-inline-start: var(--sp-3); inset-block-start: 14px; color: var(--text-muted); }
.event-search .input { padding-inline-start: var(--sp-7); }
.event-state { inline-size: auto; min-inline-size: 10rem; }
.view-toggle { display: flex; gap: var(--sp-1); }
.view-toggle [aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.event-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr)); gap: var(--sp-5); }
.event-card { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); transition: border-color 200ms; }
.event-card:hover { border-color: var(--accent); }
.event-art { position: relative; display: grid; place-items: center; aspect-ratio: 2 / 1; overflow: hidden; color: var(--accent); background: var(--accent-soft); border-block-end: 1px solid var(--border); }
.event-art > svg { transform: rotate(-12deg); }
.event-number { position: absolute; inset-inline-start: var(--sp-4); inset-block-start: var(--sp-3); font-size: var(--fs-xs); color: var(--text-muted); }
.art-line { position: absolute; inline-size: 70%; block-size: 140%; border: 1px solid var(--border); transform: rotate(30deg); }
.event-body { padding: var(--sp-5); }
h2 { font-size: var(--fs-lg); margin-block: var(--sp-4); }
h2 a { color: var(--text); text-decoration: none; }
dl { display: grid; gap: var(--sp-3); margin: 0 0 var(--sp-5); }
dl > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--sp-2); font-size: var(--fs-xs); } dt { color: var(--text-muted); } dd { margin: 0; }
.event-link { inline-size: 100%; justify-content: space-between; }
@media (max-width: 640px) { .event-state { flex: 1; } .event-toolbar { padding: var(--sp-3); } }
.more { margin-block-start: var(--sp-4); }
</style>
