<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { GameStates, ReadinessStates } from '@esp/contracts';
import { QAlert, QBadge, QButton, QCard, QContainer, QDataState, QDateField, QFacts, QPageHeader, QSection, QSelect, QTextField, formatJalali } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp02, type Game, type GameModule } from '../api/esp02';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { can } from '../session';
import { useDataState } from '../useDataState';

/** GAME-001/004/005/006: per-mode readiness, actual capability status, references and the calculation module. */
const route = useRoute();
const game = ref<Game | null>(null);
const modules = ref<GameModule[]>([]);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [g, m] = await Promise.all([esp02.game(String(route.params['id'])), esp02.modules()]);
    game.value = g;
    modules.value = m.items;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(() => route.params['id'], () => void load(), { immediate: true });
const mod = computed(() => modules.value.find((m) => m.id === game.value?.moduleId) ?? null);
const caps = ['api', 'antiCheat', 'stats', 'replay', 'dedicatedServer'] as const;
const ds = useDataState({ loading: computed(() => loading.value && !game.value), error });
const STATE_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = { ready: 'success', under_review: 'info', proposed: 'neutral', suspended: 'warning', archived: 'neutral' };
const capTone = (s?: string) => (s === 'supported' || s === 'available' ? 'success' : s === 'unsupported' || s === 'unavailable' ? 'danger' : s === 'partial' ? 'warning' : 'neutral');
const reviewedDate = computed({ get: () => tr.reviewedAt || null, set: (v: string | null) => { tr.reviewedAt = v ?? ''; } });
const facts = computed(() => (game.value ? [
  { label: t('games.publisher'), value: game.value.publisher },
  { label: t('games.family'), value: game.value.family, ltr: true },
  { label: t('games.platforms'), value: game.value.platforms.join(', '), ltr: true },
  { label: t('games.modes'), value: game.value.modes.join(', '), ltr: true },
] : []));

