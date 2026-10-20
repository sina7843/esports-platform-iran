<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp04 } from '../api/esp04';
import DataState from '../components/DataState.vue';
import JalaliDate from '../components/JalaliDate.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { watchChannels } from '../live';

/** LAN-005: the venue screen — live matches with stations, call-ups, upcoming matches, final results. Public data only. */
const route = useRoute();
const eventId = computed(() => String(route.params.id));
const token = computed(() => (typeof route.query['t'] === 'string' ? route.query['t'] : undefined));
type Hall = Awaited<ReturnType<typeof esp04.hall>>;
const data = ref<Hall | null>(null);
const incidents = ref<Array<Record<string, unknown>>>([]);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
async function load() {
  loading.value = !data.value;
  try {
    data.value = await esp04.hall(eventId.value, token.value);
    incidents.value = (await esp04.incidents(eventId.value)).items.filter((i) => i['state'] === 'active');
    error.value = null;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
let stop: (() => void) | null = null;
let fallback: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  stop = watchChannels([`event:${eventId.value}:public`], () => void load(), 4000);
  fallback = setInterval(() => void load(), 60_000);
});
onBeforeUnmount(() => {
  stop?.();
  clearInterval(fallback);
});
const vs = (m: Hall['upcoming'][number]) => m.sides.map((s) => s.displayName).join(' — ') || t('br.tbd');
</script>

<template>
  <div class="hall" lang="fa">
    <DataState :loading="loading" :error="error" @retry="load">
      <template v-if="data">
        <p v-for="i in incidents" :key="String(i['id'])" class="incident" role="alert" dir="auto">{{ i['publicNotice'] }}</p>
        <section>
          <h2>{{ t('hall.live') }}</h2>
          <p v-if="!data.live.length" class="muted">—</p>
          <ul class="tiles"><li v-for="m in data.live" :key="m.id" class="tile live"><strong><bdi>{{ vs(m) }}</bdi></strong><span>{{ m.stationLabel ?? '' }}</span><StatusBadge :state="m.state" /></li></ul>
        </section>
        <section v-if="data.called.length">
          <h2>{{ t('hall.called') }}</h2>
          <ul class="tiles"><li v-for="m in data.called" :key="m.id" class="tile called"><strong><bdi>{{ vs(m) }}</bdi></strong><span>{{ m.stationLabel ?? t('hall.noStation') }}</span><span>{{ t(`hall.cu.${m.callup}` as never) }}</span></li></ul>
        </section>
        <section>
          <h2>{{ t('hall.upcoming') }}</h2>
          <ul class="rows"><li v-for="m in data.upcoming" :key="m.id"><JalaliDate :iso="m.scheduledAt" format="time" /><template v-if="m.estimated"> ~</template> <bdi>{{ vs(m) }}</bdi> <span class="muted">{{ m.stationLabel ?? '' }}</span></li></ul>
        </section>
        <section>
          <h2>{{ t('hall.results') }}</h2>
          <ul class="rows"><li v-for="m in data.results" :key="m.id"><bdi>{{ vs(m) }}</bdi> — <strong v-if="m.outcome && (m.outcome as { kind: string }).kind === 'win'"><bdi>{{ m.sides[(m.outcome as { winnerSide: number }).winnerSide]?.displayName }}</bdi></strong></li></ul>
        </section>
        <p class="muted small"><JalaliDate :iso="data.serverTime" format="time" /></p>
      </template>
    </DataState>
  </div>
</template>

<style scoped>
.hall { font-size: clamp(1rem, 1.6vw, 1.6rem); display: grid; gap: var(--sp-5); }
h2 { margin: 0 0 var(--sp-2); font-size: 1.2em; }
.tiles { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: var(--sp-3); }
.tile { display: grid; gap: var(--sp-1); padding: var(--sp-3); border-radius: var(--radius-lg); background: var(--surface); border: 2px solid var(--border); }
.tile.live { border-color: var(--danger); }
.tile.called { border-color: var(--warn); }
.rows { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--sp-1); }
.incident { background: var(--danger-soft); color: var(--danger); padding: var(--sp-3); border-radius: var(--radius-md); font-weight: 700; }
.small { font-size: var(--fs-sm); }
</style>
