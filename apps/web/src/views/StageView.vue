<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  QBadge, QBracket, QButton, QCard, QContainer, QDataState, QEmptyState, QFacts, QIcon, QMatchCard, QPageHeader, QStandingsTable, QTabs, STAGE_STATUS, statusBadge,
  dateTag, fa, formatJalali,
} from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp04, type BracketView, type DrawDoc, type PublicMatch, type SlotView, type StandingsView } from '../api/esp04';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/stage.md — public stage: bracket/rounds, standings, schedule and the published draw with its reproducibility check. */
const route = useRoute();
const id = computed(() => String(route.params.id));
const token = computed(() => (typeof route.query['t'] === 'string' ? route.query['t'] : undefined));
const { data, loading, error, load } = useLoad(() => esp04.stage(id.value, token.value));
watch(id, () => void load());
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error });

const stageStatus = computed(() => {
  const b = statusBadge(STAGE_STATUS, data.value?.state);
  return { label: b.label, ...b.props, ...(b.props.tone === 'live' ? { dot: true } : {}) };
});
const elimination = computed(() => /elim/.test(data.value?.format ?? ''));
const tabs = computed(() => [
  ...(elimination.value ? [{ key: 'bracket', label: t('sg.bracket') }] : []),
  { key: 'standings', label: t('sg.standings') }, { key: 'schedule', label: t('sg.schedule') }, { key: 'draw', label: t('sg.draw') },
]);
const tab = ref('');
watch(tabs, (ts) => { if (!ts.some((x) => x.key === tab.value)) tab.value = ts[0]!.key; }, { immediate: true });

const bracket = ref<BracketView | null>(null);
const standings = ref<StandingsView | null>(null);
const schedule = ref<PublicMatch[]>([]);
const draws = ref<DrawDoc[]>([]);
const tabLoading = ref(false);
const failure = ref<ApiClientError | null>(null);
const verified = ref<Record<string, boolean>>({});
async function loadTab() {
  if (!data.value) return;
  tabLoading.value = true;
  failure.value = null;
  try {
    if (tab.value === 'bracket') bracket.value = await esp04.bracket(id.value, { limit: 512, t: token.value });
    if (tab.value === 'standings') standings.value = await esp04.standings(id.value, { limit: 200, t: token.value });
    if (tab.value === 'schedule') schedule.value = (await esp04.schedule(data.value.eventId, { stageId: id.value, limit: 200, t: token.value })).items;
    if (tab.value === 'draw') draws.value = (await esp04.draws(id.value, token.value)).items;
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    tabLoading.value = false;
  }
}
watch([tab, data], () => void loadTab());
async function verify(d: DrawDoc) {
  try {
    verified.value = { ...verified.value, [d._id]: (await esp04.drawVerify(d._id)).reproducible };
  } catch (e) {
    failure.value = toClientError(e);
  }
}

/* ---------- bracket ---------- */
const score = (s: SlotView, i: number): number | undefined => {
  const o = s.match?.outcome as { scores?: number[] | null; maps?: number[] | null } | null;
  return (o?.maps ?? o?.scores ?? undefined)?.[i];
};
const sideOf = (s: SlotView, i: number) => {
  const p = s.participants[i];
  return { name: p?.name ?? undefined, score: score(s, i), placeholder: t('sg.waiting') };
};
const sections = computed(() => {
  const b = bracket.value;
  if (!b) return [];
  const names = b.brackets.length ? b.brackets : [...new Set(b.slots.map((s) => s.bracket))];
  const label = (n: string) => (/loser/i.test(n) ? t('sg.losers') : /grand|final/i.test(n) ? t('sg.final') : names.length > 1 ? t('sg.winners') : undefined);
  return names.map((name) => {
    const slots = b.slots.filter((s) => s.bracket === name);
    const rounds = [...new Set(slots.map((s) => s.round))].sort((a, z) => a - z);
    return {
      key: name, label: label(name),
      rounds: rounds.map((r) => ({
        label: t('sg.round', { n: fa(r) }),
        matches: slots.filter((s) => s.round === r).sort((a, z) => a.order - z.order).map((s) => ({
          id: s.key, label: t('sg.match', { n: fa(s.order) }), state: (s.match?.state ?? 'awaiting_sides') as never,
          time: s.match?.scheduledAt ? (s.match.estimated ? t('sg.about', { time: formatJalali(s.match.scheduledAt, 'time') }) : formatJalali(s.match.scheduledAt, 'time')) : undefined,
          top: sideOf(s, 0), bottom: sideOf(s, 1),
          winner: s.winner ? (s.winner === s.participants[0]?.id ? 'top' as const : 'bottom' as const) : null,
          conditional: !!s.conditional, href: s.match ? `/matches/${encodeURIComponent(s.match.id)}` : undefined,
        })),
      })),
    };
  });
});

