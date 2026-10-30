<script setup lang="ts">
import { computed, useId } from 'vue';
import { toman, tr } from '../locale';
import { PAY, PAY_NOTE, fmtDate, negToman, stateBadge, tx } from '../maps/people';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QLogo from './QLogo.vue';

export type QReceiptPaymentState = 'created' | 'awaiting_gateway' | 'verified' | 'failed' | 'unknown' | 'awaiting_refund' | 'refunded_partial' | 'refunded_full';
/**
 * Printable payment receipt: receipt no, LTR order ID, items and totals in toman (never rounded), payment state,
 * gateway ref, date. Listeners are declared as props because their presence drives the buttons:
 * @retry shows «پرداخت دوباره» on failed, @print shows «چاپ رسید», `:on-download="false"` hides «دانلود رسید».
 */
export interface QReceiptProps {
  title?: (string) | undefined;
  subtitle?: (string) | undefined;
  receiptNo?: (string) | undefined;
  orderId?: (string) | undefined;
  date?: (string) | undefined;
  gateway?: (string) | undefined;
  gatewayRef?: (string) | undefined;
  payer?: (string) | undefined;
  items: { label: string; amountRial: number }[];
  discountRial?: (number) | undefined;
  feeRial?: (number) | undefined;
  refundedRial?: (number) | undefined;
  /** Defaults to items − discount + fee. */
  totalRial?: (number) | undefined;
  state?: (QReceiptPaymentState) | undefined;
  note?: (string) | undefined;
  onDownload?: (() => void) | false | undefined;
  downloadHref?: (string) | undefined;
  onPrint?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
}
const p = withDefaults(defineProps<QReceiptProps>(), { state: 'verified', onDownload: undefined });
const hid = useId();
const s = computed(() => PAY[p.state] ?? PAY.created!);
const badge = computed(() => stateBadge(PAY, PAY[p.state] ? p.state : 'created'));
const total = computed(() => p.totalRial ?? p.items.reduce((t, i) => t + i.amountRial, 0) - (p.discountRial || 0) + (p.feeRial || 0));
const ids = computed(() => ([
  p.receiptNo ? { k: tr('شمارهٔ رسید', 'Receipt no.'), v: p.receiptNo, mono: true } : null,
  p.orderId ? { k: tr('شناسهٔ سفارش', 'Order ID'), v: p.orderId, mono: true } : null,
  p.date ? { k: tr('تاریخ', 'Date'), v: '', time: p.date } : null,
  p.gateway ? { k: tr('درگاه', 'Gateway'), v: p.gateway } : null,
  p.gatewayRef ? { k: tr('کد مرجع درگاه', 'Gateway reference'), v: p.gatewayRef, mono: true } : null,
  p.payer ? { k: tr('پرداخت‌کننده', 'Payer'), v: p.payer } : null,
] as ({ k: string; v: string; mono?: boolean; time?: string } | null)[]).filter((x) => x !== null));
const noteText = computed(() => p.note || tx(PAY_NOTE[p.state]));
const discount = computed(() => negToman(p.discountRial ?? 0));
const refunded = computed(() => negToman(p.refundedRial ?? 0));
function download() { if (typeof p.onDownload === 'function') p.onDownload(); }
</script>

<template>
  <article :class="['q-receipt', `q-receipt--${state}`]" :aria-labelledby="hid">
    <div class="q-receipt__paper">
      <div class="q-receipt__head">
        <QLogo :size="40" />
        <div class="q-receipt__titles">
          <h3 :id="hid" class="q-receipt__title">{{ title || tr('رسید پرداخت', 'Payment receipt') }}</h3>
          <span v-if="subtitle" class="q-receipt__subtitle"><bdi>{{ subtitle }}</bdi></span>
        </div>
        <QBadge v-bind="badge.props">{{ badge.label }}</QBadge>
      </div>
      <dl class="q-receipt__ids">
        <div v-for="r in ids" :key="r.k">
          <dt>{{ r.k }}</dt>
          <dd>
            <time v-if="r.time" :datetime="r.time">{{ fmtDate(r.time, 'datetime') }}</time>
            <span v-else-if="r.mono" class="q-receipt__mono q-ltr">{{ r.v }}</span>
            <template v-else>{{ r.v }}</template>
          </dd>
        </div>
      </dl>
      <table class="q-receipt__table">
        <caption class="q-sr">{{ tr('اقلام', 'Items') }}</caption>
        <thead><tr><th scope="col">{{ tr('اقلام', 'Items') }}</th><th scope="col" class="q-receipt__amt">{{ tr('مبلغ', 'Amount') }}</th></tr></thead>
        <tbody>
          <tr v-for="(it, i) in items" :key="i"><td><bdi>{{ it.label }}</bdi></td><td class="q-receipt__amt">{{ toman(it.amountRial) }}</td></tr>
          <tr v-if="discountRial" class="q-receipt__adj"><td>{{ tr('تخفیف', 'Discount') }}</td><td class="q-receipt__amt"><span class="q-ltr">{{ discount.amount }}</span>{{ discount.unit }}</td></tr>
          <tr v-if="feeRial" class="q-receipt__adj"><td>{{ tr('کارمزد', 'Fee') }}</td><td class="q-receipt__amt">{{ toman(feeRial) }}</td></tr>
          <tr v-if="refundedRial" class="q-receipt__adj"><td>{{ tr('بازپرداخت‌شده', 'Refunded') }}</td><td class="q-receipt__amt"><span class="q-ltr">{{ refunded.amount }}</span>{{ refunded.unit }}</td></tr>
        </tbody>
        <tfoot><tr><th scope="row">{{ tr('جمع کل', 'Total') }}</th><td class="q-receipt__amt">{{ toman(total) }}</td></tr></tfoot>
      </table>
      <p v-if="noteText" :class="['q-receipt__note', `q-receipt__note--${s.tone}`]" role="status">
        <QIcon :name="s.icon || 'info'" :size="16" /><span>{{ noteText }}</span>
      </p>
    </div>
    <div class="q-receipt__actions">
      <QButton v-if="state === 'failed' && onRetry" variant="primary" icon="refresh" @click="onRetry()">{{ tr('پرداخت دوباره', 'Pay again') }}</QButton>
      <QButton v-if="onDownload !== false && state !== 'failed'" variant="secondary" icon="download" v-bind="downloadHref ? { href: downloadHref } : {}" @click="download">{{ tr('دانلود رسید', 'Download receipt') }}</QButton>
      <QButton v-if="onPrint" variant="ghost" icon="file" @click="onPrint()">{{ tr('چاپ رسید', 'Print receipt') }}</QButton>
    </div>
  </article>
</template>
