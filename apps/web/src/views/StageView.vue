<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp04, type DrawDoc, type PublicMatch } from '../api/esp04';
import BracketView from '../components/BracketView.vue';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StandingsTable from '../components/StandingsTable.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/** Public stage page: bracket/rounds, standings, schedule and the published draw with its reproducibility check. */
const route = useRoute();
const id = computed(() => String(route.params.id));
const token = computed(() => (typeof route.query['t'] === 'string' ? route.query['t'] : undefined));
const { data, loading, error, load } = useLoad(() => esp04.stage(id.value, token.value));
watch(id, () => void load());
const tab = ref<'bracket' | 'standings' | 'schedule' | 'draw'>('bracket');
const schedule = ref<PublicMatch[]>([]);
const draws = ref<DrawDoc[]>([]);
const failure = ref<ApiClientError | null>(null);
const verified = ref<boolean | null>(null);
async function openTab(t2: typeof tab.value) {
  tab.value = t2;
  failure.value = null;
  try {
    if (t2 === 'schedule' && data.value) schedule.value = (await esp04.schedule(data.value.eventId, { stageId: id.value, limit: 200, t: token.value })).items;
    if (t2 === 'draw') draws.value = (await esp04.draws(id.value, token.value)).items;
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function verify(d: DrawDoc) {
  verified.value = (await esp04.drawVerify(d._id)).reproducible;
}
const nameOf = (d: DrawDoc, pid: string) => d.input.find((x) => x.participationId === pid)?.displayName ?? pid;
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <PageHeader :title="data.name">
        <template #title><bdi>{{ data.name }}</bdi></template>
        <template #actions><StatusBadge :state="data.state" /></template>
      </PageHeader>
      <p class="muted">
        <RouterLink :to="`/events/${data.eventId}${token ? `?t=${token}` : ''}`"><bdi>{{ data.eventName }}</bdi></RouterLink> · <bdi>{{ data.disciplineName }}</bdi> · {{ t(`fmt.${data.format}` as never) }} · {{ t(`reg.presence.${data.presence}` as never) }}
        <template v-if="data.rules"> · {{ t('reg.rules') }}: <bdi>{{ data.rules.label }}</bdi> <bdi class="ltr">v{{ data.rules.version }}</bdi></template>
      </p>
      <div class="tabs" role="tablist" :aria-label="t('stg.tabs')">
        <button v-for="k in (['bracket', 'standings', 'schedule', 'draw'] as const)" :key="k" type="button" role="tab" class="btn btn-sm" :aria-selected="tab === k" :class="{ active: tab === k }" @click="openTab(k)">{{ t(`stg.tab.${k}` as never) }}</button>
      </div>
      <ErrorNote :error="failure" />
      <p v-if="!data.structure && tab !== 'draw'" class="muted">{{ t('stg.notGenerated') }}</p>
      <BracketView v-else-if="tab === 'bracket'" :stage-id="id" :token="token" />
      <StandingsTable v-else-if="tab === 'standings'" :stage-id="id" :token="token" :groups="data.structure?.groups ?? []" />
      <section v-if="tab === 'schedule'" class="stack">
        <p v-if="!schedule.length" class="muted">—</p>
        <ul class="list">
          <li v-for="m in schedule" :key="m.id" class="card row item">
            <span><JalaliDate :iso="m.scheduledAt" /><template v-if="m.estimated && m.scheduledAt"> ({{ t('br.estimated') }})</template></span>
            <RouterLink :to="`/matches/${m.id}`"><bdi>{{ m.sides.map((s) => s.displayName).join(' — ') || t('br.tbd') }}</bdi></RouterLink>
            <StatusBadge :state="m.state" />
          </li>
        </ul>
      </section>
      <section v-if="tab === 'draw'" class="stack">
        <p v-if="!draws.length" class="muted">{{ t('stg.noDraw') }}</p>
        <article v-for="d in draws" :key="d._id" class="card stack">
          <h3>{{ t('stg.drawNo', { n: num(d.number) }) }} — <StatusBadge :state="d.state" /></h3>
          <p class="muted">{{ t('stg.method') }}: {{ t(`drw.${d.method}` as never) }} · {{ t('stg.seed') }}: <bdi class="ltr code">{{ d.seedString }}</bdi> · <bdi class="ltr">{{ d.engine }}</bdi></p>
          <ol v-if="!d.outcome.groups" class="list"><li v-for="pid in d.outcome.order" :key="pid"><bdi>{{ nameOf(d, pid) }}</bdi></li></ol>
          <div v-else class="groups">
            <div v-for="(ids, g) in d.outcome.groups" :key="g" class="card"><h4>{{ t('br.group', { g: String(g) }) }}</h4><ul class="list"><li v-for="pid in ids" :key="pid"><bdi>{{ nameOf(d, pid) }}</bdi></li></ul></div>
          </div>
          <ul v-if="d.outcome.explanations.length" class="list muted"><li v-for="(x, i) in d.outcome.explanations" :key="i" dir="auto">{{ x }}</li></ul>
          <p v-if="d.reason" dir="auto">{{ t('stg.redrawReason') }}: {{ d.reason }}</p>
          <div class="row"><button type="button" class="btn btn-sm" @click="verify(d)">{{ t('stg.verify') }}</button><span v-if="verified !== null" :class="verified ? 'ok' : 'bad'" role="status">{{ verified ? t('stg.reproducible') : t('stg.notReproducible') }}</span></div>
        </article>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.tabs { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-block: var(--sp-3); }
.tabs .active { background: var(--accent-soft); color: var(--accent-strong); border-color: var(--accent); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.item { justify-content: space-between; flex-wrap: wrap; gap: var(--sp-2); list-style: none; }
.groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-2); }
.code { font-family: monospace; font-size: var(--fs-xs); }
.ok { color: var(--ok); font-weight: 700; }
.bad { color: var(--danger); font-weight: 700; }
h3, h4, p { margin: 0; }
</style>