/* ---------- standings ---------- */
const groups = computed(() => {
  const rows = standings.value?.rows ?? [];
  const keys = [...new Set(rows.map((r) => r.group ?? ''))];
  return keys.map((g) => ({
    key: g,
    rows: rows.filter((r) => (r.group ?? '') === g).map((r) => ({
      id: r.id, rank: r.rank, name: r.displayName, initial: Array.from(r.displayName)[0],
      played: r.metrics.played ?? 0, wins: r.metrics.wins ?? 0, draws: r.metrics.draws, losses: r.metrics.losses ?? 0,
      diff: r.metrics.score_diff ?? r.metrics.map_diff ?? 0, points: r.metrics.points ?? r.metrics.total_points ?? 0, tie: r.unresolvedTie,
    })),
  }));
});

/* ---------- schedule ---------- */
const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const days = computed(() => {
  const out: { key: string; at: string; items: PublicMatch[] }[] = [];
  for (const m of [...schedule.value].sort((a, z) => (a.scheduledAt ?? '').localeCompare(z.scheduledAt ?? ''))) {
    const k = m.scheduledAt ? dayKey(m.scheduledAt) : '';
    const g = out.find((x) => x.key === k);
    if (g) g.items.push(m); else out.push({ key: k, at: m.scheduledAt ?? '', items: [m] });
  }
  return out;
});
const weekday = (iso: string) => (iso ? new Intl.DateTimeFormat(dateTag(), { timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)) : '—');
const mScore = (m: PublicMatch, i: number): number | undefined => {
  const o = m.outcome as { scores?: number[] | null; maps?: number[] | null } | null;
  return (o?.maps ?? o?.scores ?? undefined)?.[i];
};
const nameOf = (d: DrawDoc, pid: string) => d.input.find((x) => x.participationId === pid)?.displayName ?? pid;
</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" @retry="load" />
    <div v-else class="k-stack p-stage">
      <QPageHeader
        :breadcrumb="[{ label: t('sg.home'), href: '/' }, { label: t('sg.events'), href: '/events' }, { label: data.eventName, href: `/events/${encodeURIComponent(data.eventId)}` }, { label: data.name }]"
        :eyebrow="data.eventName" :title="data.name" :status="stageStatus"
      >
        <template #meta>
          <span class="p-stage-meta">
            <RouterLink :to="`/events/${encodeURIComponent(data.eventId)}`"><bdi>{{ data.eventName }}</bdi></RouterLink>
            <span v-if="data.disciplineName"><QIcon name="gamepad" :size="16" /><bdi>{{ data.disciplineName }}</bdi></span>
            <span><QIcon name="trophy" :size="16" />{{ t(`fmt.${data.format}` as never) }}</span>
            <RouterLink v-if="data.rules" :to="`/rules/${encodeURIComponent(data.rules.packageId)}`">{{ t('sg.rules') }} · <bdi class="q-ltr">{{ data.rules.version }}</bdi></RouterLink>
          </span>
        </template>
      </QPageHeader>
      <QTabs v-model="tab" :items="tabs" :aria-label="t('sg.tabs')" overflow="scroll" />
      <div class="p-stage-panel">
        <QDataState v-if="failure || (tabLoading && !bracket && !standings && !schedule.length && !draws.length)" :state="failure ? 'error' : 'loading'" :request-id="failure?.requestId ?? undefined" @retry="loadTab" />
        <template v-else-if="tab === 'bracket'">
          <QEmptyState v-if="!sections.length || !sections.some((s) => s.rounds.length)" compact icon="trophy" :title="t('sg.noBracket')" />
          <QBracket v-else-if="sections.length === 1" :rounds="sections[0]!.rounds" :title="data.name" />
          <QBracket v-else :sections="sections" :title="data.name" />
        </template>
        <template v-else-if="tab === 'standings'">
          <p v-if="standings?.provisional" class="p-stage-meta"><QIcon name="clock" :size="16" />{{ t('sg.provisional') }}</p>
          <div :class="groups.length > 1 ? 'p-stage-groups' : ''">
            <QStandingsTable
              v-for="g in groups" :key="g.key" :title="g.key ? t('sg.group', { g: g.key }) : undefined" :participant-label="t('sg.participant')"
              :rows="g.rows" :provisional="standings?.provisional" :footnote="g.rows.some((r) => r.tie) ? t('sg.tie') : undefined"
            />
          </div>
        </template>
        <template v-else-if="tab === 'schedule'">
          <QEmptyState v-if="!days.length" compact icon="calendar" :title="t('sg.noMatches')" />
          <section v-for="d in days" :key="d.key" class="p-stage-day" :aria-labelledby="`sd-${d.key}`">
            <h3 :id="`sd-${d.key}`"><QIcon name="calendar" :size="18" />{{ weekday(d.at) }}<QBadge v-if="d.items.some((m) => m.estimated)" tone="warning">{{ t('sg.estimated') }}</QBadge></h3>
            <div class="p-stage-list">
              <QMatchCard
                v-for="m in d.items" :key="m.id" :state="m.state as never" :time="m.scheduledAt ? formatJalali(m.scheduledAt, 'time') : undefined"
                :home="{ name: m.sides[0]?.displayName, score: mScore(m, 0) }" :away="{ name: m.sides[1]?.displayName, score: mScore(m, 1) }"
                :station="m.stationLabel ?? undefined" :href="`/matches/${encodeURIComponent(m.id)}`"
              />
            </div>
          </section>
        </template>
        <template v-else>
          <QEmptyState v-if="!draws.length" compact icon="target" :title="t('sg.noDraw')" />
          <QCard v-for="d in draws" :key="d._id">
            <div class="p-stage-draw">
              <div class="p-stage-draw__head">
                <h3>{{ t('sg.drawN', { n: fa(d.number) }) }} <QBadge v-if="d.state === 'published'" tone="success">{{ t('sg.published') }}</QBadge></h3>
              </div>
              <QFacts :columns="3" :items="[{ label: t('sg.method'), value: d.method }, { label: t('sg.seed'), value: d.seedString, ltr: true }, { label: t('sg.engine'), value: d.engine, ltr: true }]" />
              <div class="p-stage-pots">
                <div class="p-stage-pot">
                  <h4>{{ t('sg.input') }}</h4>
                  <ol><li v-for="x in d.input" :key="x.participationId"><bdi>{{ x.displayName }}</bdi> <span v-if="x.seed != null" class="p-stage-seed">#{{ fa(x.seed) }}</span></li></ol>
                </div>
                <div v-if="d.outcome.groups" class="p-stage-pot">
                  <h4>{{ t('sg.outcome') }}</h4>
                  <template v-for="(members, g) in d.outcome.groups" :key="g">
                    <h4>{{ t('sg.group', { g: String(g) }) }}</h4>
                    <ol><li v-for="pid in members" :key="pid"><bdi>{{ nameOf(d, pid) }}</bdi></li></ol>
                  </template>
                </div>
                <div v-else class="p-stage-pot">
                  <h4>{{ t('sg.outcome') }}</h4>
                  <ol><li v-for="pid in d.outcome.order" :key="pid"><bdi>{{ nameOf(d, pid) }}</bdi></li></ol>
                </div>
              </div>
              <ul v-if="d.outcome.explanations.length" class="p-stage-explain"><li v-for="(e, i) in d.outcome.explanations" :key="i" dir="auto">{{ e }}</li></ul>
              <div class="p-stage-verify">
                <QButton variant="secondary" icon="refresh" @click="verify(d)">{{ t('sg.reproduce') }}</QButton>
                <span v-if="verified[d._id] === true" class="p-stage-ok" role="status"><QIcon name="check-circle" :size="18" />{{ t('sg.reproOk') }}</span>
                <span v-else-if="verified[d._id] === false" class="p-stage-fail" role="status"><QIcon name="alert" :size="18" />{{ t('sg.reproFail') }}</span>
              </div>
            </div>
          </QCard>
        </template>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-stage { gap: var(--space-6); }
