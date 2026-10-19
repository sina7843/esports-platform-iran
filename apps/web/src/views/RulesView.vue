<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { RulesScopeKinds } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import { toClientError } from '../errors';
import { can, session } from '../session';
import DataState from '../components/DataState.vue';
import PageHeader from '../components/PageHeader.vue';
import { stateLabel, t } from '../i18n';
import { useLoad } from '../useLoad';

/** RULE-003/006: published packages are public; drafts stay with their scope managers and rules officers. */
const route = useRoute();
const router = useRouter();
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : undefined);
const list = useLoad(() => esp02.rulesList({ gameId: q('gameId'), state: q('state') }));
const reminders = useLoad(() => (can('rules.review') ? esp02.reminders() : Promise.resolve({ items: [] })));

// RULE-003/004: new package (draft). Clauses carry kind, allowed bounds and a citation; no global defaults exist.
const failure = ref<ApiClientError | null>(null);
const n = reactive({ gameId: '', scopeKind: 'catalog', scopeRef: '', title: '', version: '', sourceUrl: '', applicability: '', clauses: '[]', testOnly: false });
async function create() {
  failure.value = null;
  let clauses: unknown;
  try {
    clauses = JSON.parse(n.clauses);
  } catch {
    failure.value = toClientError(new Error(t('adm.invalidJson')));
    return;
  }
  try {
    const p = await esp02.createRules({ gameId: n.gameId.trim(), scope: { kind: n.scopeKind, ref: n.scopeRef.trim() || n.gameId.trim() }, title: n.title, version: n.version, sourceUrl: n.sourceUrl || null, applicability: n.applicability, clauses, testOnly: n.testOnly });
    await router.push(`/rules/${p.id}`);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('rules.title')" :lead="t('rules.notOfficial')">
    <template v-if="session.me" #actions>
      <a class="btn btn-sm" :href="'?state=draft'">draft</a>
      <a class="btn btn-sm" :href="'?state=under_review'">under_review</a>
      <a class="btn btn-sm" :href="'?'">published</a>
    </template>
  </PageHeader>
  <DataState :loading="list.loading.value" :error="list.error.value" :empty="!!list.data.value && list.data.value.items.length === 0" @retry="list.load">
    <template #empty><p>{{ t('rules.noPublished') }}</p></template>
    <ul v-if="list.data.value" class="list">
      <li v-for="p in list.data.value.items" :key="p.id">
        <RouterLink :to="`/rules/${p.id}`"><bdi>{{ p.title }}</bdi></RouterLink>
        — {{ t('rules.version') }} <bdi class="ltr">{{ p.versionLabel }}</bdi> · {{ stateLabel(p.state) }}
        <strong v-if="p.testOnly" class="test"> · TEST ONLY</strong>
      </li>
    </ul>
  </DataState>

  <section v-if="reminders.data.value && reminders.data.value.items.length" class="card stack block" aria-labelledby="rm-h">
    <h2 id="rm-h">{{ t('adm.reminders') }}</h2>
    <ul class="list">
      <li v-for="r in reminders.data.value.items" :key="r.packageId + r.reason + (r.eventId ?? '')">
        <RouterLink :to="`/rules/${r.packageId}`"><bdi>{{ r.title }}</bdi></RouterLink> · <bdi class="ltr">{{ r.reason }}</bdi> · <JalaliDate :iso="r.dueAt" />
      </li>
    </ul>
  </section>

  <form v-if="session.me" class="card stack block" novalidate @submit.prevent="create">
    <h2>{{ t('adm.newRules') }}</h2>
    <div class="grid3">
      <FormField id="nr-game" :label="t('adm.gameId')"><template #default="{ id }"><input :id="id" v-model="n.gameId" class="input ltr" /></template></FormField>
      <FormField id="nr-kind" :label="t('adm.scopeKind')"><template #default="{ id }"><select :id="id" v-model="n.scopeKind" class="input"><option v-for="k in RulesScopeKinds" :key="k" :value="k">{{ k }}</option></select></template></FormField>
      <FormField id="nr-ref" :label="t('adm.scopeRef')"><template #default="{ id }"><input :id="id" v-model="n.scopeRef" class="input ltr" /></template></FormField>
      <FormField id="nr-title" :label="t('adm.title')"><template #default="{ id }"><input :id="id" v-model="n.title" class="input" dir="auto" /></template></FormField>
      <FormField id="nr-ver" :label="t('rules.version')"><template #default="{ id }"><input :id="id" v-model="n.version" class="input ltr" /></template></FormField>
      <FormField id="nr-src" :label="t('adm.sourceUrl')"><template #default="{ id }"><input :id="id" v-model="n.sourceUrl" type="url" class="input ltr" /></template></FormField>
    </div>
    <FormField id="nr-app" :label="t('rules.applicability')"><template #default="{ id }"><textarea :id="id" v-model="n.applicability" class="input" rows="2" dir="auto" /></template></FormField>
    <FormField id="nr-cl" :label="t('adm.clausesJson')" :hint="t('adm.clausesHint')"><template #default="{ id, describedBy }"><textarea :id="id" v-model="n.clauses" class="input ltr mono" rows="6" dir="ltr" :aria-describedby="describedBy" /></template></FormField>
    <label class="row"><input v-model="n.testOnly" type="checkbox" /> {{ t('adm.testOnly') }}</label>
    <ErrorNote :error="failure" />
    <button type="submit" class="btn btn-primary" :disabled="!n.gameId || !n.title || !n.version || !n.applicability">{{ t('adm.newRules') }}</button>
  </form>
</template>

<style scoped>
.list { margin: 0; padding-inline-start: var(--sp-5); display: grid; gap: var(--sp-2); }
.test { color: var(--warn); }
.block { margin-block-start: var(--sp-6); }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-3); }
.mono { font-family: ui-monospace, monospace; }
</style>
