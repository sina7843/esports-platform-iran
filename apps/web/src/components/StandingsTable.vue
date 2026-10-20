<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp04, type StandingsView } from '../api/esp04';
import DataState from './DataState.vue';
import DataTable from './DataTable.vue';
import { toClientError } from '../errors';
import { num, t, type MessageKey } from '../i18n';

/**
 * FMT-003 / DRAW-004: standings computed on the server and paged. Columns follow the format's metrics; a complete tie
 * is flagged (the rules decide), and provisional standings are labelled as such (15.3).
 */
const props = defineProps<{ stageId: string; token?: string | undefined; groups?: string[] }>();
const LIMIT = 25;
const data = ref<StandingsView | null>(null);
const offset = ref(0);
const group = ref('');
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await esp04.standings(props.stageId, { offset: offset.value, limit: LIMIT, ...(group.value ? { group: group.value } : {}), t: props.token });
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());
watch([() => props.stageId, group], () => {
  offset.value = 0;
  void load();
});
const METRICS = ['played', 'wins', 'draws', 'losses', 'points', 'score_diff', 'map_diff', 'buchholz', 'total_points', 'best_placement', 'kills', 'best', 'best_ms', 'finishes', 'depth', 'position'];
const columns = computed(() => {
  const first = data.value?.rows[0]?.metrics ?? {};
  const keys = METRICS.filter((k) => k in first && k !== 'depth');
  return [{ key: 'rank', label: t('st.rank') }, { key: 'displayName', label: t('st.participant') }, ...(data.value?.rows.some((r) => r.group) ? [{ key: 'group', label: t('st.group') }] : []), ...keys.map((k) => ({ key: `m_${k}`, label: t(`st.m.${k}` as MessageKey) }))];
});
const rows = computed(() => (data.value?.rows ?? []).map((r) => ({ ...r, ...Object.fromEntries(Object.entries(r.metrics).map(([k, v]) => [`m_${k}`, k === 'best_ms' ? `${num((v / 1000).toFixed(3))}s` : num(v)])) })));
const page = (d: number) => {
  offset.value = Math.max(0, offset.value + d * LIMIT);
  void load();
};
</script>

<template>
  <div class="standings">
    <div class="row bar">
      <label v-if="groups?.length" class="row">
        {{ t('st.group') }}
        <select v-model="group" class="input">
          <option value="">{{ t('st.allGroups') }}</option>
          <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
        </select>
      </label>
      <span v-if="data?.provisional" class="badge-warn" role="note">{{ t('st.provisional') }}</span>
      <span v-if="data?.needsReview" class="badge-danger" role="alert">{{ t('st.needsReview') }}: {{ data.needsReview }}</span>
    </div>
    <DataState :loading="loading && !data" :error="error" :empty="!!data && !data.rows.length" @retry="load">
      <DataTable v-if="data" :caption="t('st.caption')" :columns="columns" :rows="rows" row-key="id" row-header="displayName">
        <template #cell-rank="{ row }">{{ num((row as { rank: number }).rank) }}<span v-if="(row as { unresolvedTie: boolean }).unresolvedTie" class="tie" :title="t('st.tie')"> =</span></template>
        <template #cell-displayName="{ row }"><bdi>{{ (row as { displayName: string }).displayName }}</bdi></template>
      </DataTable>
      <div v-if="data && data.total > LIMIT" class="row pager">
        <button type="button" class="btn btn-sm" :disabled="offset === 0" @click="page(-1)">{{ t('st.prev') }}</button>
        <span class="muted">{{ num(offset + 1) }}–{{ num(Math.min(offset + LIMIT, data.total)) }} / {{ num(data.total) }}</span>
        <button type="button" class="btn btn-sm" :disabled="offset + LIMIT >= data.total" @click="page(1)">{{ t('st.next') }}</button>
      </div>
      <p v-if="data" class="muted small">{{ t('st.algorithm') }}: <bdi class="ltr">{{ data.algorithm }}</bdi> · {{ t('st.rulesHash') }}: <bdi class="ltr">{{ data.rulesHash.slice(0, 12) }}</bdi></p>
    </DataState>
  </div>
</template>

<style scoped>
.bar { flex-wrap: wrap; gap: var(--sp-3); align-items: center; margin-block-end: var(--sp-2); }
.badge-warn { background: var(--warn-soft); color: var(--warn); padding: 0 var(--sp-2); border-radius: 999px; font-size: var(--fs-sm); }
.badge-danger { background: var(--danger-soft); color: var(--danger); padding: 0 var(--sp-2); border-radius: var(--radius-sm); font-size: var(--fs-sm); }
.tie { color: var(--warn); font-weight: 700; }
.pager { gap: var(--sp-2); align-items: center; margin-block-start: var(--sp-2); }
.small { font-size: var(--fs-xs); }
</style>
