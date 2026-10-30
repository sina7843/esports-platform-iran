<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { QAlert, QButton, QCard, QCheckbox, QConfirmDialog, QContainer, QDataState, QPageHeader, QSection, QSelect, QStatusBadge, QTextField, fa, formatJalali, num, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';
/**
 * ADM-012 / OPS-001..003: versioned legal texts, legal holds, configurable retention (identity and financial documents
 * stay blocked until an approved policy is recorded), the retention job with a dry run, and data-subject requests.
 */
const esp07: typeof esp07Api = esp07Api;
const KINDS = ['terms', 'privacy', 'consent_marketing', 'retention'];
const holds = useLoad(() => esp07.holds());
const policies = useLoad(() => esp07.retention());
const requests = useLoad(() => esp07.requestQueue());
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>, reload: Array<() => Promise<void>> = [], ok = t('a7.saved')) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    for (const r of reload) await r();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
// legal texts
const doc = reactive({ kind: 'terms', title: '', body: '', requiresAcceptance: true });
const history = ref<Array<{ id: string; version: number; title: string; effectiveAt: string }>>([]);
const showHistory = (kind: string) => act(async () => (history.value = (await esp07.legalHistory(kind)).items), [], '');
// holds
const hold = reactive({ kind: 'principal', id: '', reason: '' });
// retention
const pol = reactive<Record<string, { days: string; note: string }>>({});
const polOf = (id: string, days: number | null, note: string) => (pol[id] ??= { days: days === null ? '' : String(days), note });
const runReport = ref<Awaited<ReturnType<typeof esp07.runRetention>> | null>(null);
// requests
const note = reactive<Record<string, string>>({});
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
const reqAcc = computed({ get: () => doc.requiresAcceptance, set: (v: boolean | null) => { doc.requiresAcceptance = !!v; } });
const confirmRun = ref(false);
const runReal = () => { confirmRun.value = false; void act(async () => (runReport.value = await esp07.runRetention(false)), [], ''); };
const listState = (l: { loading: { value: boolean }; error: { value: ApiClientError | null }; data: { value: { items: unknown[] } | null } }) =>
  (l.error.value ? 'error' : l.loading.value && !l.data.value ? 'loading' : l.data.value && !l.data.value.items.length ? 'empty' : 'content');
</script>

