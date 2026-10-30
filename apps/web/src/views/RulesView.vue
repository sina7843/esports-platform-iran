<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { RulesScopeKinds } from '@esp/contracts';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QContainer, QDataState, QIcon, QPageHeader, QSection, QSegmentedControl, QSelect, QTextField, formatJalali } from '@esp/ui';
import { esp02 } from '../api/esp02';
import { toClientError } from '../errors';
import { stateLabel, t } from '../i18n';
import { can, session } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/rules.md — RULE-003/006: published packages are public; drafts stay with their scope managers and rules officers. */
const route = useRoute();
const router = useRouter();
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : undefined);
const list = useLoad(() => esp02.rulesList({ gameId: q('gameId'), state: q('state') }));
const reminders = useLoad(() => (can('rules.review') ? esp02.reminders() : Promise.resolve({ items: [] })));
const ds = useDataState({ loading: computed(() => list.loading.value && !list.data.value), error: list.error, empty: () => !!list.data.value && !list.data.value.items.length });
const stateFilter = computed(() => q('state') ?? 'published');
async function setState(v: string | undefined) {
  await router.replace({ query: { ...route.query, state: v && v !== 'published' ? v : undefined } });
  await list.load();
}

// RULE-003/004: new package (draft). Clauses carry kind, allowed bounds and a citation; no global defaults exist.
const failure = ref('');
const n = reactive({ gameId: '', scopeKind: 'catalog', scopeRef: '', title: '', version: '', sourceUrl: '', applicability: '', clauses: '[]', testOnly: false as boolean | null });
async function create() {
  failure.value = '';
  let clauses: unknown;
  try {
    clauses = JSON.parse(n.clauses);
  } catch {
    failure.value = t('adm.invalidJson');
    return;
  }
  try {
    const p = await esp02.createRules({ gameId: n.gameId.trim(), scope: { kind: n.scopeKind, ref: n.scopeRef.trim() || n.gameId.trim() }, title: n.title, version: n.version, sourceUrl: n.sourceUrl || null, applicability: n.applicability, clauses, testOnly: !!n.testOnly });
    await router.push(`/rules/${p.id}`);
  } catch (e) {
    failure.value = toClientError(e).message;
  }
}
</script>

<template>
  <QContainer>
    <div class="k-stack p-rules">
      <QPageHeader :title="t('rules.title')" :description="t('rules.notOfficial')" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('rules.title') }]" />
      <QSegmentedControl
        v-if="session.me" size="sm" :aria-label="t('rl.state')" :model-value="stateFilter"
        :options="[{ value: 'published', label: stateLabel('published') }, { value: 'under_review', label: stateLabel('under_review') }, { value: 'draft', label: stateLabel('draft') }]"
        @update:model-value="setState"
      />
      <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="rows" icon="file" :empty-title="t('rules.noPublished')" @retry="list.load" />
      <div v-else class="k-grid">
        <QCard v-for="p in list.data.value!.items" :key="p.id" :href="`/rules/${p.id}`">
          <div class="p-rules-card">
            <span class="p-rules-icon" aria-hidden="true"><QIcon name="file" :size="22" /></span>
            <strong class="h4 p-rules-title"><bdi>{{ p.title }}</bdi></strong>
            <span class="p-rules-meta">{{ t('rules.version') }} <bdi class="q-ltr">{{ p.versionLabel }}</bdi></span>
            <span class="p-rules-badges">
              <QBadge :tone="p.state === 'published' ? 'success' : 'neutral'">{{ stateLabel(p.state) }}</QBadge>
              <QBadge v-if="p.testOnly" tone="warning">{{ t('rl.testOnly') }}</QBadge>
            </span>
          </div>
        </QCard>
      </div>

      <QSection v-if="reminders.data.value && reminders.data.value.items.length" id="reminders" small :title="t('adm.reminders')">
        <QCard>
          <ul class="p-rules-list">
            <li v-for="r in reminders.data.value.items" :key="r.packageId + r.reason + (r.eventId ?? '')">
              <RouterLink :to="`/rules/${r.packageId}`"><bdi>{{ r.title }}</bdi></RouterLink>
              <span class="p-rules-meta"><bdi class="q-ltr">{{ r.reason }}</bdi> · {{ formatJalali(r.dueAt) }}</span>
            </li>
          </ul>
        </QCard>
      </QSection>

      <QSection v-if="session.me" id="new" small :title="t('adm.newRules')">
        <QCard>
          <form class="k-stack" novalidate @submit.prevent="create">
            <div class="p-rules-form">
              <QTextField id="nr-game" v-model="n.gameId" :label="t('adm.gameId')" ltr />
              <QSelect id="nr-kind" v-model="n.scopeKind" :label="t('adm.scopeKind')" :options="RulesScopeKinds.map((k) => ({ value: k, label: k }))" />
              <QTextField id="nr-ref" v-model="n.scopeRef" :label="t('adm.scopeRef')" ltr />
              <QTextField id="nr-title" v-model="n.title" :label="t('adm.title')" />
              <QTextField id="nr-ver" v-model="n.version" :label="t('rules.version')" ltr />
              <QTextField id="nr-src" v-model="n.sourceUrl" :label="t('adm.sourceUrl')" type="url" ltr />
            </div>
            <QTextField id="nr-app" v-model="n.applicability" :label="t('rules.applicability')" multiline :rows="2" />
            <QTextField id="nr-cl" v-model="n.clauses" :label="t('adm.clausesJson')" :hint="t('adm.clausesHint')" multiline :rows="6" ltr />
            <QCheckbox v-model="n.testOnly" :label="t('adm.testOnly')" />
            <QAlert v-if="failure" tone="danger">{{ failure }}</QAlert>
            <div><QButton type="submit" variant="green" icon="plus" :disabled="!n.gameId || !n.title || !n.version || !n.applicability">{{ t('adm.newRules') }}</QButton></div>
          </form>
        </QCard>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-rules { gap: var(--space-7); }
.p-rules-card { display: flex; flex-direction: column; gap: var(--space-2); }
.p-rules-icon { display: grid; place-items: center; inline-size: 44px; block-size: 44px; border-radius: var(--radius-sm); background: var(--green-soft); color: var(--green-text); }
.p-rules-title { margin: 0; color: var(--ink); }
.p-rules-meta { font-size: 13px; color: var(--ink-subtle); }
.p-rules-badges { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.p-rules-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-3); }
.p-rules-list li { display: flex; flex-direction: column; gap: 2px; }
.p-rules-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); }
</style>
