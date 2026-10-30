<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { QDataState, QHallBoard, formatJalali, type QHallBoardMatch } from '@esp/ui';
import { api, type ApiClientError } from '../api/client';
import { esp04, type PublicMatch } from '../api/esp04';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { watchChannels } from '../live';

/** Spec docs/redesign/03-specs/hall.md — LAN-005 venue screen (bare layout): live with stations, call-ups, upcoming, final results. Public data only. */
const route = useRoute();
const eventId = computed(() => String(route.params.id));
const token = computed(() => (typeof route.query['t'] === 'string' ? route.query['t'] : undefined));
type Hall = Awaited<ReturnType<typeof esp04.hall>>;
const data = ref<Hall | null>(null);
const eventName = ref('');
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
onMounted(async () => {
  void load();
  stop = watchChannels([`event:${eventId.value}:public`], () => void load(), 4000);
  fallback = setInterval(() => void load(), 60_000);
  try { eventName.value = (await api.event(eventId.value)).event.name; } catch { /* the board shows its default title */ }
});
onBeforeUnmount(() => {
  stop?.();
  clearInterval(fallback);
});

type M = PublicMatch & { callup?: string | null };
const score = (m: M): [number, number] | undefined => {
  const o = m.outcome as { scores?: number[] | null; maps?: number[] | null } | null;
  const s = o?.maps ?? o?.scores;
  return s && s.length >= 2 ? [s[0]!, s[1]!] : undefined;
};
const toBoard = (m: M): QHallBoardMatch => ({
  id: m.id, home: m.sides[0]?.displayName ?? t('br.tbd'), away: m.sides[1]?.displayName ?? t('br.tbd'), score: score(m), station: m.stationLabel,
  time: m.scheduledAt ? formatJalali(m.scheduledAt, 'time') : undefined, estimated: m.estimated,
  callup: (m.callup === 'called' || m.callup === 'at_station' || m.callup === 'ready') ? m.callup : undefined,
  winner: (m.outcome as { kind?: string; winnerSide?: number } | null)?.kind === 'win' ? ((m.outcome as { winnerSide: number }).winnerSide === 1 ? 1 : 0) : undefined,
});
const notice = computed(() => incidents.value.map((i) => String(i['publicNotice'] ?? '')).filter(Boolean).join(' · ') || undefined);
</script>

<template>
  <QDataState v-if="error || (loading && !data)" :state="error ? (error.code === 'NETWORK' ? 'offline' : 'error') : 'loading'" :request-id="error?.requestId ?? undefined" @retry="load" />
  <QHallBoard
    v-else-if="data" :event-name="eventName || t('hall.title')" :clock="formatJalali(data.serverTime, 'time')" :notice="notice"
    :live="data.live.map(toBoard)" :called="data.called.map(toBoard)" :upcoming="data.upcoming.map(toBoard)" :results="data.results.map(toBoard)"
  />
</template>
