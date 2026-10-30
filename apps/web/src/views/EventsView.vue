<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { QButton, QContainer, QDataState, QEmptyState, QEventCard, QFilterBar, QPageHeader, QPagination, fa, formatJalali } from '@esp/ui';
import { api, type ApiClientError, type EventSummary } from '../api/client';
import { toClientError } from '../errors';
import { stateLabel, t } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/**
 * Spec docs/redesign/03-specs/events.md — the public calendar. Today's EventSummary has no game/mode/city/capacity/fee
 * (backlog 0.1), so those EventCard props and filters are omitted until the API adds them.
 */
const query = ref('');
const values = ref<Record<string, string>>({ state: '' });
const view = ref('cards');
const items = ref<EventSummary[]>([]);
const next = ref<string | null>(null);
const { data, loading, error, load } = useLoad(() => api.events());
watch(data, (d) => {
  if (d) {
    items.value = d.items;
    next.value = d.page.nextCursor;
  }
});
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error, empty: () => !!data.value && !items.value.length });

const states = computed(() => [...new Set(items.value.map((e) => e.state))]);
const filters = computed(() => [{ key: 'state', label: t('ev.status'), allLabel: t('ev.allStatus'), options: states.value.map((s) => ({ value: s, label: stateLabel(s) })) }]);
const filtered = computed(() => items.value.filter((e) => (!values.value.state || e.state === values.value.state) && e.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const any = computed(() => !!values.value.state || !!query.value.trim());
function clear() {
  values.value = { state: '' };
  query.value = '';
}
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
const status = (s: string) => (s === 'active' ? 'live' : s) as never;
</script>

<template>
  <QContainer>
    <div class="k-stack p-events">
      <QPageHeader :breadcrumb="[{ label: t('ev.home'), href: '/' }, { label: t('ev.title') }]" :eyebrow="t('ev.eyebrow')" :title="t('ev.title')" :description="t('events.leadNew')">
        <template v-if="session.me" #actions><QButton variant="ghost" icon="ticket" href="/account/registrations">{{ t('ev.mine') }}</QButton></template>
      </QPageHeader>
      <QFilterBar
        v-model:query="query" v-model:values="values" v-model:view="view" :aria-label="t('ev.filters')" :search-label="t('ev.search')" :search-placeholder="t('ev.searchPh')"
        :filters="filters" :views="[{ value: 'cards', label: t('ev.cards'), icon: 'grid' }, { value: 'list', label: t('ev.list'), icon: 'list' }]" :view-label="t('ev.viewLabel')"
        :clear-label="t('ev.clear')" :result-label="ds.state.value === 'content' ? t('ev.count', { n: fa(filtered.length) }) : undefined" @clear="clear"
      />
      <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="cards" icon="trophy" :empty-title="t('ev.empty')" @retry="load" />
      <QEmptyState v-else-if="!filtered.length" compact icon="search" :title="t('ev.noMatch')">
        <template v-if="any" #action><QButton variant="secondary" @click="clear">{{ t('ev.clear') }}</QButton></template>
      </QEmptyState>
      <div v-else :class="view === 'list' ? 'k-stack' : 'k-grid'">
        <QEventCard
          v-for="e in filtered" :key="e.id" :href="`/events/${encodeURIComponent(e.id)}`" :title="e.name" :layout="view === 'list' ? 'list' : 'card'"
          :status="status(e.state)" :status-label="stateLabel(e.state)" :date="e.startsAt ? formatJalali(e.startsAt, 'date') : undefined"
        />
      </div>
      <QDataState v-if="moreError" state="error" :request-id="moreError.requestId ?? undefined" @retry="more" />
      <QPagination
        v-if="ds.state.value === 'content' && items.length" mode="cursor" :shown="items.length" :has-more="!!next" :loading="moreBusy"
        :count-label="t('ev.count', { n: fa(items.length) })" :more-label="t('ev.more')" :done-label="t('ev.done')" @more="more"
      />
    </div>
  </QContainer>
</template>

<style scoped>
.p-events { gap: var(--space-7); }
</style>
