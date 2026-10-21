<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp02, type RulesPackage } from '../api/esp02';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { isForbidden, toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { session } from '../session';
import { reactive } from 'vue';
import FormField from '../components/FormField.vue';

/** RULE-003/004/006/011: versioned package with cited clauses; acceptance records version, hash and time. */
const route = useRoute();
const p = ref<RulesPackage | null>(null);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const actionError = ref<ApiClientError | null>(null);
const accepted = ref(false);
async function load() {
  loading.value = true;
  error.value = null;
  try {
    p.value = await esp02.rules(String(route.params['id']));
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(() => route.params['id'], () => void load(), { immediate: true });
async function accept() {
  actionError.value = null;
  try {
    await esp02.acceptRules(String(route.params['id']));
    accepted.value = true;
  } catch (e) {
    actionError.value = toClientError(e);
  }
}
// RULE-004/005/007/010: manager actions; the server returns blockers and refuses illegal steps.
const notice = ref('');
async function manage(fn: () => Promise<unknown>, ok = '') {
  actionError.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    await load();
  } catch (e) {
    actionError.value = toClientError(e);
  }
}
const id = () => String(route.params['id']);
const transition = (name: string) => manage(() => esp02.rulesTransition(id(), name, p.value!.version, null));
const rv = reactive({ translation: false, rights: false, ack: '', note: '' });
const review = () =>
  manage(() =>
    esp02.rulesReview(id(), { translationReviewed: rv.translation, publisherRights: { reviewed: rv.rights, restrictions: null }, acknowledgedClauseKeys: rv.ack.split(',').map((x) => x.trim()).filter(Boolean), note: rv.note || null, expectedVersion: p.value!.version }),
  );
const cf = reactive({ description: '', resolution: '' });
const conflict = () => manage(() => esp02.rulesConflict(id(), cf.description, cf.resolution || null, p.value!.version));
const am = reactive({ newVersion: '', reason: '', impact: '', reaccept: true, clauses: '' });
function parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    actionError.value = toClientError(new Error(t('adm.invalidJson')));
    return null;
  }
}
const amend = () => {
  const clauses = parse<unknown[]>(am.clauses || JSON.stringify(p.value?.clauses ?? []));
  if (!clauses) return;
  return manage(async () => {
    const next = await esp02.rulesAmend(id(), { newVersion: am.newVersion, reason: am.reason, impactAssessment: am.impact, reacceptRequired: am.reaccept, clauses });
    notice.value = next.id;
  });
};
const settingsText = ref('{}');
const settingsResult = ref<{ ok: boolean; violations: { key: string; reason: string; citation: string | null }[] } | null>(null);
async function validate() {
  const settings = parse<Record<string, unknown>>(settingsText.value);
  if (!settings) return;
  actionError.value = null;
  try {
    settingsResult.value = await esp02.validateSettings(id(), settings);
  } catch (e) {
    actionError.value = toClientError(e);
  }
}

function allowed(c: RulesPackage['clauses'][number]): string {
  if (!c.allowed) return '—';
  if (c.allowed.options) return c.allowed.options.join(' / ');
  return `${c.allowed.min ?? '…'} – ${c.allowed.max ?? '…'}`;
}
</script>

