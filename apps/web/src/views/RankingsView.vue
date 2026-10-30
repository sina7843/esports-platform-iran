<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  QBadge, QButton, QCard, QContainer, QDataState, QDataTable, QEmptyState, QFilterBar, QLeaderboardRow, QPageHeader, QPagination, QTabs,
  fa, formatJalali, isRtl, type QDataTableColumn,
} from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp05, type Leaderboard, type RatingSystem } from '../api/esp05';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/**
 * Spec docs/redesign/03-specs/rankings.md — RANK-003/006/007 public leaderboards per published rating system, region and
 * time-window filters. A system without the competition owner's approval is always labelled «داخلی / تأییدنشده», never official.
 */
type Row = Leaderboard['rows'][number];
const PAGE = 50;
const { data: systems, loading, error, load } = useLoad(async () => (await esp05.systems()).items);
const sysId = ref('');
const board = ref<Leaderboard | null>(null);
const rows = ref<Row[]>([]);
const boardLoading = ref(false);
const boardError = ref<ApiClientError | null>(null);
const more = ref(false);
const query = ref('');
const values = ref<Record<string, string>>({ province: '', period: '' });
const view = ref('list');

const sysLabel = (s: RatingSystem) => [s.gameId, s.mode, s.platform].filter(Boolean).join(' · ');
const tabs = computed(() => (systems.value ?? []).map((s) => ({ key: s.id, label: sysLabel(s), icon: 'gamepad' as const })));
const system = computed(() => systems.value?.find((s) => s.id === sysId.value) ?? null);
watch(systems, (s) => { if (s?.length && !sysId.value) sysId.value = s[0]!.id; });

function fromDate(period: string): string | undefined {
  const days = period === '90d' ? 90 : period === '30d' ? 30 : 0;
  return days ? new Date(Date.now() - days * 86400000).toISOString() : undefined;
}
async function fetchBoard(append = false) {
  if (!sysId.value) return;
  boardLoading.value = true;
  boardError.value = null;
  try {
    const from = fromDate(values.value.period ?? '');
    const b = await esp05.leaderboard(sysId.value, {
      ...(values.value.province ? { province: values.value.province } : {}), ...(from ? { from } : {}), offset: append ? rows.value.length : 0, limit: PAGE,
    });
    board.value = b;
    rows.value = append ? [...rows.value, ...b.rows] : b.rows;
    more.value = rows.value.length < b.total;
  } catch (e) {
    boardError.value = toClientError(e);
  } finally {
    boardLoading.value = false;
  }
}
watch([sysId, () => values.value.province, () => values.value.period], () => void fetchBoard());

const provinces = computed(() => [...new Set(rows.value.map((r) => r.region.province).filter((p): p is string => !!p))]);
const filters = computed(() => [
  { key: 'province', label: t('rk.province'), allLabel: t('rk.allProv'), options: [...new Set([...provinces.value, values.value.province ?? ''])].filter(Boolean).map((p) => ({ value: p, label: p })) },
  { key: 'period', label: t('rk.period'), allLabel: t('rk.allTime'), options: [{ value: '90d', label: t('rk.d90') }, { value: '30d', label: t('rk.d30') }] },
]);
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? rows.value.filter((r) => r.displayName.toLowerCase().includes(q)) : rows.value;
});
const anyFilter = computed(() => !!(values.value.province || values.value.period || query.value.trim()));
function clear() {
  values.value = { province: '', period: '' };
  query.value = '';
}
const mine = (r: Row) => r.subjectId === session.me?.principal.id;
const subjectHref = (r: Row) => (r.subjectKind === 'team' ? `/teams/${encodeURIComponent(r.subjectId)}` : `/players/${encodeURIComponent(r.displayName)}`);

const ds = useDataState({ loading, error, empty: () => !!systems.value && !systems.value.length });
const bds = useDataState({ loading: boardLoading, error: boardError, empty: () => !boardLoading.value && !rows.value.length && !anyFilter.value });
const columns = computed<QDataTableColumn<Row>[]>(() => [
  { key: 'rank', header: t('rk.rank'), numeric: true, sortable: true, width: 72 },
  { key: 'displayName', header: t('rk.name'), sortable: true },
  { key: 'rating', header: t('rk.rating'), numeric: true, sortable: true },
  { key: 'games', header: t('rk.games'), numeric: true, sortable: true },
  { key: 'region', header: t('rk.region') },
  { key: 'lastActiveAt', header: t('rk.last'), sortable: true },
]);
</script>