.p-stage-panel { display: flex; flex-direction: column; gap: var(--space-6); min-width: 0; }
.p-stage-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); font-size: 14px; color: var(--ink-muted); margin: 0; }
.p-stage-meta a { color: var(--green-text); font-weight: 700; text-decoration: none; }
.p-stage-meta a:hover { text-decoration: underline; }
.p-stage-meta span { display: inline-flex; align-items: center; gap: var(--space-1); }
.p-stage-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); }
.p-stage-day { display: flex; flex-direction: column; gap: var(--space-3); }
.p-stage-day h3 { margin: 0; font-size: 15px; font-weight: 800; color: var(--green-text); display: flex; gap: var(--space-2); align-items: center; }
.p-stage-list { display: flex; flex-direction: column; gap: var(--space-2); }
.p-stage-draw { display: flex; flex-direction: column; gap: var(--space-5); }
.p-stage-draw__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.p-stage-draw__head h3 { margin: 0; display: flex; align-items: center; gap: var(--space-3); }
.p-stage-pots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.p-stage-pot { padding: var(--space-4); background: var(--surface-sunken); border: 1px solid var(--line); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.p-stage-pot h4 { margin: 0; font-size: 13px; font-weight: 800; color: var(--ink-muted); }
.p-stage-pot ol { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: 14px; }
.p-stage-pot li::marker { color: var(--ink-subtle); }
.p-stage-seed { font-size: 12px; color: var(--ink-subtle); }
.p-stage-explain { margin: 0; padding-inline-start: var(--space-5); color: var(--ink-muted); font-size: 14px; line-height: 24px; }
.p-stage-verify { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.p-stage-ok { color: var(--success-text); font-weight: 700; font-size: 14px; display: inline-flex; gap: var(--space-2); align-items: center; }
.p-stage-fail { color: var(--danger-text); font-weight: 700; font-size: 14px; display: inline-flex; gap: var(--space-2); align-items: center; }
@media (max-width: 960px) { .p-stage-pots { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .p-stage-groups { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .p-stage-pots { grid-template-columns: minmax(0, 1fr); } }
</style>
