<script setup lang="ts">
import { reactive, ref } from 'vue';
import { zonedWallTimeToUtc } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import MoneyLabel from '../components/MoneyLabel.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const call: typeof esp03 = esp03;

/**
 * FIN-004..012: reconciliation queue (money without a disposition stays visible here), refunds, manual payments,
 * prices, discounts, settlements, prize payouts and the accounting export. Finance authority never grants refereeing.
 */
type Obj = Record<string, unknown>;
const { data: q, loading, error, load } = useLoad(() => esp03.reconciliation());
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>, msg = '✓') {
  failure.value = null;
  notice.value = '';
  try {
    const r = await fn();
    notice.value = typeof r === 'string' ? r : msg;
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const key = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const tz = (s: string) => zonedWallTimeToUtc(s);

const refund = reactive({ paymentId: '', amountRial: 0, reason: 'manual', approvalId: '', evidenceFileId: '', idempotencyKey: key() });
function submitRefund() {
  return act(async () => {
    const r = await esp03.refund(refund.paymentId, { amountRial: refund.amountRial, reason: refund.reason, idempotencyKey: refund.idempotencyKey, approvalId: refund.approvalId || null, evidenceFileId: refund.evidenceFileId || null });
    refund.idempotencyKey = key(); // a new request needs a new key; resubmitting the same form is idempotent
    return `${t('fin.refundState')}: ${String(r.state)}`;
  });
}
const manual = reactive({ orderId: '', evidenceFileId: '', approvalId: '', note: '' });
const price = reactive({ productKey: 'subscription:player_pro', kind: 'subscription', amountRial: 0, feeBps: 0, effectiveFrom: '' });
const history = ref<Obj[]>([]);
const disc = reactive({ code: '', kind: 'percent', value: 10, appliesTo: 'entry', maxUses: 100, validTo: '' });
const bal = reactive({ orgId: '', payable: null as number | null, amountRial: 0, approvalId: '', evidenceFileId: '', idempotencyKey: key() });
const payout = reactive({ prizeId: '', approvalId: '', providerRef: '', evidenceFileId: '', version: 0 });
const ledger = reactive({ from: '', to: '', account: '' });
function ledgerHref() {
  const qs = new URLSearchParams();
  if (ledger.from) qs.set('from', tz(ledger.from));
  if (ledger.to) qs.set('to', tz(ledger.to));
  if (ledger.account) qs.set('account', ledger.account);
  return `${esp03.ledgerCsvUrl()}${qs.size ? `?${qs}` : ''}`;
}
const rows = (x: Obj[] | undefined) => x ?? [];
</script>

<template>
  <PageHeader :title="t('nav.finance')" :lead="t('fin.lead')">
    <template #actions><RouterLink class="btn btn-sm" to="/finance/approvals">{{ t('nav.approvals') }}</RouterLink></template>
  </PageHeader>
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="notice">{{ notice }}</p>

  <section class="card stack block">
    <div class="row between">
      <h2>{{ t('fin.reconciliation') }}</h2>
      <button type="button" class="btn btn-sm" @click="act(() => call.runReconciliation())">{{ t('fin.runReconciliation') }}</button>
    </div>
    <DataState :loading="loading" :error="error" @retry="load">
      <template v-if="q">
        <h3>{{ t('fin.unknownPayments') }} ({{ num(q.unknownPayments.length) }})</h3>
        <ul class="list"><li v-for="p in rows(q.unknownPayments)" :key="String(p._id)"><bdi class="ltr">{{ p._id }}</bdi> — <bdi class="ltr">{{ p.orderId }}</bdi> — <MoneyLabel :rial="Number(p.amountRial)" /> <StatusBadge :state="String(p.state)" /> <JalaliDate :iso="String(p.createdAt)" /></li></ul>
        <h3>{{ t('fin.disagreements') }} ({{ num(q.providerVerifiedAfterFailure.length) }})</h3>
        <ul class="list"><li v-for="p in rows(q.providerVerifiedAfterFailure)" :key="String(p._id)"><bdi class="ltr">{{ p._id }}</bdi> — <MoneyLabel :rial="Number(p.amountRial)" /> <StatusBadge :state="String(p.state)" /></li></ul>
        <h3>{{ t('fin.openRefunds') }} ({{ num(q.openRefunds.length) }})</h3>
        <ul class="list"><li v-for="r in rows(q.openRefunds)" :key="String(r._id)"><bdi class="ltr">{{ r._id }}</bdi> — <MoneyLabel :rial="Number(r.amountRial)" /> — {{ r.reason }} <StatusBadge :state="String(r.state)" /></li></ul>
        <h3>{{ t('fin.paidNoCapacity') }} ({{ num(q.paidWithoutCapacity.length) }})</h3>
        <ul class="list"><li v-for="r in rows(q.paidWithoutCapacity)" :key="String(r.registrationId)"><bdi class="ltr">{{ r.registrationId }}</bdi> — <bdi class="ltr">{{ r.orderId }}</bdi> — <MoneyLabel :rial="Number(r.totalRial)" /></li></ul>
        <p v-if="!q.unknownPayments.length && !q.providerVerifiedAfterFailure.length && !q.openRefunds.length && !q.paidWithoutCapacity.length" class="muted">{{ t('fin.queueEmpty') }}</p>
      </template>
    </DataState>
  </section>

  <div class="cols">
    <form class="card stack" novalidate @submit.prevent="submitRefund">
      <h2>{{ t('fin.refund') }}</h2>
      <FormField id="rf-p" :label="t('fin.paymentId')" required><template #default="{ id }"><input :id="id" v-model="refund.paymentId" class="input ltr" /></template></FormField>
      <FormField id="rf-a" :label="t('evm.amountRial')" required><template #default="{ id }"><input :id="id" v-model.number="refund.amountRial" type="number" min="1" class="input ltr" /></template></FormField>
      <p v-if="refund.amountRial > 0" class="muted"><MoneyLabel :rial="refund.amountRial" /></p>
      <FormField id="rf-r" :label="t('evm.reason')"><template #default="{ id }"><select :id="id" v-model="refund.reason" class="input ltr"><option v-for="r in ['withdrawal', 'event_cancelled', 'disqualification', 'postponement', 'capacity_unavailable', 'manual']" :key="r" :value="r">{{ r }}</option></select></template></FormField>
      <FormField id="rf-ap" :label="t('evm.approvalId')" :hint="t('fin.approvalHint')"><template #default="{ id, describedBy }"><input :id="id" v-model="refund.approvalId" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
      <FormField id="rf-ev" :label="t('fin.evidenceFileId')" :hint="t('fin.evidenceHint')"><template #default="{ id, describedBy }"><input :id="id" v-model="refund.evidenceFileId" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
      <p class="muted">{{ t('fin.idempotencyKey') }}: <bdi class="ltr code">{{ refund.idempotencyKey }}</bdi></p>
      <button type="submit" class="btn btn-primary" :disabled="!refund.paymentId || refund.amountRial <= 0">{{ t('fin.requestRefund') }}</button>
    </form>

    <form class="card stack" novalidate @submit.prevent="act(() => call.manualPayment({ ...manual }))">
      <h2>{{ t('fin.manualPayment') }}</h2>
      <p class="muted">{{ t('fin.manualHelp') }}</p>
      <FormField id="mp-o" :label="t('pay.orderId')" required><template #default="{ id }"><input :id="id" v-model="manual.orderId" class="input ltr" /></template></FormField>
      <FormField id="mp-e" :label="t('fin.evidenceFileId')" required><template #default="{ id }"><input :id="id" v-model="manual.evidenceFileId" class="input ltr" /></template></FormField>
      <FormField id="mp-a" :label="t('evm.approvalId')" required><template #default="{ id }"><input :id="id" v-model="manual.approvalId" class="input ltr" /></template></FormField>
      <FormField id="mp-n" :label="t('fin.note')" required><template #default="{ id }"><textarea :id="id" v-model="manual.note" class="input" rows="2" dir="auto" /></template></FormField>
      <button type="submit" class="btn" :disabled="!manual.orderId || !manual.evidenceFileId || !manual.approvalId || manual.note.length < 3">{{ t('fin.recordManual') }}</button>
    </form>

    <form class="card stack" novalidate @submit.prevent="act(() => call.priceVersion({ ...price, effectiveFrom: price.effectiveFrom ? tz(price.effectiveFrom) : new Date().toISOString() }))">
      <h2>{{ t('fin.prices') }}</h2>
      <FormField id="pv-k" :label="t('fin.productKey')"><template #default="{ id }"><input :id="id" v-model="price.productKey" class="input ltr" /></template></FormField>
      <FormField id="pv-t" :label="t('mgmt.kind')"><template #default="{ id }"><select :id="id" v-model="price.kind" class="input ltr"><option v-for="k in ['entry', 'ticket', 'subscription', 'organizer_service']" :key="k" :value="k">{{ k }}</option></select></template></FormField>
      <FormField id="pv-a" :label="t('evm.amountRial')"><template #default="{ id }"><input :id="id" v-model.number="price.amountRial" type="number" min="0" class="input ltr" /></template></FormField>
      <FormField id="pv-f" :label="t('fin.feeBps')" :hint="t('fin.feeBpsHint')"><template #default="{ id, describedBy }"><input :id="id" v-model.number="price.feeBps" type="number" min="0" max="5000" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
      <FormField id="pv-e" :label="t('fin.effectiveFrom')"><template #default="{ id }"><input :id="id" v-model="price.effectiveFrom" type="datetime-local" class="input" /></template></FormField>
      <div class="row">
        <button type="submit" class="btn">{{ t('fin.newVersion') }}</button>
        <button type="button" class="btn btn-sm" @click="act(async () => { history = (await call.priceHistory(price.productKey)).items; })">{{ t('fin.history') }}</button>
      </div>
      <ul class="list"><li v-for="h in history" :key="String(h._id)">v{{ num(Number(h.version)) }} — <MoneyLabel :rial="Number(h.amountRial)" /> — <JalaliDate :iso="String(h.effectiveFrom)" /></li></ul>
    </form>

    <form class="card stack" novalidate @submit.prevent="act(() => call.discount({ code: disc.code, kind: disc.kind, value: disc.value, appliesTo: [disc.appliesTo], maxUses: disc.maxUses, validFrom: null, validTo: disc.validTo ? tz(disc.validTo) : null }))">
      <h2>{{ t('fin.discounts') }}</h2>
      <FormField id="dc-code" :label="t('fin.code')"><template #default="{ id }"><input :id="id" v-model="disc.code" class="input ltr" pattern="[A-Z0-9_-]+" /></template></FormField>
      <FormField id="dc-kind" :label="t('mgmt.kind')"><template #default="{ id }"><select :id="id" v-model="disc.kind" class="input"><option value="percent">%</option><option value="amount">{{ t('evm.amountRial') }}</option></select></template></FormField>
      <FormField id="dc-val" :label="t('fin.value')"><template #default="{ id }"><input :id="id" v-model.number="disc.value" type="number" min="1" class="input ltr" /></template></FormField>
      <FormField id="dc-app" :label="t('fin.appliesTo')"><template #default="{ id }"><select :id="id" v-model="disc.appliesTo" class="input ltr"><option v-for="k in ['entry', 'ticket', 'subscription', 'organizer_service']" :key="k" :value="k">{{ k }}</option></select></template></FormField>
      <FormField id="dc-max" :label="t('fin.maxUses')"><template #default="{ id }"><input :id="id" v-model.number="disc.maxUses" type="number" min="1" class="input ltr" /></template></FormField>
      <FormField id="dc-to" :label="t('fin.validTo')"><template #default="{ id }"><input :id="id" v-model="disc.validTo" type="datetime-local" class="input" /></template></FormField>
      <button type="submit" class="btn" :disabled="disc.code.length < 3">{{ t('fin.createDiscount') }}</button>
    </form>

    <section class="card stack">
      <h2>{{ t('fin.settlement') }}</h2>
      <FormField id="st-o" :label="t('evm.org')"><template #default="{ id }"><input :id="id" v-model="bal.orgId" class="input ltr" /></template></FormField>
      <button type="button" class="btn btn-sm" :disabled="!bal.orgId" @click="act(async () => { bal.payable = (await call.balance(bal.orgId)).payableRial; })">{{ t('fin.balance') }}</button>
      <p v-if="bal.payable !== null">{{ t('evm.payable') }}: <MoneyLabel :rial="bal.payable" /></p>
      <form class="stack" novalidate @submit.prevent="act(async () => { await call.settle(bal.orgId, { amountRial: bal.amountRial, approvalId: bal.approvalId, evidenceFileId: bal.evidenceFileId, idempotencyKey: bal.idempotencyKey }); bal.idempotencyKey = key(); })">
        <FormField id="st-a" :label="t('evm.amountRial')"><template #default="{ id }"><input :id="id" v-model.number="bal.amountRial" type="number" min="1" class="input ltr" /></template></FormField>
        <FormField id="st-ap" :label="t('evm.approvalId')"><template #default="{ id }"><input :id="id" v-model="bal.approvalId" class="input ltr" /></template></FormField>
        <FormField id="st-ev" :label="t('fin.evidenceFileId')"><template #default="{ id }"><input :id="id" v-model="bal.evidenceFileId" class="input ltr" /></template></FormField>
        <button type="submit" class="btn" :disabled="!bal.orgId || bal.amountRial <= 0 || !bal.approvalId || !bal.evidenceFileId">{{ t('fin.settle') }}</button>
      </form>
    </section>

    <section class="card stack">
      <h2>{{ t('fin.prizePayout') }}</h2>
      <p class="muted">{{ t('fin.prizeHelp') }}</p>
      <FormField id="pp-id" :label="t('fin.prizeId')"><template #default="{ id }"><input :id="id" v-model="payout.prizeId" class="input ltr" /></template></FormField>
      <FormField id="pp-v" :label="t('fin.version')"><template #default="{ id }"><input :id="id" v-model.number="payout.version" type="number" min="0" class="input ltr" /></template></FormField>
      <FormField id="pp-ap" :label="t('evm.approvalId')"><template #default="{ id }"><input :id="id" v-model="payout.approvalId" class="input ltr" /></template></FormField>
      <FormField id="pp-ref" :label="t('fin.providerRef')"><template #default="{ id }"><input :id="id" v-model="payout.providerRef" class="input ltr" /></template></FormField>
      <FormField id="pp-ev" :label="t('fin.evidenceFileId')"><template #default="{ id }"><input :id="id" v-model="payout.evidenceFileId" class="input ltr" /></template></FormField>
      <div class="row">
        <button type="button" class="btn" :disabled="!payout.prizeId || !payout.approvalId" @click="act(() => call.prizePayout(payout.prizeId, { approvalId: payout.approvalId, evidenceFileId: null, providerRef: null, expectedVersion: payout.version }))">{{ t('fin.startPayout') }}</button>
        <button type="button" class="btn" :disabled="!payout.prizeId || (!payout.providerRef && !payout.evidenceFileId)" @click="act(() => call.prizePaid(payout.prizeId, { evidenceFileId: payout.evidenceFileId || null, providerRef: payout.providerRef || null, expectedVersion: payout.version }))">{{ t('fin.confirmPaid') }}</button>
      </div>
    </section>

    <section class="card stack">
      <h2>{{ t('fin.ledgerExport') }}</h2>
      <FormField id="lg-f" :label="t('fin.from')"><template #default="{ id }"><input :id="id" v-model="ledger.from" type="datetime-local" class="input" /></template></FormField>
      <FormField id="lg-t" :label="t('fin.to')"><template #default="{ id }"><input :id="id" v-model="ledger.to" type="datetime-local" class="input" /></template></FormField>
      <FormField id="lg-a" :label="t('fin.account')"><template #default="{ id }"><input :id="id" v-model="ledger.account" class="input ltr" /></template></FormField>
      <a class="btn" :href="ledgerHref()" download>{{ t('fin.downloadCsv') }}</a>
    </section>
  </div>
</template>

<style scoped>
.block { margin-block-end: var(--sp-4); }
.between { justify-content: space-between; }
.row { flex-wrap: wrap; gap: var(--sp-2); }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.code { font-family: monospace; font-size: var(--fs-xs); }
.notice { color: var(--ok); }
h2, h3, p { margin: 0; }
h3 { font-size: var(--fs-md, 1rem); margin-block-start: var(--sp-2); }
</style>