<template>
  <DataState :loading="loading" :error="error" :forbidden="isForbidden(error)" @retry="load">
    <template v-if="p">
      <PageHeader :title="p.title"><template #title><bdi>{{ p.title }}</bdi></template></PageHeader>
      <p v-if="p.label" class="notice" role="note">{{ p.label }}</p>
      <p v-if="p.testOnly" class="muted">{{ t('rules.trialHelp') }}</p>
      <p v-if="p.supersededBy" class="notice" role="note">{{ t('rules.superseded') }} <RouterLink :to="`/rules/${p.supersededBy}`"><bdi class="ltr">{{ p.supersededBy }}</bdi></RouterLink></p>
      <p class="muted">{{ t('rules.notOfficial') }}</p>
      <dl class="meta card">
        <div><dt>{{ t('rules.version') }}</dt><dd><bdi class="ltr">{{ p.versionLabel }}</bdi></dd></div>
        <div><dt>{{ t('rules.source') }}</dt><dd><a v-if="p.sourceUrl" :href="p.sourceUrl" rel="noopener noreferrer" target="_blank" dir="ltr">{{ p.sourceUrl }}</a><span v-else>—</span></dd></div>
        <div><dt>{{ t('rules.reviewedAt') }}</dt><dd><JalaliDate v-if="p.reviewedAt" :iso="p.reviewedAt" /><span v-else>—</span></dd></div>
        <div><dt>{{ t('rules.nextReview') }}</dt><dd><JalaliDate v-if="p.nextReviewDueAt" :iso="p.nextReviewDueAt" /><span v-else>—</span></dd></div>
        <div><dt>{{ t('rules.applicability') }}</dt><dd dir="auto">{{ p.applicability }}</dd></div>
        <div v-if="p.adaptedFrom"><dt>{{ t('rules.adaptedFrom') }}</dt><dd><bdi class="ltr">{{ p.adaptedFrom.packageId }}</bdi> — <span dir="auto">{{ p.adaptedFrom.differences }}</span></dd></div>
      </dl>
      <p v-if="!p.translationFa.reviewed" class="muted">{{ t('rules.translationUnreviewed') }}</p>

      <section class="block" aria-labelledby="cl-h">
        <h2 id="cl-h">{{ t('rules.clauses') }}</h2>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">{{ t('rules.clauses') }}</caption>
            <thead><tr><th scope="col">key</th><th scope="col">{{ t('rules.kind.mandatory') }} / {{ t('rules.kind.configurable') }}</th><th scope="col">value</th><th scope="col">{{ t('rules.allowed') }}</th><th scope="col">{{ t('rules.citation') }}</th></tr></thead>
            <tbody>
              <tr v-for="c in p.clauses" :key="c.key">
                <th scope="row"><code class="ltr">{{ c.key }}</code></th>
                <td>{{ t(`rules.kind.${c.kind}` as MessageKey) }}</td>
                <td><bdi class="ltr">{{ c.value === null ? '—' : String(c.value) }}</bdi></td>
                <td><bdi class="ltr">{{ allowed(c) }}</bdi></td>
                <td dir="auto">{{ c.citation }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="session.me && p.state === 'published'" class="card stack block" aria-labelledby="vs-h">
        <h2 id="vs-h">{{ t('adm.validate') }}</h2>
        <FormField id="vs-json" :label="t('adm.settingsJson')"><template #default="{ id: fid }"><textarea :id="fid" v-model="settingsText" class="input ltr mono" rows="3" dir="ltr" /></template></FormField>
        <button type="button" class="btn btn-sm" @click="validate">{{ t('adm.validate') }}</button>
        <p v-if="settingsResult && settingsResult.ok" role="status" class="ok">{{ t('adm.valid') }}</p>
        <ul v-else-if="settingsResult" class="list" role="status">
          <li v-for="v in settingsResult.violations" :key="v.key"><code class="ltr">{{ v.key }}</code>: <bdi>{{ v.reason }}</bdi><span v-if="v.citation"> — {{ t('rules.citation') }}: <bdi>{{ v.citation }}</bdi></span></li>
        </ul>
      </section>

      <section v-if="p.blockers !== undefined" class="card stack block" aria-labelledby="mg-h">
        <h2 id="mg-h">{{ t('adm.blockers') }}</h2>
        <ul v-if="p.blockers.length" class="list"><li v-for="b in p.blockers" :key="b"><bdi>{{ b }}</bdi></li></ul>
        <p v-else class="muted">—</p>
        <p v-if="notice" role="status" class="ok"><bdi class="ltr">{{ notice }}</bdi></p>
        <div class="row">
          <button v-if="p.state === 'draft'" type="button" class="btn btn-sm" @click="transition('submit_for_review')">submit_for_review</button>
          <button v-if="p.state === 'under_review'" type="button" class="btn btn-sm" @click="transition('return_to_draft')">return_to_draft</button>
          <button v-if="p.state === 'under_review'" type="button" class="btn btn-sm btn-primary" :disabled="p.blockers.length > 0" @click="transition('publish')">publish</button>
          <button v-if="p.state === 'published'" type="button" class="btn btn-sm btn-danger" @click="transition('withdraw')">withdraw</button>
        </div>
        <form v-if="p.state !== 'published'" class="stack" novalidate @submit.prevent="review">
          <h3>{{ t('adm.review') }}</h3>
          <label class="row"><input v-model="rv.translation" type="checkbox" /> {{ t('adm.translationReviewed') }}</label>
          <label class="row"><input v-model="rv.rights" type="checkbox" /> {{ t('adm.rightsReviewed') }}</label>
          <FormField id="rv-ack" :label="t('adm.ackKeys')"><template #default="{ id: fid }"><input :id="fid" v-model="rv.ack" class="input ltr" /></template></FormField>
          <button type="submit" class="btn btn-sm">{{ t('adm.review') }}</button>
        </form>
        <form class="stack" novalidate @submit.prevent="conflict">
          <h3>{{ t('adm.conflict') }}</h3>
          <FormField id="cf-d" :label="t('mgmt.description')"><template #default="{ id: fid }"><input :id="fid" v-model="cf.description" class="input" dir="auto" /></template></FormField>
          <FormField id="cf-r" :label="t('adm.resolution')"><template #default="{ id: fid }"><input :id="fid" v-model="cf.resolution" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="!cf.description">{{ t('adm.conflict') }}</button>
        </form>
        <form v-if="p.state === 'published'" class="stack" novalidate @submit.prevent="amend">
          <h3>{{ t('adm.amend') }}</h3>
          <FormField id="am-v" :label="t('adm.newVersion')"><template #default="{ id: fid }"><input :id="fid" v-model="am.newVersion" class="input ltr" /></template></FormField>
          <FormField id="am-r" :label="t('adm.reason')"><template #default="{ id: fid }"><input :id="fid" v-model="am.reason" class="input" dir="auto" /></template></FormField>
          <FormField id="am-i" :label="t('adm.impact')"><template #default="{ id: fid }"><textarea :id="fid" v-model="am.impact" class="input" rows="2" dir="auto" /></template></FormField>
          <label class="row"><input v-model="am.reaccept" type="checkbox" /> {{ t('adm.reaccept') }}</label>
          <FormField id="am-c" :label="t('adm.clausesJson')" :hint="t('adm.clausesHint')"><template #default="{ id: fid, describedBy }"><textarea :id="fid" v-model="am.clauses" class="input ltr mono" rows="5" dir="ltr" :aria-describedby="describedBy" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="!am.newVersion || am.reason.length < 5 || am.impact.length < 5">{{ t('adm.amend') }}</button>
        </form>
      </section>

      <section v-if="session.me && p.state === 'published'" class="block">
        <ErrorNote :error="actionError" />
        <p v-if="accepted" role="status" class="ok">{{ t('rules.accepted') }}</p>
        <button v-else type="button" class="btn btn-primary" @click="accept">{{ t('rules.accept') }}</button>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--sp-4); margin: 0; }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.block { margin-block-start: var(--sp-6); }
.table-wrap { overflow-x: auto; }
table { inline-size: 100%; border-collapse: collapse; }
th, td { text-align: start; padding: var(--sp-2) var(--sp-3); border-block-end: 1px solid var(--border); vertical-align: top; }
.notice { margin: 0 0 var(--sp-3); padding: var(--sp-3); background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-md); }
.ok { color: var(--accent-strong); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.mono { font-family: ui-monospace, monospace; }
.row { gap: var(--sp-2); flex-wrap: wrap; }
h3 { margin: var(--sp-3) 0 0; font-size: var(--fs-md); }
</style>
