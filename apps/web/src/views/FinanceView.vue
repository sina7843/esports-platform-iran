<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { QAlert, QButton, QCard, QCode, QContainer, QDataState, QDataTable, QDateField, QDrawer, QEmptyState, QMoney, QPageHeader, QSelect, QStatTile, QStatusBadge, QTabs, QTextField, fa, formatJalali, num, toman, useToast, type QDataTableColumn } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
/** QDateField returns Tehran wall time with its offset; the API takes UTC. */
const tz = (s: string) => new Date(s).toISOString();

const refund = reactive({ paymentId: '', amountRial: '', reason: 'manual', approvalId: '', evidenceFileId: '', idempotencyKey: key() });
function submitRefund() {
  return act(async () => {
    const r = await esp03.refund(refund.paymentId, { amountRial: Number(refund.amountRial), reason: refund.reason, idempotencyKey: refund.idempotencyKey, approvalId: refund.approvalId || null, evidenceFileId: refund.evidenceFileId || null });
    refund.idempotencyKey = key(); // a new request needs a new key; resubmitting the same form is idempotent
    refundOpen.value = false;
    return `${t('fin.refundState')}: ${String(r.state)}`;
  });
}
const manual = reactive({ orderId: '', evidenceFileId: '', approvalId: '', note: '' });
const price = reactive({ productKey: 'subscription:player_pro', kind: 'subscription', amountRial: '0', feeBps: '0', effectiveFrom: null as string | null });
const history = ref<Obj[]>([]);
const disc = reactive({ code: '', kind: 'percent', value: '10', appliesTo: 'entry', maxUses: '100', validTo: null as string | null });
const bal = reactive({ orgId: '', payable: null as number | null, amountRial: '0', approvalId: '', evidenceFileId: '', idempotencyKey: key() });
const payout = reactive({ prizeId: '', approvalId: '', providerRef: '', evidenceFileId: '', version: '0' });
const ledger = reactive({ from: null as string | null, to: null as string | null, account: '' });
function ledgerHref() {
  const qs = new URLSearchParams();
  if (ledger.from) qs.set('from', tz(ledger.from));
  if (ledger.to) qs.set('to', tz(ledger.to));
  if (ledger.account) qs.set('account', ledger.account);
  return `${esp03.ledgerCsvUrl()}${qs.size ? `?${qs}` : ''}`;
}
const rows = (x: Obj[] | undefined) => x ?? [];
const { push } = useToast();
const report = () => {
  if (failure.value) push({ tone: 'danger', message: failure.value.message });
  else if (notice.value) push({ tone: 'success', message: notice.value, duration: 3000 });
};
const toast = async (fn: () => Promise<unknown>, msg = t('fin.done')) => { await act(fn, msg); report(); };
const doRefund = async () => { await submitRefund(); report(); };
const refundOpen = ref(false);
const manualOpen = ref(false);
const running = ref(false);
async function runRecon() {
  running.value = true;
  await toast(() => call.runReconciliation(), t('fin.reconDone'));
  running.value = false;
}
const tab = ref('recon');
const cat = ref<'unknown' | 'disagree' | 'refunds' | 'nocap'>('unknown');
const CATS = [
  { key: 'unknown', icon: 'alert', label: 'fin.unknownPayments' },
  { key: 'disagree', icon: 'refresh', label: 'fin.disagreements' },
  { key: 'refunds', icon: 'wallet', label: 'fin.openRefunds' },
  { key: 'nocap', icon: 'users', label: 'fin.paidNoCapacity' },
] as const;
const lists = computed<Record<typeof cat.value, Obj[]>>(() => ({
  unknown: rows(q.value?.unknownPayments), disagree: rows(q.value?.providerVerifiedAfterFailure), refunds: rows(q.value?.openRefunds), nocap: rows(q.value?.paidWithoutCapacity),
}));
const total = computed(() => Object.values(lists.value).reduce((n, l) => n + l.length, 0));
const tabs = computed(() => [
  { key: 'recon', label: t('fin.reconciliation'), icon: 'refresh' as const, count: total.value },
  { key: 'prices', label: t('fin.pricesTab'), icon: 'ticket' as const },
  { key: 'settle', label: t('fin.settlement'), icon: 'wallet' as const },
  { key: 'prizes', label: t('fin.prizePayout'), icon: 'award' as const },
  { key: 'ledger', label: t('fin.ledgerExport'), icon: 'file' as const },
]);
const cols = computed<QDataTableColumn<Obj>[]>(() => {
  const id = { key: 'id', header: t('fin.colId') };
  const amount = { key: 'amount', header: t('fin.colAmount'), align: 'end' as const };
  if (cat.value === 'nocap') return [id, { key: 'orderId', header: t('pay.orderId') }, amount];
  if (cat.value === 'refunds') return [id, amount, { key: 'reason', header: t('evm.reason') }, { key: 'state', header: t('fin.colState') }];
  return [id, { key: 'orderId', header: t('pay.orderId') }, amount, { key: 'state', header: t('fin.colState') }, { key: 'createdAt', header: t('fin.colTime') }];
});
const KINDS = ['entry', 'ticket', 'subscription', 'organizer_service'].map((k) => ({ value: k, label: k }));
const REASONS = ['withdrawal', 'event_cancelled', 'disqualification', 'postponement', 'capacity_unavailable', 'manual'].map((k) => ({ value: k, label: k }));
const feePct = computed(() => t('fin.feePct', { p: fa((Number(price.feeBps) || 0) / 100) }));
const tomanOf = (v: number | string) => (Number(v) > 0 ? toman(Number(v)) : '');
const priceSubmit = () => toast(() => call.priceVersion({ ...price, amountRial: Number(price.amountRial), feeBps: Number(price.feeBps), effectiveFrom: price.effectiveFrom ? tz(price.effectiveFrom) : new Date().toISOString() }));
const discSubmit = () => toast(() => call.discount({ code: disc.code, kind: disc.kind, value: Number(disc.value), appliesTo: [disc.appliesTo], maxUses: Number(disc.maxUses), validFrom: null, validTo: disc.validTo ? tz(disc.validTo) : null }));
const settleSubmit = () => toast(async () => { await call.settle(bal.orgId, { amountRial: Number(bal.amountRial), approvalId: bal.approvalId, evidenceFileId: bal.evidenceFileId, idempotencyKey: bal.idempotencyKey }); bal.idempotencyKey = key(); });
const manualSubmit = () => toast(async () => { await call.manualPayment({ ...manual }); manualOpen.value = false; });
</script>

