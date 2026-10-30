<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  QAlert, QBadge, QButton, QCard, QCheckbox, QConfirmDialog, QContainer, QDataState, QDataTable, QFacts, QPageHeader, QSection, QTextField, formatJalali,
  type QDataTableColumn,
} from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp02, type RulesPackage } from '../api/esp02';
import { toClientError } from '../errors';
import { stateLabel, t, type MessageKey } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';

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

const ds = useDataState({ loading: computed(() => loading.value && !p.value), error });
const withdrawing = ref(false);
type Clause = RulesPackage['clauses'][number];
const clauseCols = computed<QDataTableColumn<Clause>[]>(() => [
  { key: 'key', header: t('rp.clauseId') }, { key: 'kind', header: t('rp.kind') }, { key: 'value', header: t('rp.value') },
  { key: 'allowed', header: t('rules.allowed') }, { key: 'citation', header: t('rules.citation') },
]);
const facts = computed(() => {
  const x = p.value;
  if (!x) return [];
  return [
    { label: t('rules.version'), value: x.versionLabel, ltr: true },
    { label: t('rules.reviewedAt'), value: x.reviewedAt ? formatJalali(x.reviewedAt, 'date') : '—' },
    { label: t('rules.nextReview'), value: x.nextReviewDueAt ? formatJalali(x.nextReviewDueAt, 'date') : '—' },
    { label: t('rules.applicability'), value: x.applicability },
    ...(x.adaptedFrom ? [{ label: t('rules.adaptedFrom'), value: `${x.adaptedFrom.packageId} — ${x.adaptedFrom.differences}` }] : []),
  ];
});
const rvTranslation = computed({ get: () => rv.translation, set: (v: boolean | null) => { rv.translation = !!v; } });
const rvRights = computed({ get: () => rv.rights, set: (v: boolean | null) => { rv.rights = !!v; } });
const amReaccept = computed({ get: () => am.reaccept, set: (v: boolean | null) => { am.reaccept = !!v; } });
function allowed(c: RulesPackage['clauses'][number]): string {
  if (!c.allowed) return '—';
  if (c.allowed.options) return c.allowed.options.join(' / ');
  return `${c.allowed.min ?? '…'} – ${c.allowed.max ?? '…'}`;
}
</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !p" v-bind="ds.props.value" @retry="load" />
    <div v-else class="k-stack p-rp">
      <QPageHeader
        :title="p.title" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('rules.title'), href: '/rules' }, { label: p.title }]"
        :status="{ label: stateLabel(p.state), tone: p.state === 'published' ? 'success' : 'neutral' }" :description="t('rules.notOfficial')"
      >
        <template v-if="session.me && p.state === 'published'" #actions>
          <QBadge v-if="accepted" tone="success" icon="check">{{ t('rules.accepted') }}</QBadge>
          <QButton v-else variant="primary" icon="check" @click="accept">{{ t('rules.accept') }}</QButton>
        </template>
      </QPageHeader>
      <QAlert v-if="p.label" tone="warning">{{ p.label }}</QAlert>
      <QAlert v-if="p.testOnly" tone="info">{{ t('rules.trialHelp') }}</QAlert>
      <QAlert v-if="p.supersededBy" tone="warning" :actions="[{ label: t('rp.newer'), href: `/rules/${p.supersededBy}` }]">{{ t('rules.superseded') }}</QAlert>
      <QAlert v-if="actionError" tone="danger">{{ actionError.message }}</QAlert>
      <QCard>
        <div class="k-stack">
          <QFacts :columns="3" :items="facts" />
          <p v-if="p.sourceUrl" class="p-rp-muted">{{ t('rules.source') }}: <a :href="p.sourceUrl" rel="noopener noreferrer" target="_blank" dir="ltr">{{ p.sourceUrl }}</a></p>
          <p v-if="!p.translationFa.reviewed" class="p-rp-muted">{{ t('rules.translationUnreviewed') }}</p>
        </div>
      </QCard>

      <QSection id="clauses" small :title="t('rules.clauses')">
        <QDataTable :caption="t('rules.clauses')" caption-hidden row-key="key" row-header="key" :columns="clauseCols" :rows="p.clauses">
          <template #cell-key="{ row }"><code class="q-mono q-ltr">{{ row.key }}</code></template>
          <template #cell-kind="{ row }"><QBadge :tone="row.kind === 'mandatory' ? 'info' : 'neutral'">{{ t(`rules.kind.${row.kind}` as MessageKey) }}</QBadge></template>
          <template #cell-value="{ row }"><bdi class="q-ltr">{{ row.value === null ? '—' : String(row.value) }}</bdi></template>
          <template #cell-allowed="{ row }"><bdi class="q-ltr">{{ allowed(row) }}</bdi></template>
          <template #cell-citation="{ row }"><span dir="auto">{{ row.citation }}</span></template>
        </QDataTable>
      </QSection>

      <QSection v-if="session.me && p.state === 'published'" id="validate" small :title="t('adm.validate')">
        <QCard>
          <div class="k-stack">
            <QTextField id="vs-json" v-model="settingsText" :label="t('adm.settingsJson')" multiline :rows="3" ltr />
            <div><QButton variant="secondary" size="sm" @click="validate">{{ t('adm.validate') }}</QButton></div>
            <QAlert v-if="settingsResult && settingsResult.ok" tone="success">{{ t('adm.valid') }}</QAlert>
            <ul v-else-if="settingsResult" class="p-rp-list" role="status">
              <li v-for="v in settingsResult.violations" :key="v.key"><code class="q-mono q-ltr">{{ v.key }}</code>: <bdi>{{ v.reason }}</bdi><span v-if="v.citation"> — {{ t('rules.citation') }}: <bdi>{{ v.citation }}</bdi></span></li>
            </ul>
          </div>
        </QCard>
      </QSection>

      <QSection v-if="p.blockers !== undefined" id="manage" small :title="t('adm.blockers')">
        <QCard>
          <div class="k-stack">
            <ul v-if="p.blockers.length" class="p-rp-list"><li v-for="b in p.blockers" :key="b"><bdi>{{ b }}</bdi></li></ul>
            <p v-else class="p-rp-muted">—</p>
            <QAlert v-if="notice" tone="success"><bdi class="q-ltr">{{ notice }}</bdi></QAlert>
            <div class="k-row">
              <QButton v-if="p.state === 'draft'" variant="secondary" size="sm" @click="transition('submit_for_review')">{{ t('rp.submit') }}</QButton>
              <QButton v-if="p.state === 'under_review'" variant="secondary" size="sm" @click="transition('return_to_draft')">{{ t('rp.toDraft') }}</QButton>
              <QButton v-if="p.state === 'under_review'" variant="primary" size="sm" :disabled="p.blockers.length > 0" @click="transition('publish')">{{ t('rp.publish') }}</QButton>
              <QButton v-if="p.state === 'published'" variant="danger" size="sm" @click="withdrawing = true">{{ t('rp.withdraw') }}</QButton>
            </div>
            <form v-if="p.state !== 'published'" class="k-stack" novalidate @submit.prevent="review">
              <h3 class="h4 p-rp-h">{{ t('adm.review') }}</h3>
              <QCheckbox v-model="rvTranslation" :label="t('adm.translationReviewed')" />
              <QCheckbox v-model="rvRights" :label="t('adm.rightsReviewed')" />
              <QTextField id="rv-ack" v-model="rv.ack" :label="t('adm.ackKeys')" ltr />
              <div><QButton type="submit" variant="secondary" size="sm">{{ t('adm.review') }}</QButton></div>
            </form>
            <form class="k-stack" novalidate @submit.prevent="conflict">
              <h3 class="h4 p-rp-h">{{ t('adm.conflict') }}</h3>
              <QTextField id="cf-d" v-model="cf.description" :label="t('mgmt.description')" />
              <QTextField id="cf-r" v-model="cf.resolution" :label="t('adm.resolution')" />
              <div><QButton type="submit" variant="secondary" size="sm" :disabled="!cf.description">{{ t('adm.conflict') }}</QButton></div>
            </form>
            <form v-if="p.state === 'published'" class="k-stack" novalidate @submit.prevent="amend">
              <h3 class="h4 p-rp-h">{{ t('adm.amend') }}</h3>
              <QTextField id="am-v" v-model="am.newVersion" :label="t('adm.newVersion')" ltr />
              <QTextField id="am-r" v-model="am.reason" :label="t('adm.reason')" />
              <QTextField id="am-i" v-model="am.impact" :label="t('adm.impact')" multiline :rows="2" />
              <QCheckbox v-model="amReaccept" :label="t('adm.reaccept')" />
              <QTextField id="am-c" v-model="am.clauses" :label="t('adm.clausesJson')" :hint="t('adm.clausesHint')" multiline :rows="5" ltr />
              <div><QButton type="submit" variant="secondary" size="sm" :disabled="!am.newVersion || am.reason.length < 5 || am.impact.length < 5">{{ t('adm.amend') }}</QButton></div>
            </form>
          </div>
        </QCard>
      </QSection>
    </div>
    <QConfirmDialog :require-reason="false"
      :open="withdrawing" :title="t('rp.withdrawTitle')" :message="t('rp.withdrawBody')" :confirm-label="t('rp.withdraw')" :cancel-label="t('rp.cancel')"
      @close="withdrawing = false" @confirm="withdrawing = false; transition('withdraw')"
    />
  </QContainer>
</template>

<style scoped>
.p-rp { gap: var(--space-6); }
.p-rp-h { margin: 0; }
.p-rp-muted { margin: 0; color: var(--ink-muted); font-size: 14px; }
.p-rp-list { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); font-size: 14px; }
</style>