// GAME-002/003/004 administration: `ready` requires evidence, a reviewed published package and a ready mode (server-enforced)
const failure = ref<ApiClientError | null>(null);
const tr = reactive({ to: 'under_review', reason: '', referenceUrl: '', reviewedAt: '' });
const rd = reactive({ version: '', platform: '', mode: '', state: 'ready', evidence: '' });
async function admin(fn: () => Promise<unknown>) {
  failure.value = null;
  try {
    await fn();
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const transition = () =>
  admin(() =>
    esp02.transitionGame(game.value!.id, {
      to: tr.to,
      reason: tr.reason,
      ...(tr.referenceUrl ? { evidence: { referenceUrl: tr.referenceUrl, reviewedAt: new Date(tr.reviewedAt || Date.now()).toISOString(), note: null } } : {}),
      expectedVersion: game.value!.version,
    }),
  );
const saveReadiness = () => admin(() => esp02.upsertReadiness(game.value!.id, { version: rd.version, platform: rd.platform, mode: rd.mode, state: rd.state, evidence: rd.evidence || null }));
</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !game" v-bind="ds.props.value" @retry="load" />
    <div v-else class="k-stack p-game">
      <QPageHeader
        :title="game.title" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('games.title'), href: '/games' }, { label: game.title }]"
        :status="{ label: t(`gstate.${game.state}` as MessageKey), tone: STATE_TONE[game.state] ?? 'neutral' }"
      >
        <template #actions>
          <QButton variant="secondary" icon="file" :href="`/rules?gameId=${encodeURIComponent(game.id)}`">{{ t('rules.title') }}</QButton>
          <QButton variant="ghost" icon="trophy" href="/events">{{ t('shell.events') }}</QButton>
        </template>
      </QPageHeader>
      <QCard><QFacts :columns="4" :items="facts" /></QCard>
      <div class="p-game-grid">
        <QSection id="readiness" small :title="t('games.readiness')">
          <QCard>
            <ul v-if="game.readiness && game.readiness.length" class="p-game-list">
              <li v-for="r in game.readiness" :key="r.version + r.platform + r.mode">
                <bdi class="q-ltr">{{ r.version }} · {{ r.platform }} · {{ r.mode }}</bdi>
                <QBadge :tone="r.state === 'ready' ? 'success' : 'neutral'">{{ r.state }}</QBadge>
              </li>
            </ul>
            <p v-else class="p-game-muted">{{ t('games.noReadiness') }}</p>
          </QCard>
        </QSection>
        <QSection id="capabilities" small :title="t('games.capabilities')">
          <QCard>
            <ul class="p-game-list">
              <li v-for="c in caps" :key="c">
                <span>{{ t(`cap.${c}` as MessageKey) }}<small v-if="game.capabilities[c]?.detail"> — <bdi>{{ game.capabilities[c]?.detail }}</bdi></small></span>
                <QBadge :tone="capTone(game.capabilities[c]?.status)">{{ t(`cap.${game.capabilities[c]?.status ?? 'unknown'}` as MessageKey) }}</QBadge>
              </li>
            </ul>
          </QCard>
        </QSection>
      </div>
      <QSection v-if="mod" id="module" small :title="`${t('games.module')}: ${mod.id}`">
        <QCard>
          <div class="k-stack">
            <QAlert v-if="mod.testOnly" tone="warning">{{ t('games.testOnly') }}</QAlert>
            <p class="p-game-muted q-ltr">{{ mod.scoringModel }}</p>
            <ul class="p-game-fields" dir="ltr"><li v-for="f in mod.resultFields" :key="f.key"><code class="q-mono">{{ f.key }}</code> ({{ f.type }}{{ f.required ? ', required' : '' }}) — {{ f.description }}</li></ul>
          </div>
        </QCard>
      </QSection>
      <QSection v-if="game.references.length" id="refs" small :title="t('games.references')">
        <QCard>
          <ul class="p-game-list"><li v-for="r in game.references" :key="r.url"><a :href="r.url" rel="noopener noreferrer" target="_blank" dir="ltr">{{ r.title }}</a><small>{{ formatJalali(r.retrievedAt, 'date') }}</small></li></ul>
        </QCard>
      </QSection>

      <QSection v-if="can('catalog.manage')" id="admin" small :title="t('adm.transition')">
        <QCard>
          <div class="k-stack">
            <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
            <form class="k-stack" novalidate @submit.prevent="transition">
              <div class="p-game-form">
                <QSelect id="gt-to" v-model="tr.to" :label="t('adm.state')" :options="GameStates.map((st) => ({ value: st, label: t(`gstate.${st}` as MessageKey) }))" />
                <QTextField id="gt-reason" v-model="tr.reason" :label="t('adm.reason')" required />
                <QTextField id="gt-url" v-model="tr.referenceUrl" :label="t('adm.evidenceUrl')" type="url" ltr />
                <QDateField id="gt-date" v-model="reviewedDate" :label="t('adm.reviewedAt')" />
              </div>
              <div><QButton type="submit" variant="secondary" :disabled="!tr.reason">{{ t('adm.transition') }}</QButton></div>
            </form>
            <form class="k-stack" novalidate @submit.prevent="saveReadiness">
              <h3 class="h4 p-game-h">{{ t('adm.readiness') }}</h3>
              <div class="p-game-form">
                <QTextField id="gr-v" v-model="rd.version" :label="t('adm.version')" ltr />
                <QSelect id="gr-p" v-model="rd.platform" :label="t('gid.platform')" :options="game.platforms.map((pl) => ({ value: pl, label: pl }))" />
                <QSelect id="gr-m" v-model="rd.mode" :label="t('games.modes')" :options="game.modes.map((md) => ({ value: md, label: md }))" />
                <QSelect id="gr-s" v-model="rd.state" :label="t('adm.state')" :options="ReadinessStates.map((st) => ({ value: st, label: st }))" />
                <QTextField id="gr-e" v-model="rd.evidence" :label="t('adm.evidenceUrl')" />
              </div>
              <div><QButton type="submit" variant="secondary" :disabled="!rd.version || !rd.platform || !rd.mode">{{ t('adm.readiness') }}</QButton></div>
            </form>
          </div>
        </QCard>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-game { gap: var(--space-7); }
.p-game-h { margin: 0; }
.p-game-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); align-items: start; }
.p-game-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-game-list li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); font-size: 14px; }
.p-game-list li:last-child { border-block-end: 0; }
.p-game-list small { color: var(--ink-subtle); }
.p-game-muted { margin: 0; color: var(--ink-muted); font-size: 14px; }
.p-game-fields { margin: 0; padding-inline-start: var(--space-5); font-size: 13px; line-height: 24px; color: var(--ink-muted); }
.p-game-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); }
@media (max-width: 900px) { .p-game-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
