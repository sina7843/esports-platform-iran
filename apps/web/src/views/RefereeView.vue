<script setup lang="ts">
import { computed, ref } from 'vue';
import { QAlert, QBadge, QButton, QCard, QContainer, QDataState, QDataTable, QEmptyState, QPageHeader, QSection, QStatusBadge, QTextField, formatJalali, type QDataTableColumn } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api, type CaseView } from '../api/esp05';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** REF-001..006 referee desk: my assigned/party cases, an event's case queue and the integrity report queue. */
const esp05: typeof esp05Api = esp05Api;
const { data: mine, loading, error, load } = useLoad(async () => (await esp05.myCases()).items);
const eventId = ref('');
const queue = ref<CaseView[] | null>(null);
const reports = ref<Array<Record<string, unknown>> | null>(null);
const failure = ref<ApiClientError | null>(null);
const note = ref<Record<string, string>>({});
async function loadEvent() {
  failure.value = null;
  try {
    queue.value = (await esp05.eventCases(eventId.value.trim())).items;
    reports.value = (await esp05.integrityQueue(eventId.value.trim()).catch(() => ({ items: [] }))).items;
  } catch (e) {
    failure.value = toClientError(e);
    queue.value = null;
  }
}
async function step(id: string, action: string) {
  failure.value = null;
  try {
    await esp05.integrityStep(id, { action, note: note.value[id] ?? action });
    await loadEvent();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const ds = useDataState({ loading: computed(() => loading.value && !mine.value), error, empty: () => !!mine.value && !mine.value.length });
const cols = computed<QDataTableColumn<CaseView>[]>(() => [
  { key: 'category', header: t('case.category') }, { key: 'assignee', header: t('case.assignee') },
  { key: 'state', header: t('case.state') }, { key: 'filed', header: t('case.filed') },
]);
const filed = (c: CaseView) => (c as unknown as { createdAt: string }).createdAt;
</script>

<template>
  <QContainer>
    <div class="k-stack p-ref">
      <QPageHeader compact :title="t('nav.referee')" :description="t('ref.lead')" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <QSection id="mine" small :title="t('ref.myCases')">
        <QDataState v-if="ds.state.value !== 'content' || !mine" v-bind="ds.props.value" skeleton="rows" icon="gavel" :empty-title="t('ref.noCases')" @retry="load" />
        <QCard v-else padding="none">
          <ul class="p-ref-list">
            <li v-for="c in mine" :key="c._id" class="p-ref-row">
              <RouterLink :to="`/cases/${c._id}`" class="p-ref-link"><strong>{{ t(`case.cat.${c.category}` as never) }}</strong><span dir="auto">{{ c.claim.slice(0, 120) }}</span></RouterLink>
              <span class="k-row"><QBadge tone="neutral">{{ c.role === 'official' ? t('case.roleOfficial') : t('case.roleParty') }}</QBadge><QStatusBadge :state="c.state" machine="dispute" /></span>
            </li>
          </ul>
        </QCard>
      </QSection>

      <QSection id="queue" small :title="t('ref.eventQueue')">
        <QCard>
          <div class="k-stack">
            <form class="p-ref-form" novalidate @submit.prevent="loadEvent">
              <QTextField id="ref-ev" v-model="eventId" :label="t('ref.eventId')" ltr />
              <QButton type="submit" variant="secondary" :disabled="!eventId.trim()">{{ t('ref.load') }}</QButton>
            </form>
            <QEmptyState v-if="queue && !queue.length" compact icon="gavel" :title="t('ref.noCases')" />
            <QDataTable v-if="queue && queue.length" :caption="t('ref.eventQueue')" caption-hidden row-key="_id" row-header="category" :columns="cols" :rows="queue">
              <template #cell-category="{ row }"><RouterLink :to="`/cases/${row._id}`">{{ t(`case.cat.${row.category}` as never) }}</RouterLink></template>
              <template #cell-assignee="{ row }"><bdi class="q-ltr">{{ row.assignee ?? '—' }}</bdi></template>
              <template #cell-state="{ row }"><QStatusBadge :state="row.state" machine="dispute" /></template>
              <template #cell-filed="{ row }">{{ formatJalali(filed(row)) }}</template>
            </QDataTable>
          </div>
        </QCard>
      </QSection>

      <QSection v-if="reports && reports.length" id="integrity" small :title="t('ref.integrity')">
        <div class="k-stack">
          <QCard v-for="r in reports" :key="String(r['_id'])">
            <div class="k-stack">
              <div class="p-ref-head"><strong>{{ t(`intg.cat.${String(r['category'])}` as never) }}</strong><QStatusBadge :state="String(r['state'])" /></div>
              <p class="p-ref-muted" dir="auto">{{ r['description'] }}</p>
              <div class="p-ref-form">
                <QTextField :id="`n-${String(r['_id'])}`" v-model="note[String(r['_id'])]" :label="t('ref.note')" />
                <span class="k-row"><QButton v-for="a in ['triage', 'investigate', 'close']" :key="a" size="sm" variant="secondary" @click="step(String(r['_id']), a)">{{ t(`intg.step.${a}` as never) }}</QButton></span>
              </div>
            </div>
          </QCard>
        </div>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-ref { gap: var(--space-7); }
.p-ref-list { margin: 0; padding: 0; list-style: none; }
.p-ref-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-5); border-block-end: 1px solid var(--line); }
.p-ref-link { display: flex; flex-direction: column; gap: 2px; color: var(--ink); text-decoration: none; min-width: 0; }
.p-ref-link span { color: var(--ink-muted); font-size: 13px; }
.p-ref-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
.p-ref-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-ref-muted { margin: 0; color: var(--ink-muted); font-size: 14px; }
@media (max-width: 640px) { .p-ref-form { grid-template-columns: minmax(0, 1fr); } }
</style>
