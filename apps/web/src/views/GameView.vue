<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp02, type Game, type GameModule } from '../api/esp02';
import DataState from '../components/DataState.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { reactive } from 'vue';
import { GameStates, ReadinessStates } from '@esp/contracts';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import { can } from '../session';

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
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="game">
      <PageHeader :title="game.title" :lead="t(`gstate.${game.state}` as MessageKey)"><template #title><bdi>{{ game.title }}</bdi></template></PageHeader>
      <dl class="meta card">
        <div><dt>{{ t('games.publisher') }}</dt><dd><bdi>{{ game.publisher }}</bdi></dd></div>
        <div><dt>{{ t('games.family') }}</dt><dd><bdi class="ltr">{{ game.family }}</bdi></dd></div>
        <div><dt>{{ t('games.platforms') }}</dt><dd><bdi class="ltr">{{ game.platforms.join(', ') }}</bdi></dd></div>
        <div><dt>{{ t('games.modes') }}</dt><dd><bdi class="ltr">{{ game.modes.join(', ') }}</bdi></dd></div>
      </dl>

      <section class="card stack block" aria-labelledby="rd-h">
        <h2 id="rd-h">{{ t('games.readiness') }}</h2>
        <ul v-if="game.readiness && game.readiness.length" class="list">
          <li v-for="r in game.readiness" :key="r.version + r.platform + r.mode"><bdi class="ltr">{{ r.version }} · {{ r.platform }} · {{ r.mode }}</bdi> — <bdi class="ltr">{{ r.state }}</bdi></li>
        </ul>
        <p v-else class="muted">{{ t('games.noReadiness') }}</p>
      </section>

      <section class="card stack block" aria-labelledby="cap-h">
        <h2 id="cap-h">{{ t('games.capabilities') }}</h2>
        <ul class="list">
          <li v-for="c in caps" :key="c">{{ t(`cap.${c}` as MessageKey) }}: <strong>{{ t(`cap.${game.capabilities[c]?.status ?? 'unknown'}` as MessageKey) }}</strong><span v-if="game.capabilities[c]?.detail" class="muted"> — <bdi>{{ game.capabilities[c]?.detail }}</bdi></span></li>
        </ul>
      </section>

      <section v-if="mod" class="card stack block" aria-labelledby="mod-h">
        <h2 id="mod-h">{{ t('games.module') }}: <bdi class="ltr">{{ mod.id }}</bdi></h2>
        <p v-if="mod.testOnly" class="notice">{{ t('games.testOnly') }}</p>
        <p class="ltr" dir="ltr">{{ mod.scoringModel }}</p>
        <ul class="list ltr" dir="ltr"><li v-for="f in mod.resultFields" :key="f.key"><code>{{ f.key }}</code> ({{ f.type }}{{ f.required ? ', required' : '' }}) — {{ f.description }}</li></ul>
      </section>

      <section v-if="game.references.length" class="card stack block" aria-labelledby="ref-h">
        <h2 id="ref-h">{{ t('games.references') }}</h2>
        <ul class="list"><li v-for="r in game.references" :key="r.url"><a :href="r.url" rel="noopener noreferrer" target="_blank" dir="ltr">{{ r.title }}</a> <span class="muted">({{ r.retrievedAt }})</span></li></ul>
      </section>

      <p><RouterLink :to="{ path: '/rules', query: { gameId: game.id } }">{{ t('rules.title') }}</RouterLink></p>

      <section v-if="can('catalog.manage')" class="card stack block">
        <ErrorNote :error="failure" />
        <form class="stack" novalidate @submit.prevent="transition">
          <h2>{{ t('adm.transition') }}</h2>
          <div class="grid3">
            <FormField id="gt-to" :label="t('adm.state')"><template #default="{ id }"><select :id="id" v-model="tr.to" class="input"><option v-for="st in GameStates" :key="st" :value="st">{{ t(`gstate.${st}` as MessageKey) }}</option></select></template></FormField>
            <FormField id="gt-reason" :label="t('adm.reason')"><template #default="{ id }"><input :id="id" v-model="tr.reason" class="input" dir="auto" /></template></FormField>
            <FormField id="gt-url" :label="t('adm.evidenceUrl')"><template #default="{ id }"><input :id="id" v-model="tr.referenceUrl" type="url" class="input ltr" /></template></FormField>
            <FormField id="gt-date" :label="t('adm.reviewedAt')"><template #default="{ id }"><input :id="id" v-model="tr.reviewedAt" type="date" class="input" /></template></FormField>
          </div>
          <button type="submit" class="btn" :disabled="!tr.reason">{{ t('adm.transition') }}</button>
        </form>
        <form class="stack" novalidate @submit.prevent="saveReadiness">
          <h2>{{ t('adm.readiness') }}</h2>
          <div class="grid3">
            <FormField id="gr-v" :label="t('adm.version')"><template #default="{ id }"><input :id="id" v-model="rd.version" class="input ltr" /></template></FormField>
            <FormField id="gr-p" :label="t('gid.platform')"><template #default="{ id }"><select :id="id" v-model="rd.platform" class="input"><option v-for="pl in game.platforms" :key="pl" :value="pl">{{ pl }}</option></select></template></FormField>
            <FormField id="gr-m" :label="t('games.modes')"><template #default="{ id }"><select :id="id" v-model="rd.mode" class="input"><option v-for="md in game.modes" :key="md" :value="md">{{ md }}</option></select></template></FormField>
            <FormField id="gr-s" :label="t('adm.state')"><template #default="{ id }"><select :id="id" v-model="rd.state" class="input"><option v-for="st in ReadinessStates" :key="st" :value="st">{{ st }}</option></select></template></FormField>
            <FormField id="gr-e" :label="t('adm.evidenceUrl')"><template #default="{ id }"><input :id="id" v-model="rd.evidence" class="input" dir="auto" /></template></FormField>
          </div>
          <button type="submit" class="btn" :disabled="!rd.version || !rd.platform || !rd.mode">{{ t('adm.readiness') }}</button>
        </form>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-4); margin: 0; }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; }
.block { margin-block-start: var(--sp-6); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-3); }
.notice { margin: 0; padding: var(--sp-3); background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-md); }
</style>