<template>
  <QContainer>
    <div class="k-stack p-fin">
      <QPageHeader compact :title="t('nav.finance')" :description="t('fin.lead')">
        <template #actions>
          <QButton variant="secondary" icon="check-circle" href="/finance/approvals">{{ t('nav.approvals') }}</QButton>
          <QButton icon="wallet" @click="refundOpen = true">{{ t('fin.refund') }}</QButton>
        </template>
      </QPageHeader>

      <QTabs v-model="tab" variant="line" :items="tabs" :aria-label="t('nav.finance')">
        <template #panel="{ item }">
          <div v-if="item.key === 'recon'" class="k-stack">
            <QDataState v-if="!q" :state="error ? 'error' : 'loading'" :error="error" skeleton="rows" @retry="load" />
            <template v-else>
              <div class="p-fin-tiles">
                <button v-for="c in CATS" :key="c.key" type="button" class="p-fin-tile" :aria-pressed="cat === c.key" @click="cat = c.key">
                  <QStatTile :label="t(c.label)" :value="fa(lists[c.key].length)" :icon="c.icon" :caption="t('fin.fromQueue')" />
                </button>
              </div>
              <div class="p-fin-bar">
                <p class="p-fin-muted">{{ t('fin.queueHint') }}</p>
                <span class="k-row">
                  <QButton variant="secondary" icon="file" @click="manualOpen = true">{{ t('fin.manualPayment') }}</QButton>
                  <QButton variant="ghost" icon="refresh" :loading="running" @click="runRecon">{{ t('fin.runReconciliation') }}</QButton>
                </span>
              </div>
              <QEmptyState v-if="!total" icon="check-circle" :title="t('fin.queueEmpty')" />
              <QEmptyState v-else-if="!lists[cat].length" compact icon="check" :title="t('fin.catEmpty')" />
              <QDataTable v-else :caption="t(CATS.find((c) => c.key === cat)!.label)" row-header="id" :row-key="(r: Obj) => String(r._id ?? r.registrationId)" :columns="cols" :rows="lists[cat]">
                <template #cell-id="{ row }"><code class="q-mono q-ltr">{{ row._id ?? row.registrationId }}</code></template>
                <template #cell-orderId="{ row }"><code class="q-mono q-ltr">{{ row.orderId }}</code></template>
                <template #cell-amount="{ row }">{{ num(Number(row.amountRial ?? row.totalRial) / 10) }}</template>
                <template #cell-state="{ row }"><QStatusBadge :state="String(row.state)" /></template>
                <template #cell-reason="{ row }"><bdi class="q-ltr">{{ row.reason }}</bdi></template>
                <template #cell-createdAt="{ row }">{{ row.createdAt ? formatJalali(String(row.createdAt)) : '—' }}</template>
              </QDataTable>
            </template>
          </div>

          <div v-else-if="item.key === 'prices'" class="p-fin-cols">
            <QCard>
              <form class="k-stack" novalidate @submit.prevent="priceSubmit">
                <h2 class="h4 p-fin-h">{{ t('fin.prices') }}</h2>
                <QTextField id="pv-k" v-model="price.productKey" :label="t('fin.productKey')" ltr />
                <QSelect id="pv-t" v-model="price.kind" :label="t('mgmt.kind')" :options="KINDS" />
                <QTextField id="pv-a" v-model="price.amountRial" :label="t('evm.amountRial')" type="number" ltr :hint="tomanOf(price.amountRial)" />
                <QTextField id="pv-f" v-model="price.feeBps" :label="t('fin.feeBps')" type="number" ltr :hint="`${t('fin.feeBpsHint')} · ${feePct}`" />
                <QDateField id="pv-e" v-model="price.effectiveFrom" :label="t('fin.effectiveFrom')" with-time disable-past />
                <div class="k-row">
                  <QButton type="submit" variant="green">{{ t('fin.newVersion') }}</QButton>
                  <QButton variant="ghost" icon="clock" @click="toast(async () => { history = (await call.priceHistory(price.productKey)).items; })">{{ t('fin.history') }}</QButton>
                </div>
                <ul v-if="history.length" class="p-fin-list">
                  <li v-for="h in history" :key="String(h._id)">v{{ fa(Number(h.version)) }} — <QMoney :rial="Number(h.amountRial)" size="sm" /> — {{ formatJalali(String(h.effectiveFrom)) }}</li>
                </ul>
              </form>
            </QCard>
            <QCard>
              <form class="k-stack" novalidate @submit.prevent="discSubmit">
                <h2 class="h4 p-fin-h">{{ t('fin.discounts') }}</h2>
                <QTextField id="dc-code" v-model="disc.code" :label="t('fin.code')" ltr />
                <QSelect id="dc-kind" v-model="disc.kind" :label="t('mgmt.kind')" :options="[{ value: 'percent', label: '%' }, { value: 'amount', label: t('evm.amountRial') }]" />
                <QTextField id="dc-val" v-model="disc.value" :label="t('fin.value')" type="number" ltr />
                <QSelect id="dc-app" v-model="disc.appliesTo" :label="t('fin.appliesTo')" :options="KINDS" />
                <QTextField id="dc-max" v-model="disc.maxUses" :label="t('fin.maxUses')" type="number" ltr />
                <QDateField id="dc-to" v-model="disc.validTo" :label="t('fin.validTo')" with-time disable-past />
                <div><QButton type="submit" variant="green" :disabled="disc.code.length < 3">{{ t('fin.createDiscount') }}</QButton></div>
              </form>
            </QCard>
          </div>

          <div v-else-if="item.key === 'settle'" class="p-fin-cols">
            <QCard>
              <div class="k-stack">
                <h2 class="h4 p-fin-h">{{ t('fin.settlement') }}</h2>
                <QTextField id="st-o" v-model="bal.orgId" :label="t('evm.org')" ltr />
                <div><QButton variant="secondary" size="sm" :disabled="!bal.orgId" @click="toast(async () => { bal.payable = (await call.balance(bal.orgId)).payableRial; })">{{ t('fin.balance') }}</QButton></div>
                <div v-if="bal.payable !== null" class="p-fin-sunken">{{ t('evm.payable') }}: <QMoney :rial="bal.payable" size="lg" /></div>
                <form class="k-stack" novalidate @submit.prevent="settleSubmit">
                  <QTextField id="st-a" v-model="bal.amountRial" :label="t('evm.amountRial')" type="number" ltr :hint="tomanOf(bal.amountRial)" />
                  <QTextField id="st-ap" v-model="bal.approvalId" :label="t('evm.approvalId')" ltr />
                  <QTextField id="st-ev" v-model="bal.evidenceFileId" :label="t('fin.evidenceFileId')" ltr />
                  <p class="p-fin-muted">{{ t('fin.idempotencyKey') }}</p><QCode copy>{{ bal.idempotencyKey }}</QCode>
                  <div><QButton type="submit" variant="green" :disabled="!bal.orgId || Number(bal.amountRial) <= 0 || !bal.approvalId || !bal.evidenceFileId">{{ t('fin.settle') }}</QButton></div>
                </form>
              </div>
            </QCard>
          </div>

          <div v-else-if="item.key === 'prizes'" class="k-stack">
            <QAlert tone="info">{{ t('fin.prizeHelp') }}</QAlert>
            <QCard>
              <div class="k-stack">
                <div class="p-fin-grid">
                  <QTextField id="pp-id" v-model="payout.prizeId" :label="t('fin.prizeId')" ltr />
                  <QTextField id="pp-v" v-model="payout.version" :label="t('fin.version')" type="number" ltr />
                  <QTextField id="pp-ap" v-model="payout.approvalId" :label="t('evm.approvalId')" ltr />
                  <QTextField id="pp-ref" v-model="payout.providerRef" :label="t('fin.providerRef')" ltr />
                  <QTextField id="pp-ev" v-model="payout.evidenceFileId" :label="t('fin.evidenceFileId')" ltr />
                </div>
                <div class="k-row">
                  <QButton variant="green" :disabled="!payout.prizeId || !payout.approvalId" @click="toast(() => call.prizePayout(payout.prizeId, { approvalId: payout.approvalId, evidenceFileId: null, providerRef: null, expectedVersion: Number(payout.version) }))">{{ t('fin.startPayout') }}</QButton>
                  <QButton variant="secondary" :disabled="!payout.prizeId || (!payout.providerRef && !payout.evidenceFileId)" @click="toast(() => call.prizePaid(payout.prizeId, { evidenceFileId: payout.evidenceFileId || null, providerRef: payout.providerRef || null, expectedVersion: Number(payout.version) }))">{{ t('fin.confirmPaid') }}</QButton>
                </div>
              </div>
            </QCard>
          </div>

          <QCard v-else-if="item.key === 'ledger'">
            <div class="k-stack">
              <div class="p-fin-grid">
                <QDateField id="lg-f" v-model="ledger.from" :label="t('fin.from')" with-time />
                <QDateField id="lg-t" v-model="ledger.to" :label="t('fin.to')" with-time />
                <QTextField id="lg-a" v-model="ledger.account" :label="t('fin.account')" ltr />
              </div>
              <div><QButton variant="green" icon="download" :href="ledgerHref()" download>{{ t('fin.downloadCsv') }}</QButton></div>
            </div>
          </QCard>
        </template>
      </QTabs>
    </div>

    <QDrawer v-model:open="refundOpen" side="end" :width="460" :title="t('fin.refund')">
      <form id="fin-refund" class="k-stack" novalidate @submit.prevent="doRefund">
        <QTextField id="rf-p" v-model="refund.paymentId" :label="t('fin.paymentId')" required ltr />
        <QTextField id="rf-a" v-model="refund.amountRial" :label="t('evm.amountRial')" type="number" required ltr :hint="tomanOf(refund.amountRial)" />
        <QSelect id="rf-r" v-model="refund.reason" :label="t('evm.reason')" :options="REASONS" />
        <QTextField id="rf-ap" v-model="refund.approvalId" :label="t('evm.approvalId')" :hint="t('fin.approvalHint')" ltr />
        <QTextField id="rf-ev" v-model="refund.evidenceFileId" :label="t('fin.evidenceFileId')" :hint="t('fin.evidenceHint')" ltr />
      </form>
      <template #footer>
        <QButton variant="secondary" @click="refundOpen = false">{{ t('common.cancel') }}</QButton>
        <QButton type="submit" form="fin-refund" :disabled="!refund.paymentId || Number(refund.amountRial) <= 0">{{ t('fin.requestRefund') }}</QButton>
      </template>
    </QDrawer>

    <QDrawer v-model:open="manualOpen" side="end" :width="460" :title="t('fin.manualPayment')">
      <form id="fin-manual" class="k-stack" novalidate @submit.prevent="manualSubmit">
        <p class="p-fin-muted">{{ t('fin.manualHelp') }}</p>
        <QTextField id="mp-o" v-model="manual.orderId" :label="t('pay.orderId')" required ltr />
        <QTextField id="mp-e" v-model="manual.evidenceFileId" :label="t('fin.evidenceFileId')" required ltr />
        <QTextField id="mp-a" v-model="manual.approvalId" :label="t('evm.approvalId')" required ltr />
        <QTextField id="mp-n" v-model="manual.note" :label="t('fin.note')" required multiline :rows="2" />
      </form>
      <template #footer>
        <QButton variant="secondary" @click="manualOpen = false">{{ t('common.cancel') }}</QButton>
        <QButton type="submit" form="fin-manual" variant="green" :disabled="!manual.orderId || !manual.evidenceFileId || !manual.approvalId || manual.note.length < 3">{{ t('fin.recordManual') }}</QButton>
      </template>
    </QDrawer>
  </QContainer>
</template>

<style scoped>
.p-fin-h { margin: 0; }
.p-fin-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
@media (max-width: 1100px) { .p-fin-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.p-fin-tile { all: unset; display: block; cursor: pointer; border-radius: var(--radius-lg); outline: 2px solid transparent; }
.p-fin-tile[aria-pressed='true'] { outline-color: var(--green); }
.p-fin-tile:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
.p-fin-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-fin-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-fin-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: var(--space-4); align-items: start; }
.p-fin-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); }
.p-fin-list { margin: 0; padding-inline-start: var(--space-5); }
.p-fin-sunken { padding: var(--space-4); background: var(--surface-sunken); border-radius: var(--radius-md); }
</style>
