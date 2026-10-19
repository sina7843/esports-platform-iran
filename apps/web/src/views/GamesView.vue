<script setup lang="ts">
import { reactive, ref } from 'vue';
import { CompetitionFamilies } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import { toClientError } from '../errors';
import { can } from '../session';
import DataState from '../components/DataState.vue';
import PageHeader from '../components/PageHeader.vue';
import { t, type MessageKey } from '../i18n';
import { useLoad } from '../useLoad';

/** GAME-001/003: extensible catalog. State is shown honestly; a name alone never means "supported". */
const games = useLoad(() => esp02.games({}));
const modules = useLoad(() => esp02.modules());
const failure = ref<ApiClientError | null>(null);
const g = reactive({ slug: '', title: '', publisher: '', platforms: '', modes: '', family: 'team', moduleId: 'team' });
const list = (v: string) => v.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
async function create() {
  failure.value = null;
  try {
    // GAME-001/006: new titles start as `proposed` with every capability `unknown` (server default)
    await esp02.createGame({ slug: g.slug.trim(), title: g.title.trim(), publisher: g.publisher.trim(), platforms: list(g.platforms), modes: list(g.modes), family: g.family, moduleId: g.moduleId });
    Object.assign(g, { slug: '', title: '', publisher: '', platforms: '', modes: '' });
    await games.load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('games.title')" />
  <DataState :loading="games.loading.value" :error="games.error.value" :empty="!!games.data.value && games.data.value.items.length === 0" @retry="games.load">
    <ul v-if="games.data.value" class="cards">
      <li v-for="game in games.data.value.items" :key="game.id" class="card stack">
        <RouterLink :to="`/games/${game.id}`"><bdi>{{ game.title }}</bdi></RouterLink>
        <span class="muted">{{ t('games.publisher') }}: <bdi>{{ game.publisher }}</bdi></span>
        <span class="state" :data-state="game.state">{{ t(`gstate.${game.state}` as MessageKey) }}</span>
      </li>
    </ul>
  </DataState>

  <form v-if="can('catalog.manage')" class="card stack block" novalidate @submit.prevent="create">
    <h2>{{ t('adm.newGame') }}</h2>
    <div class="grid3">
      <FormField id="ng-slug" :label="t('adm.slug')"><template #default="{ id }"><input :id="id" v-model="g.slug" class="input ltr" /></template></FormField>
      <FormField id="ng-title" :label="t('adm.title')"><template #default="{ id }"><input :id="id" v-model="g.title" class="input" dir="auto" /></template></FormField>
      <FormField id="ng-pub" :label="t('adm.publisher')"><template #default="{ id }"><input :id="id" v-model="g.publisher" class="input" dir="auto" /></template></FormField>
      <FormField id="ng-plat" :label="t('games.platforms')" :hint="t('adm.list')"><template #default="{ id, describedBy }"><input :id="id" v-model="g.platforms" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
      <FormField id="ng-modes" :label="t('games.modes')" :hint="t('adm.list')"><template #default="{ id, describedBy }"><input :id="id" v-model="g.modes" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
      <FormField id="ng-fam" :label="t('games.family')"><template #default="{ id }"><select :id="id" v-model="g.family" class="input"><option v-for="f in CompetitionFamilies" :key="f" :value="f">{{ f }}</option></select></template></FormField>
      <FormField id="ng-mod" :label="t('adm.moduleId')"><template #default="{ id }"><select :id="id" v-model="g.moduleId" class="input"><option v-for="m in modules.data.value?.items ?? []" :key="m.id" :value="m.id">{{ m.label }}</option></select></template></FormField>
    </div>
    <ErrorNote :error="failure" />
    <button type="submit" class="btn btn-primary" :disabled="!g.slug || !g.title || !g.publisher || !g.platforms || !g.modes">{{ t('adm.newGame') }}</button>
  </form>
</template>

<style scoped>
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: var(--sp-4); }
.state { font-size: var(--fs-sm); font-weight: 600; }
.block { margin-block-start: var(--sp-6); }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-3); }
.state[data-state='ready'] { color: var(--accent-strong); }
</style>