<template>
  <QContainer>
    <div class="k-stack p-apriv">
      <QPageHeader compact :title="t('a7.privacy.title')" :description="t('a7.privacy.lead')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('a7.privacy.title') }]" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>

      <QSection id="legal" small :title="t('a7.privacy.legal')">
        <QCard>
          <form class="k-stack" novalidate @submit.prevent="act(() => esp07.publishLegal({ ...doc, effectiveAt: null }), [() => showHistory(doc.kind)])">
            <div class="p-apriv-grid">
              <QSelect id="lg-k" v-model="doc.kind" :label="t('a7.privacy.kind')" :options="KINDS.map((k) => ({ value: k, label: t(`a7.legal.${k}` as never) }))" />
              <QTextField id="lg-t" v-model="doc.title" :label="t('a7.privacy.docTitle')" />
            </div>
            <QTextField id="lg-b" v-model="doc.body" :label="t('a7.privacy.docBody')" :hint="t('a7.privacy.docHint')" multiline :rows="6" />
            <QCheckbox v-model="reqAcc" :label="t('a7.privacy.requiresAcceptance')" />
            <div class="k-row">
              <QButton type="submit" variant="primary" :disabled="doc.title.trim().length < 3 || doc.body.trim().length < 20">{{ t('a7.privacy.publish') }}</QButton>
              <QButton variant="ghost" size="sm" @click="showHistory(doc.kind)">{{ t('a7.privacy.history') }}</QButton>
            </div>
          </form>
          <ul v-if="history.length" class="p-apriv-log"><li v-for="h in history" :key="h.id">v{{ fa(h.version) }} — <bdi>{{ h.title }}</bdi> · {{ formatJalali(h.effectiveAt) }}</li></ul>
        </QCard>
      </QSection>

      <QSection id="holds" small :title="t('a7.privacy.holds')" :description="t('a7.privacy.holdsLead')">
        <QCard>
          <div class="k-stack">
            <QDataState v-if="listState(holds) !== 'content'" :state="listState(holds) as never" skeleton="rows" @retry="holds.load" />
            <ul v-else class="p-apriv-rows">
              <li v-for="h in holds.data.value!.items" :key="h._id">
                <span><strong>{{ h.scope.kind }}</strong> <bdi class="q-ltr">{{ h.scope.id }}</bdi> — <span dir="auto">{{ h.reason }}</span></span>
                <QButton size="sm" variant="secondary" @click="act(() => esp07.releaseHold(h._id), [holds.load])">{{ t('a7.privacy.release') }}</QButton>
              </li>
            </ul>
            <form class="p-apriv-inline" novalidate @submit.prevent="act(() => esp07.placeHold(hold.kind, hold.id, hold.reason), [holds.load])">
              <QSelect id="hd-k" v-model="hold.kind" :label="t('a7.privacy.kind')" :options="['principal', 'event', 'file', 'dispute'].map((k) => ({ value: k, label: k }))" />
              <QTextField id="hd-i" v-model="hold.id" :label="t('a7.privacy.ref')" ltr />
              <QTextField id="hd-r" v-model="hold.reason" :label="t('a7.reason')" />
              <QButton type="submit" variant="secondary" :disabled="!hold.id || hold.reason.trim().length < 5">{{ t('a7.privacy.place') }}</QButton>
            </form>
          </div>
        </QCard>
      </QSection>

      <QSection id="retention" small :title="t('a7.privacy.retention')" :description="t('a7.privacy.retentionLead')">
        <div class="k-stack">
          <QDataState v-if="!policies.data.value" :state="policies.error.value ? 'error' : 'loading'" skeleton="rows" @retry="policies.load" />
          <QCard v-for="p in policies.data.value?.items ?? []" :key="p._id">
            <div class="k-stack">
              <div class="p-apriv-head"><code class="q-mono q-ltr">{{ p._id }}</code><QStatusBadge :state="p.approved ? 'approved' : 'pending'" /></div>
              <div class="p-apriv-inline">
                <QTextField v-model="polOf(p._id, p.days, p.note).days" :label="t('a7.privacy.days')" input-mode="numeric" ltr :placeholder="t('a7.privacy.forever')" />
                <QTextField v-model="polOf(p._id, p.days, p.note).note" :label="t('a7.privacy.policyRef')" />
                <span class="k-row">
                  <QButton size="sm" variant="green" @click="act(() => esp07.setRetention(p._id, { days: polOf(p._id, p.days, p.note).days ? Number(polOf(p._id, p.days, p.note).days) : null, approved: true, note: polOf(p._id, p.days, p.note).note }), [policies.load])">{{ t('a7.privacy.approve') }}</QButton>
                  <QButton v-if="p.approved" size="sm" variant="secondary" @click="act(() => esp07.setRetention(p._id, { days: p.days, approved: false, note: polOf(p._id, p.days, p.note).note }), [policies.load])">{{ t('a7.privacy.unapprove') }}</QButton>
                </span>
              </div>
            </div>
          </QCard>
          <div class="k-row">
            <QButton variant="secondary" icon="eye" @click="act(async () => (runReport = await esp07.runRetention(true)), [], '')">{{ t('a7.privacy.dryRun') }}</QButton>
            <QButton variant="danger" icon="trash" @click="confirmRun = true">{{ t('a7.privacy.run') }}</QButton>
          </div>
          <QAlert v-if="runReport" :tone="runReport.dryRun ? 'info' : 'success'" :title="runReport.dryRun ? t('a7.privacy.dryRun') : t('a7.privacy.run')">
            <ul class="p-apriv-log">
              <li v-for="(r, k) in runReport.report" :key="k"><bdi class="q-ltr">{{ k }}</bdi>: {{ t('a7.privacy.runLine', { c: num(r.candidates), d: num(r.deleted), h: num(r.held) }) }}</li>
              <li v-if="!Object.keys(runReport.report).length">{{ t('a7.empty') }}</li>
            </ul>
          </QAlert>
        </div>
      </QSection>

      <QSection id="requests" small :title="t('a7.privacy.requests')">
        <QDataState v-if="listState(requests) !== 'content'" :state="listState(requests) as never" skeleton="rows" @retry="requests.load" />
        <div v-else class="k-stack">
          <QCard v-for="r in requests.data.value!.items" :key="r._id">
            <div class="k-stack">
              <div class="p-apriv-head">
                <span><strong>{{ t(`a7.req.${r.kind}` as never) }}</strong> — <bdi class="q-ltr">{{ r.principalId }}</bdi></span>
                <span class="k-row"><QStatusBadge :state="r.state" /><span class="p-apriv-muted">{{ formatJalali(r.createdAt) }}</span></span>
              </div>
              <p v-if="r.detail" class="p-apriv-muted" dir="auto">{{ r.detail }}</p>
              <QAlert v-if="r.state === 'on_hold'" tone="warning">{{ t('a7.privacy.onHold') }}</QAlert>
              <div class="p-apriv-inline">
                <QTextField v-model="note[r._id]" :label="t('a7.privacy.decisionNote')" />
                <span class="k-row">
                  <QButton size="sm" variant="primary" :disabled="(note[r._id] ?? '').trim().length < 5" @click="act(() => esp07.decideRequest(r._id, 'complete', note[r._id] ?? ''), [requests.load])">{{ t('a7.privacy.complete') }}</QButton>
                  <QButton size="sm" variant="secondary" :disabled="(note[r._id] ?? '').trim().length < 5" @click="act(() => esp07.decideRequest(r._id, 'reject', note[r._id] ?? ''), [requests.load])">{{ t('a7.privacy.reject') }}</QButton>
                </span>
              </div>
            </div>
          </QCard>
        </div>
      </QSection>
    </div>
    <QConfirmDialog :open="confirmRun" icon="trash" :title="t('a7.privacy.run')" :message="t('a7.privacy.retentionLead')" :confirm-label="t('a7.privacy.run')" :cancel-label="t('ap.cancel')" @close="confirmRun = false" @confirm="runReal" />
  </QContainer>
</template>

<style scoped>
.p-apriv { gap: var(--space-7); }
.p-apriv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.p-apriv-inline { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: var(--space-3); align-items: end; }
.p-apriv-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-apriv-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-apriv-rows li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); font-size: 14px; }
.p-apriv-log { margin: var(--space-3) 0 0; padding-inline-start: var(--space-5); font-size: 13px; display: flex; flex-direction: column; gap: var(--space-1); }
.p-apriv-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
@media (max-width: 720px) { .p-apriv-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
