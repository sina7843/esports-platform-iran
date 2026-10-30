<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QLowerThird, QScoreBug, QSponsorStrip, fa, isRtl } from '@esp/ui';
import { esp06 } from '../api/esp06';
import { t } from '../i18n';

/**
 * Spec docs/redesign/03-specs/overlay.md — CAST-004..006 broadcast graphics for an OBS browser source (bare layout,
 * transparent). Data comes only from the overlay endpoint, which applies the stream delay on the server.
 */
const route = useRoute();
const token = computed(() => String(route.params['token']));
const s = ref<Record<string, unknown> | null>(null);
const failed = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
async function load() {
  try {
    s.value = await esp06.overlay(token.value);
    failed.value = false;
  } catch {
    failed.value = true;
  }
}
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 3000);
});
onBeforeUnmount(() => clearInterval(timer));
type Score = { sides: string[]; state: string; outcome: { kind: string; winnerSide?: number; scores?: [number, number] | null; maps?: [number, number] | null } | null; provisional: boolean } | null;
const sb = computed(() => s.value?.['scoreboard'] as Score | undefined);
const score = computed<[number, number] | undefined>(() => {
  const o = sb.value?.outcome;
  return o?.maps ?? o?.scores ?? undefined;
});
const lineup = computed(() => (s.value?.['lineup'] as Array<{ name: string; players: string[] } | null> | undefined) ?? []);
const veto = computed(() => (s.value?.['veto'] as Array<{ kind: string; value: string }> | undefined) ?? []);
const sponsors = computed(() => (s.value?.['sponsors'] as Array<{ name: string; logoUrl: string | null }> | undefined) ?? []);
const sync = computed(() => (s.value?.['label'] === 'latest_result' ? { mode: 'latest' as const } : { mode: 'synced' as const, delaySeconds: Number(s.value?.['delaySeconds'] ?? 0) }));
const sep = computed(() => (isRtl() ? '، ' : ', '));
</script>

<template>
  <div class="p-overlay" :aria-label="t('ovl.title')">
    <QAlert v-if="failed" tone="danger">{{ t('ovl.invalid') }}</QAlert>
    <template v-else-if="s">
      <p class="p-overlay-label">{{ s['label'] === 'latest_result' ? t('ovl.latest') : t('ovl.synced', { n: fa(Number(s['delaySeconds'])) }) }}<span v-if="sb && !score" class="q-sr"> · {{ t('ovl.vs') }}</span></p>
      <QScoreBug
        v-if="sb" transparent :home="sb.sides[0] ?? '—'" :away="sb.sides[1] ?? '—'" :score="score" :live="sb.state === 'live'" :provisional="sb.provisional"
        :label="s['label'] === 'latest_result' ? t('ovl.latest') : t('ovl.synced', { n: fa(Number(s['delaySeconds'])) })"
      />
      <div v-if="lineup.length" class="p-overlay-row">
        <template v-for="(l, i) in lineup" :key="i">
          <QLowerThird v-if="l" transparent :title="l.name" :subtitle="l.players.join(sep)" />
        </template>
      </div>
      <QLowerThird v-if="veto.length" transparent :kicker="t('ovl.title')" :title="veto.map((v) => `${v.kind}: ${v.value}`).join(' · ')" />
      <QSponsorStrip v-if="sponsors.length" transparent :sponsors="sponsors" :label="t('ovl.sponsor')" :sync="sync" />
    </template>
  </div>
</template>

<style scoped>
:global(html:has(.p-overlay)), :global(body:has(.p-overlay)), :global(.k-bare:has(.p-overlay)) { background: transparent; }
.p-overlay { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); }
.p-overlay-label { margin: 0; align-self: flex-start; padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink-muted); font-size: 13px; font-weight: 700; }
.p-overlay-row { display: flex; flex-wrap: wrap; gap: var(--space-4); }
</style>
