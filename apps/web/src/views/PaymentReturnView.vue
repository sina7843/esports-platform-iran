<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp03, type Order } from '../api/esp03';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import MoneyLabel from '../components/MoneyLabel.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { startPayment } from '../payment';

/**
 * FIN-002/003, AC-04: the browser return proves nothing. This page asks the server to verify with the provider and
 * polls the order; a dropped browser is fine because the PSP callback and reconciliation settle the order anyway.
 */
const route = useRoute();
const orderId = String(route.query['order'] ?? '');
const order = ref<Order | null>(null);
const loading = ref(true);
const error = ref<ApiClientError | null>(null);
const failure = ref<ApiClientError | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let tries = 0;
const FINAL = ['paid', 'refunded', 'partially_refunded', 'cancelled', 'expired'];

async function tick() {
  try {
    let o = await esp03.order(orderId);
    const open = o.payments.find((p) => !['verified', 'failed', 'awaiting_refund', 'refunded_partial', 'refunded_full'].includes(p.state));
    if (open) {
      await esp03.verifyPayment(open.id);
      o = await esp03.order(orderId);
    }
    order.value = o;
    error.value = null;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
  tries++;
  if (order.value && !FINAL.includes(order.value.state) && tries < 20) timer = setTimeout(() => void tick(), Math.min(2000 * tries, 10000));
}
async function retryPay() {
  failure.value = null;
  try {
    await startPayment(orderId);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
onMounted(() => {
  if (!orderId) {
    loading.value = false;
    return;
  }
  void tick();
});
onBeforeUnmount(() => clearTimeout(timer));
const printReceipt = () => window.print();
</script>

<template>
  <PageHeader :title="t('pay.title')" />
  <p v-if="!orderId" class="muted">{{ t('pay.noOrder') }}</p>
  <DataState v-else :loading="loading && !order" :error="error && !order ? error : null" @retry="tick">
    <template v-if="order">
      <section class="card stack receipt" aria-live="polite">
        <div class="row between">
          <h2>{{ order.receiptNo ? t('pay.receipt') : t('pay.order') }}</h2>
          <StatusBadge :state="order.state" />
        </div>
        <p v-if="order.state === 'paid'" class="ok" role="status">{{ t('pay.paid') }}</p>
        <p v-else-if="order.payments[0]?.state === 'failed'" class="warn" role="alert">{{ t('pay.failed') }}</p>
        <p v-else-if="!FINAL.includes(order.state)" class="muted" role="status">{{ t('pay.pending') }}</p>
        <dl class="kv">
          <div v-if="order.receiptNo"><dt>{{ t('pay.receiptNo') }}</dt><dd><bdi class="ltr">{{ order.receiptNo }}</bdi></dd></div>
          <div><dt>{{ t('pay.orderId') }}</dt><dd><bdi class="ltr">{{ order.id }}</bdi></dd></div>
          <div><dt>{{ t('pay.date') }}</dt><dd><JalaliDate :iso="order.createdAt" /></dd></div>
        </dl>
        <table class="items">
          <caption class="sr-only">{{ t('pay.items') }}</caption>
          <tbody>
            <tr v-for="(it, i) in order.items" :key="i"><th scope="row"><bdi>{{ it.description }}</bdi> × {{ num(it.quantity) }}</th><td><MoneyLabel :rial="it.amountRial * it.quantity" /></td></tr>
            <tr v-if="order.discountRial"><th scope="row">{{ t('pay.discount') }}</th><td>− <MoneyLabel :rial="order.discountRial" /></td></tr>
            <tr v-if="order.feeRial"><th scope="row">{{ t('pay.fee') }}</th><td><MoneyLabel :rial="order.feeRial" /></td></tr>
            <tr class="total"><th scope="row">{{ t('pay.total') }}</th><td><MoneyLabel :rial="order.totalRial" /></td></tr>
          </tbody>
        </table>
        <ul v-if="order.payments.length" class="list">
          <li v-for="p in order.payments" :key="p.id"><bdi class="ltr">{{ p.id }}</bdi> — <StatusBadge :state="p.state" /><span v-if="p.manual"> ({{ t('pay.manual') }})</span><span v-if="p.refundedRial"> — {{ t('pay.refunded') }} <MoneyLabel :rial="p.refundedRial" /></span></li>
        </ul>
        <ErrorNote :error="failure" />
        <div class="row no-print">
          <button v-if="order.state === 'open' && !order.payments.some((p) => ['awaiting_gateway', 'unknown'].includes(p.state))" type="button" class="btn btn-primary" @click="retryPay">{{ t('pay.retry') }}</button>
          <button v-if="order.receiptNo" type="button" class="btn" @click="printReceipt">{{ t('pay.print') }}</button>
          <RouterLink class="btn" to="/account/registrations">{{ t('reg.mine') }}</RouterLink>
        </div>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.receipt { max-inline-size: 40rem; }
.between { justify-content: space-between; }
.kv { display: grid; gap: var(--sp-2); margin: 0; }
.kv div { display: flex; justify-content: space-between; gap: var(--sp-3); }
dt { color: var(--text-muted); }
dd { margin: 0; }
.items { inline-size: 100%; border-collapse: collapse; }
.items th { text-align: start; font-weight: 400; padding: var(--sp-1) 0; }
.items td { text-align: end; }
.total th, .total td { font-weight: 700; border-block-start: 1px solid var(--border); }
.ok { color: var(--ok); font-weight: 700; }
.warn { color: var(--danger); font-weight: 700; }
.list { margin: 0; padding-inline-start: var(--sp-5); }
h2, p { margin: 0; }
@media print { .no-print { display: none; } }
</style>
