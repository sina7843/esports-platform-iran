<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QButton, QContainer, QDataState, QEmptyState, QPageHeader, QReceipt, QStatusBadge, formatJalali, toman, type QReceiptPaymentState } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03, type Order } from '../api/esp03';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
const pay = computed(() => order.value?.payments[0] ?? null);
const receiptState = computed<QReceiptPaymentState | undefined>(() => (pay.value?.state as QReceiptPaymentState | undefined));
const canRetry = computed(() => order.value?.state === 'open' && !order.value.payments.some((p) => ['awaiting_gateway', 'unknown'].includes(p.state)));
const items = computed(() => (order.value?.items ?? []).map((it) => ({ label: it.quantity > 1 ? `${it.description} × ${it.quantity}` : it.description, amountRial: it.amountRial * it.quantity })));
const refunded = computed(() => (order.value?.payments ?? []).reduce((n, p) => n + (p.refundedRial ?? 0), 0));
</script>

<template>
  <QContainer>
    <div class="k-stack p-pay">
      <QPageHeader compact :title="t('pay.title')" :breadcrumb="[{ label: t('reg.mine'), href: '/account/registrations' }, { label: t('pay.title') }]" />
      <QEmptyState v-if="!orderId" icon="wallet" :title="t('pay.noOrder')">
        <template #action><QButton variant="secondary" href="/account/registrations">{{ t('reg.mine') }}</QButton></template>
      </QEmptyState>
      <QDataState v-else-if="!order" :state="error ? (error.code === 'NETWORK' ? 'offline' : error.code === 'FORBIDDEN' ? 'forbidden' : 'error') : 'loading'" :request-id="error?.requestId ?? undefined" @retry="tick" />
      <div v-else class="p-pay-wrap" aria-live="polite">
        <QAlert v-if="order.state === 'paid'" tone="success" icon="check-circle" :title="t('pay.paid')" />
        <QAlert v-else-if="pay?.state === 'failed'" tone="danger" icon="x-circle" :title="t('pay.failed')" />
        <QAlert v-else-if="!FINAL.includes(order.state)" tone="info" icon="clock" :title="t('pay.pending')" />
        <QReceipt
          :title="order.receiptNo ? t('pay.receipt') : t('pay.order')" :receipt-no="order.receiptNo ?? undefined" :order-id="order.id" :date="formatJalali(order.createdAt)"
          :items="items" :discount-rial="order.discountRial || undefined" :fee-rial="order.feeRial || undefined" :refunded-rial="refunded || undefined" :total-rial="order.totalRial"
          :state="receiptState" :note="pay?.manual ? t('pay.manual') : undefined"
          :on-print="order.receiptNo ? printReceipt : undefined" :on-retry="canRetry ? retryPay : undefined" :on-download="false"
        />
        <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
        <ul v-if="order.payments.length > 1" class="p-pay-list">
          <li v-for="p in order.payments" :key="p.id"><bdi class="q-ltr q-mono">{{ p.id }}</bdi><QStatusBadge :state="p.state" machine="payment" /><span v-if="p.refundedRial">{{ t('pay.refunded') }} {{ toman(p.refundedRial) }}</span></li>
        </ul>
        <div class="k-row p-pay-actions">
          <QButton v-if="canRetry" variant="primary" icon="refresh" @click="retryPay">{{ t('pay.retry') }}</QButton>
          <QButton variant="secondary" href="/account/registrations">{{ t('reg.mine') }}</QButton>
        </div>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-pay { gap: var(--space-6); }
.p-pay-wrap { display: flex; flex-direction: column; gap: var(--space-4); max-inline-size: 640px; }
.p-pay-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); font-size: 14px; }
.p-pay-list li { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
@media print { .p-pay-actions { display: none; } }
</style>