<template>
  <QContainer>
    <div class="k-stack p-rankings">
      <QPageHeader :title="t('rk.title')" :description="t('rk.desc')" :breadcrumb="[{ label: t('rk.home'), href: '/' }, { label: t('rk.title') }]">
        <template #actions><QButton variant="secondary" icon="info" href="/rankings/formula">{{ t('rk.formula') }}</QButton></template>
      </QPageHeader>
      <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" icon="chart" :empty-title="t('rk.noSystems')" :empty-body="t('rk.noSystemsBody')" @retry="load" />
      <template v-else>
        <div class="p-rankings-tabs"><QTabs v-model="sysId" variant="pill" :aria-label="t('rk.system')" :items="tabs" overflow="scroll" /></div>
        <QFilterBar
          v-model:query="query" v-model:values="values" v-model:view="view" :aria-label="t('rk.filters')" :search-label="t('rk.search')" :search-placeholder="t('rk.searchPh')"
          :filters="filters" :views="[{ value: 'list', label: t('rk.list'), icon: 'list' }, { value: 'table', label: t('rk.table'), icon: 'grid' }]" :view-label="t('rk.viewLabel')"
          :clear-label="t('rk.clear')" :result-label="bds.state.value === 'content' ? t('rk.count', { n: fa(shown.length) }) : undefined" @clear="clear"
        />
        <QCard v-if="system">
          <div class="p-rankings-system">
            <div class="p-rankings-system__main">
              <h2 class="p-rankings-system__title h4">
                {{ t('rk.board') }} <bdi class="q-ltr">{{ sysLabel(system) }}</bdi>
                <QBadge v-if="system.label.official" tone="success" icon="check">{{ t('rk.official') }}</QBadge>
                <QBadge v-else tone="warning" icon="alert">{{ t('rk.internal') }}</QBadge>
              </h2>
              <p class="p-rankings-system__meta">
                <span><bdi class="q-ltr">{{ system.model === 'glicko2' ? 'Glicko-2' : system.model }}</bdi>{{ t('rk.version', { n: fa(system.version) }) }}</span>
                <span v-if="system.publishedAt">{{ t('rk.published', { date: formatJalali(system.publishedAt, 'date') }) }}</span>
                <span v-if="system.label.official && system.label.reference">{{ t('rk.ref') }} <bdi class="q-ltr">{{ system.label.reference }}</bdi></span>
              </p>
              <p v-if="!system.label.official" class="p-rankings-system__hint">{{ t('rk.unapproved') }}</p>
            </div>
            <QButton variant="ghost" size="sm" href="/rankings/formula" :icon-end="isRtl() ? 'arrow-left' : 'arrow-right'">{{ t('rk.how') }}</QButton>
          </div>
        </QCard>
        <QDataState v-if="bds.state.value !== 'content'" v-bind="bds.props.value" skeleton="rows" icon="chart" :empty-title="t('rk.emptyBoard')" @retry="fetchBoard()" />
        <QEmptyState v-else-if="!shown.length" icon="search" compact :title="t('rk.noMatch')">
          <template #action><QButton variant="secondary" @click="clear">{{ t('rk.clear') }}</QButton></template>
        </QEmptyState>
        <template v-else>
          <QCard v-if="view === 'list'" padding="none">
            <ol class="p-rankings-list" :aria-label="t('rk.board')">
              <QLeaderboardRow
                v-for="r in shown" :key="r.subjectId" as="li" :rank="r.rank ?? 0" :name="r.displayName" :initial="Array.from(r.displayName)[0]"
                :kind="r.subjectKind === 'team' ? 'team' : 'player'" :rating="Math.round(r.rating)" :rd="r.rd == null ? undefined : Math.round(r.rd)"
                :inactive="r.inactive" :mine="mine(r)" :href="subjectHref(r)"
              />
            </ol>
          </QCard>
          <QDataTable v-else :caption="t('rk.board')" caption-hidden row-key="subjectId" row-header="displayName" :default-sort="{ key: 'rank', dir: 'asc' }" :columns="columns" :rows="shown">
            <template #cell-rank="{ row }">{{ row.rank == null ? '—' : fa(row.rank) }}</template>
            <template #cell-displayName="{ row }">
              <RouterLink :to="subjectHref(row)" class="p-rankings-name"><bdi>{{ row.displayName }}</bdi></RouterLink>
              <QBadge v-if="mine(row)" tone="green">{{ t('rk.you') }}</QBadge>
              <QBadge v-if="row.inactive" tone="neutral">{{ t('rk.inactive') }}</QBadge>
            </template>
            <template #cell-rating="{ row }">{{ fa(Math.round(row.rating)) }}<span v-if="row.rd != null" class="p-rankings-rd"> ±{{ fa(Math.round(row.rd)) }}</span></template>
            <template #cell-games="{ row }">{{ t('rk.gamesWins', { n: fa(row.games), w: fa(row.wins) }) }}</template>
            <template #cell-region="{ row }">{{ [row.region.province, row.region.city].filter(Boolean).join(isRtl() ? '، ' : ', ') || '—' }}</template>
            <template #cell-lastActiveAt="{ row }">{{ formatJalali(row.lastActiveAt, 'date') }}</template>
          </QDataTable>
          <QPagination
            mode="cursor" :shown="rows.length" :total="board?.total" :has-more="more" :loading="boardLoading"
            :count-label="t('rk.shown', { n: fa(rows.length), total: fa(board?.total ?? rows.length) })" :more-label="t('rk.more')" :done-label="t('rk.done')" @more="fetchBoard(true)"
          />
        </template>
        <p class="p-rankings-foot">{{ t('rk.foot') }}</p>
      </template>
    </div>
  </QContainer>
</template>

<style scoped>
.p-rankings { gap: var(--space-6); }
.p-rankings-tabs { overflow-x: auto; }
.p-rankings-system { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-5); }
.p-rankings-system__main { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.p-rankings-system__title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; }
.p-rankings-system__meta { display: flex; flex-wrap: wrap; gap: 0 var(--space-3); margin: 0; font-size: 13px; line-height: 22px; color: var(--ink-subtle); }
.p-rankings-system__hint { margin: 0; font-size: 13px; line-height: 22px; color: var(--warning-text); max-width: 72ch; }
.p-rankings-list { list-style: none; margin: 0; padding: 0; }
.p-rankings-list > li + li { border-block-start: 1px solid var(--line); }
.p-rankings-name { color: inherit; font-weight: 800; }
.p-rankings-rd { color: var(--ink-subtle); }
.p-rankings-foot { margin: 0; font-size: 13px; line-height: 24px; color: var(--ink-subtle); }
</style>
