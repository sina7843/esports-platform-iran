<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api, type Leaderboard } from '../api/esp05';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * RANK-003/006/007: public leaderboards per published rating system with region and time-window filters. A system
 * without the competition owner's approval is always labelled "internal / unapproved", never "official".
 */
const esp05: typeof esp05Api = esp05Api;
const { data: systems, loading, error, load } = useLoad(async () => (await esp05.systems()).items);
const f = reactive({ systemId: '', province: '', city: '', from: '', to: '', offset: 0 });
const board = ref<Leaderboard | null>(null);
const records = ref<Record<string, unknown> | null>(null);
const failure = ref<ApiClientError | null>(null);
const busy = ref(false);
const PAGE = 50;
async function fetchBoard() {
  if (!f.systemId) return;
  busy.value = true;
  failure.value = null;
  try {
    board.value = await esp05.leaderboard(f.systemId, { ...(f.province ? { province: f.province } : {}), ...(f.city ? { city: f.city } : {}), ...(f.from ? { from: new Date(f.from).toISOString() } : {}), ...(f.to ? { to: new Date(f.to).toISOString() } : {}), offset: f.offset, limit: PAGE });
    records.value = await esp05.records(f.systemId);
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
watch(systems, (s) => {
  if (s?.length && !f.systemId) {
    f.systemId = s[0]!.id;
    void fetchBoard();
  }
});
const rec = (k: string) => records.value?.[k] as Record<string, unknown> | null | undefined;
</script>

<template>
  <PageHeader :title="t('nav.rankings')" :lead="t('rank.lead')">
    <template #actions><RouterLink class="btn btn-sm" to="/rankings/formula">{{ t('rank.formula') }}</RouterLink></template>
  </PageHeader>
  <ErrorNote :error="failure" />
  <DataState :loading="loading" :error="error" :empty="!!systems && !systems.length" @retry="load">
    <form class="row filters" novalidate @submit.prevent="f.offset = 0; fetchBoard()">
      <label for="rk-s">{{ t('rank.system') }}</label>
      <select id="rk-s" v-model="f.systemId" class="input"><option v-for="s in systems ?? []" :key="s.id" :value="s.id">{{ s.gameId }} · {{ s.mode }}{{ s.platform ? ` · ${s.platform}` : '' }} · {{ t(`rank.subject.${s.subject}` as never) }} (v{{ num(s.version) }})</option></select>
      <label for="rk-p">{{ t('rank.province') }}</label>
      <input id="rk-p" v-model="f.province" class="input" dir="auto" />
      <label for="rk-c">{{ t('rank.city') }}</label>
      <input id="rk-c" v-model="f.city" class="input" dir="auto" />
      <label for="rk-f">{{ t('rank.from') }}</label>
      <input id="rk-f" v-model="f.from" type="date" class="input" />
      <label for="rk-t">{{ t('rank.to') }}</label>
      <input id="rk-t" v-model="f.to" type="date" class="input" />
      <button type="submit" class="btn btn-sm" :disabled="busy || !f.systemId">{{ t('rank.apply') }}</button>
    </form>
    <section v-if="board" class="card stack block" aria-labelledby="lb-h">
      <div class="row between">
        <h2 id="lb-h">{{ t('rank.leaderboard') }}</h2>
        <span class="badge" :data-tone="board.label.official ? 'ok' : 'warn'">{{ board.label.official ? t('rank.official') : t('rank.unapproved') }}</span>
      </div>
      <p v-if="!board.label.official" class="muted small">{{ t('rank.unapprovedHint') }}</p>
      <p v-if="!board.rows.length" class="muted">{{ t('rank.empty') }}</p>
      <table v-else class="table">
        <caption class="sr-only">{{ t('rank.leaderboard') }}</caption>
        <thead><tr><th scope="col">{{ t('rank.rank') }}</th><th scope="col">{{ t('rank.name') }}</th><th scope="col">{{ t('rank.rating') }}</th><th scope="col">{{ t('rank.games') }}</th><th scope="col">{{ t('rank.region') }}</th><th scope="col">{{ t('rank.lastActive') }}</th></tr></thead>
        <tbody>
          <tr v-for="r in board.rows" :key="r.subjectId" :class="{ inactive: r.inactive }">
            <td>{{ r.rank === null ? t('rank.inactive') : num(r.rank) }}</td>
            <th scope="row"><RouterLink v-if="r.subjectKind === 'team'" :to="`/teams/${r.subjectId}`"><bdi>{{ r.displayName }}</bdi></RouterLink><bdi v-else>{{ r.displayName }}</bdi></th>
            <td><bdi class="ltr">{{ num(r.rating) }}<span v-if="r.rd !== null" class="muted"> ±{{ num(r.rd) }}</span></bdi></td>
            <td>{{ num(r.games) }} ({{ num(r.wins) }} {{ t('rank.wins') }})</td>
            <td><bdi>{{ [r.region.province, r.region.city].filter(Boolean).join('، ') || '—' }}</bdi></td>
            <td><JalaliDate :iso="r.lastActiveAt" format="date" /></td>
          </tr>
        </tbody>
      </table>
      <div class="row">
        <button type="button" class="btn btn-sm" :disabled="f.offset === 0" @click="f.offset = Math.max(0, f.offset - PAGE); fetchBoard()">{{ t('rank.prev') }}</button>
        <span class="muted small">{{ num(f.offset + 1) }}–{{ num(Math.min(f.offset + PAGE, board.total)) }} / {{ num(board.total) }}</span>
        <button type="button" class="btn btn-sm" :disabled="f.offset + PAGE >= board.total" @click="f.offset += PAGE; fetchBoard()">{{ t('rank.next') }}</button>
      </div>
      <dl v-if="records" class="facts">
        <div v-if="rec('peak')"><dt>{{ t('rank.peak') }}</dt><dd><bdi>{{ rec('peak')!['name'] }}</bdi> — {{ num(Number(rec('peak')!['rating'])) }}</dd></div>
        <div v-if="rec('biggestGain')"><dt>{{ t('rank.gain') }}</dt><dd><bdi>{{ rec('biggestGain')!['name'] }}</bdi> +{{ num(Number(rec('biggestGain')!['delta'])) }}</dd></div>
        <div v-if="rec('mostGames')"><dt>{{ t('rank.mostGames') }}</dt><dd><bdi>{{ rec('mostGames')!['name'] }}</bdi> — {{ num(Number(rec('mostGames')!['games'])) }}</dd></div>
      </dl>
      <p class="muted small">{{ t('rank.basis') }}: <span dir="auto">{{ board.system.regionBasis }}</span> · {{ t('rank.eligibility') }}: <span dir="auto">{{ board.system.eligibility }}</span></p>
    </section>
  </DataState>
</template>

<style scoped>
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.block { margin-block-start: var(--sp-4); }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: start; padding: var(--sp-2); border-block-end: 1px solid var(--border); }
.inactive { opacity: 0.6; }
.badge { display: inline-block; padding: 0 var(--sp-3); border-radius: 999px; font-size: var(--fs-sm); }
[data-tone='ok'] { background: var(--ok-soft); color: var(--ok); }
[data-tone='warn'] { background: var(--warn-soft); color: var(--warn); }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-2); margin: 0; }
.facts dt { color: var(--muted); font-size: var(--fs-sm); }
.facts dd { margin: 0; }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
