<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { CompetitionFamilies } from '@esp/contracts';
import { QAlert, QButton, QCard, QContainer, QDataState, QEmptyState, QFilterBar, QGameCard, QPageHeader, QSection, QSelect, QTextField, fa, useToast } from '@esp/ui';
import { esp02 } from '../api/esp02';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { can } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/games.md — GAME-001/003 catalogue; state is shown honestly, a name alone never means "supported". */
const { push } = useToast();
const games = useLoad(() => esp02.games({}));
const modules = useLoad(() => esp02.modules());
const ds = useDataState({ loading: computed(() => games.loading.value && !games.data.value), error: games.error, empty: () => !!games.data.value && !games.data.value.items.length });
const query = ref('');
const values = ref<Record<string, string>>({ state: '' });
const STATES = ['ready', 'under_review', 'proposed', 'suspended', 'archived'];
const filters = computed(() => [{ key: 'state', label: t('gm.state'), allLabel: t('gm.allStates'), options: STATES.map((s) => ({ value: s, label: t(`gstate.${s}` as MessageKey) })) }]);
const shown = computed(() => (games.data.value?.items ?? []).filter((g) => (!values.value.state || g.state === values.value.state) && g.title.toLowerCase().includes(query.value.trim().toLowerCase())));

const g = reactive({ slug: '', title: '', publisher: '', platforms: '', modes: '', family: 'team', moduleId: 'team' });
const failure = ref('');
const list = (v: string) => v.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
async function create() {
  failure.value = '';
  try {
    // GAME-001/006: new titles start as `proposed` with every capability `unknown` (server default)
    await esp02.createGame({ slug: g.slug.trim(), title: g.title.trim(), publisher: g.publisher.trim(), platforms: list(g.platforms), modes: list(g.modes), family: g.family, moduleId: g.moduleId });
    Object.assign(g, { slug: '', title: '', publisher: '', platforms: '', modes: '' });
    push({ tone: 'success', message: t('gm.created'), duration: 4000 });
    await games.load();
  } catch (e) {
    failure.value = toClientError(e).message;
  }
}
</script>

<template>
  <QContainer>
    <div class="k-stack p-games">
      <QPageHeader :title="t('games.title')" :description="t('games.leadNew')" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('games.title') }]" />
      <QFilterBar
        v-model:query="query" v-model:values="values" :search-label="t('gm.search')" :search-placeholder="t('gm.search')" :filters="filters"
        :result-label="ds.state.value === 'content' ? t('gm.count', { n: fa(shown.length) }) : undefined" @clear="values = { state: '' }; query = ''"
      />
      <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="cards" icon="gamepad" :empty-title="t('gm.empty')" @retry="games.load" />
      <QEmptyState v-else-if="!shown.length" compact icon="search" :title="t('gm.noMatch')" />
      <div v-else class="k-grid">
        <QGameCard v-for="x in shown" :key="x.id" :title="x.title" :publisher="x.publisher" :state="x.state as never" :href="`/games/${encodeURIComponent(x.id)}`" />
      </div>

      <QSection v-if="can('catalog.manage')" id="new-game" small :title="t('adm.newGame')">
        <QCard>
          <form class="k-stack" novalidate @submit.prevent="create">
            <div class="p-games-form">
              <QTextField id="ng-slug" v-model="g.slug" :label="t('adm.slug')" ltr />
              <QTextField id="ng-title" v-model="g.title" :label="t('adm.title')" />
              <QTextField id="ng-pub" v-model="g.publisher" :label="t('adm.publisher')" />
              <QTextField id="ng-plat" v-model="g.platforms" :label="t('games.platforms')" :hint="t('adm.list')" ltr />
              <QTextField id="ng-modes" v-model="g.modes" :label="t('games.modes')" :hint="t('adm.list')" ltr />
              <QSelect id="ng-fam" v-model="g.family" :label="t('games.family')" :options="CompetitionFamilies.map((f) => ({ value: f, label: f }))" />
              <QSelect id="ng-mod" v-model="g.moduleId" :label="t('adm.moduleId')" :options="(modules.data.value?.items ?? []).map((m) => ({ value: m.id, label: m.label }))" />
            </div>
            <QAlert v-if="failure" tone="danger">{{ failure }}</QAlert>
            <div><QButton type="submit" variant="green" icon="plus" :disabled="!g.slug || !g.title || !g.publisher || !g.platforms || !g.modes">{{ t('adm.newGame') }}</QButton></div>
          </form>
        </QCard>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-games { gap: var(--space-7); }
.p-games-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: var(--space-4); }
</style>
