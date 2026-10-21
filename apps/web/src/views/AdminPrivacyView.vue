<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
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
</script>

<template>
  <PageHeader :title="t('a7.privacy.title')" :lead="t('a7.privacy.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>

  <section class="card stack" aria-labelledby="lg-h">
    <h2 id="lg-h">{{ t('a7.privacy.legal') }}</h2>
    <form class="stack" @submit.prevent="act(() => esp07.publishLegal({ ...doc, effectiveAt: null }), [() => showHistory(doc.kind)])">
      <div class="grid">
        <FormField id="lg-k" :label="t('a7.privacy.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="doc.kind" class="input"><option v-for="k in KINDS" :key="k" :value="k">{{ t(`a7.legal.${k}` as never) }}</option></select></template></FormField>
        <FormField id="lg-t" :label="t('a7.privacy.docTitle')"><template #default="{ id: fid }"><input :id="fid" v-model="doc.title" class="input" dir="auto" /></template></FormField>
      </div>
      <FormField id="lg-b" :label="t('a7.privacy.docBody')" :hint="t('a7.privacy.docHint')"><template #default="{ id: fid, describedBy }"><textarea :id="fid" v-model="doc.body" class="input" rows="6" dir="auto" :aria-describedby="describedBy" /></template></FormField>
      <label><input v-model="doc.requiresAcceptance" type="checkbox" /> {{ t('a7.privacy.requiresAcceptance') }}</label>
      <div class="row"><button type="submit" class="btn btn-primary" :disabled="doc.title.trim().length < 3 || doc.body.trim().length < 20">{{ t('a7.privacy.publish') }}</button><button type="button" class="btn btn-sm" @click="showHistory(doc.kind)">{{ t('a7.privacy.history') }}</button></div>
    </form>
    <ul v-if="history.length" class="plain small"><li v-for="h in history" :key="h.id">v{{ num(h.version) }} — <bdi>{{ h.title }}</bdi> · <JalaliDate :iso="h.effectiveAt" /></li></ul>
  </section>

  <section class="card stack block" aria-labelledby="hd-h">
    <h2 id="hd-h">{{ t('a7.privacy.holds') }}</h2>
    <p class="muted small">{{ t('a7.privacy.holdsLead') }}</p>
    <DataState :loading="holds.loading.value" :error="holds.error.value" :empty="!!holds.data.value && holds.data.value.items.length === 0" @retry="holds.load">
      <ul v-if="holds.data.value" class="plain stack"><li v-for="h in holds.data.value.items" :key="h._id" class="row between"><span><strong>{{ h.scope.kind }}</strong> <bdi class="ltr">{{ h.scope.id }}</bdi> — <span dir="auto">{{ h.reason }}</span></span><button type="button" class="btn btn-sm" @click="act(() => esp07.releaseHold(h._id), [holds.load])">{{ t('a7.privacy.release') }}</button></li></ul>
    </DataState>
    <form class="grid" @submit.prevent="act(() => esp07.placeHold(hold.kind, hold.id, hold.reason), [holds.load])">
      <FormField id="hd-k" :label="t('a7.privacy.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="hold.kind" class="input"><option v-for="k in ['principal', 'event', 'file', 'dispute']" :key="k" :value="k">{{ k }}</option></select></template></FormField>
      <FormField id="hd-i" :label="t('a7.privacy.ref')"><template #default="{ id: fid }"><input :id="fid" v-model="hold.id" class="input ltr" /></template></FormField>
      <FormField id="hd-r" :label="t('a7.reason')"><template #default="{ id: fid }"><input :id="fid" v-model="hold.reason" class="input" dir="auto" /></template></FormField>
      <button type="submit" class="btn" :disabled="!hold.id || hold.reason.trim().length < 5">{{ t('a7.privacy.place') }}</button>
    </form>
  </section>

  <section class="card stack block" aria-labelledby="rt-h">
    <h2 id="rt-h">{{ t('a7.privacy.retention') }}</h2>
    <p class="muted small">{{ t('a7.privacy.retentionLead') }}</p>
    <DataState :loading="policies.loading.value" :error="policies.error.value" @retry="policies.load">
      <ul v-if="policies.data.value" class="plain stack">
        <li v-for="p in policies.data.value.items" :key="p._id" class="item stack">
          <div class="row between"><strong class="ltr">{{ p._id }}</strong><StatusBadge :state="p.approved ? 'approved' : 'pending'" /></div>
          <div class="row">
            <label>{{ t('a7.privacy.days') }} <input v-model="polOf(p._id, p.days, p.note).days" class="input ltr narrow" inputmode="numeric" :placeholder="t('a7.privacy.forever')" /></label>
            <input v-model="polOf(p._id, p.days, p.note).note" class="input grow" dir="auto" :placeholder="t('a7.privacy.policyRef')" :aria-label="t('a7.privacy.policyRef')" />
            <button type="button" class="btn btn-sm" @click="act(() => esp07.setRetention(p._id, { days: polOf(p._id, p.days, p.note).days ? Number(polOf(p._id, p.days, p.note).days) : null, approved: true, note: polOf(p._id, p.days, p.note).note }), [policies.load])">{{ t('a7.privacy.approve') }}</button>
            <button v-if="p.approved" type="button" class="btn btn-sm" @click="act(() => esp07.setRetention(p._id, { days: p.days, approved: false, note: polOf(p._id, p.days, p.note).note }), [policies.load])">{{ t('a7.privacy.unapprove') }}</button>
          </div>
        </li>
      </ul>
    </DataState>
    <div class="row">
      <button type="button" class="btn" @click="act(async () => (runReport = await esp07.runRetention(true)), [], '')">{{ t('a7.privacy.dryRun') }}</button>
      <button type="button" class="btn btn-primary" @click="act(async () => (runReport = await esp07.runRetention(false)), [], '')">{{ t('a7.privacy.run') }}</button>
    </div>
    <div v-if="runReport" role="status" class="stack small">
      <strong>{{ runReport.dryRun ? t('a7.privacy.dryRun') : t('a7.privacy.run') }}</strong>
      <ul class="plain"><li v-for="(r, k) in runReport.report" :key="k"><bdi class="ltr">{{ k }}</bdi>: {{ t('a7.privacy.runLine', { c: num(r.candidates), d: num(r.deleted), h: num(r.held) }) }}</li><li v-if="!Object.keys(runReport.report).length" class="muted">{{ t('a7.empty') }}</li></ul>
    </div>
  </section>

  <section class="card stack block" aria-labelledby="dr-h">
    <h2 id="dr-h">{{ t('a7.privacy.requests') }}</h2>
    <DataState :loading="requests.loading.value" :error="requests.error.value" :empty="!!requests.data.value && requests.data.value.items.length === 0" @retry="requests.load">
      <ul v-if="requests.data.value" class="plain stack">
        <li v-for="r in requests.data.value.items" :key="r._id" class="item stack">
          <div class="row between"><span><strong>{{ t(`a7.req.${r.kind}` as never) }}</strong> — <bdi class="ltr">{{ r.principalId }}</bdi></span><span class="row small"><StatusBadge :state="r.state" /> <JalaliDate :iso="r.createdAt" /></span></div>
          <p v-if="r.detail" dir="auto" class="small">{{ r.detail }}</p>
          <p v-if="r.state === 'on_hold'" class="warn small">{{ t('a7.privacy.onHold') }}</p>
          <div class="row">
            <input v-model="note[r._id]" class="input grow" dir="auto" :placeholder="t('a7.privacy.decisionNote')" :aria-label="t('a7.privacy.decisionNote')" />
            <button type="button" class="btn btn-sm btn-primary" :disabled="(note[r._id] ?? '').trim().length < 5" @click="act(() => esp07.decideRequest(r._id, 'complete', note[r._id] ?? ''), [requests.load])">{{ t('a7.privacy.complete') }}</button>
            <button type="button" class="btn btn-sm" :disabled="(note[r._id] ?? '').trim().length < 5" @click="act(() => esp07.decideRequest(r._id, 'reject', note[r._id] ?? ''), [requests.load])">{{ t('a7.privacy.reject') }}</button>
          </div>
        </li>
      </ul>
    </DataState>
  </section>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-2); align-items: end; }
.plain { list-style: none; margin: 0; padding: 0; }
.block { margin-block-start: var(--sp-4); }
.item { border-block-end: 1px solid var(--border); padding-block: var(--sp-2); }
.narrow { inline-size: 7rem; }
.grow { flex: 1 1 14rem; }
.small { font-size: var(--fs-xs); }
.warn { color: var(--warn); }
.ok { color: var(--ok); }
h2, p { margin: 0; }
</style>
