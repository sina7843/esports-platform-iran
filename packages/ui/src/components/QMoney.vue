<script setup lang="ts">
import { computed } from 'vue';
import { num, toman, tr } from '../locale';
import QIcon from './QIcon.vue';

/** Money: integer rial shown as toman («۱۲۰٬۰۰۰ تومان»); free «رایگان»; prize adds «بدون تضمین». Never rounds. */
export interface QMoneyProps {
  rial: number;
  /** amount (default) | fee (0 → «رایگان») | prize (adds «بدون تضمین»). */
  kind?: ('amount' | 'fee' | 'prize') | undefined;
  free?: (boolean) | undefined;
  freeLabel?: (string) | undefined;
  size?: ('sm' | 'md' | 'lg' | 'xl') | undefined;
  /** Prize note: false hides it, a string replaces «بدون تضمین». */
  note?: boolean | string | undefined;
  noteDetail?: (string) | undefined;
}
const p = withDefaults(defineProps<QMoneyProps>(), { kind: 'amount', size: 'md', note: undefined });

const rial = computed(() => Number(p.rial) || 0);
const isFree = computed(() => p.free || (p.kind === 'fee' && rial.value === 0));
// Split at the unit word: toman() keeps a rial remainder («… تومان و ۵ ریال»), so the DS last-space split would cut it.
const parts = computed(() => {
  const s = toman(Math.abs(rial.value));
  const at = s.indexOf(` ${tr('تومان', 'Toman')}`);
  return at < 0 ? { value: s, unit: '' } : { value: s.slice(0, at), unit: s.slice(at + 1) };
});
const showNote = computed(() => p.kind === 'prize' && p.note !== false);
</script>

<template>
  <span v-if="isFree" :class="['q-money', `q-money--${size}`, `q-money--${kind}`, 'q-money--free']">{{ freeLabel || tr('رایگان', 'Free') }}</span>
  <span v-else :class="['q-money', `q-money--${size}`, `q-money--${kind}`]">
    <span class="q-money__amount" :title="num(rial) + tr(' ریال', ' Rial')">
      <span :class="['q-money__value q-num', { 'q-ltr': rial < 0 }]">{{ (rial < 0 ? '−' : '') + parts.value }}</span>
      <span class="q-money__unit">{{ parts.unit }}</span>
    </span>
    <span
      v-if="showNote"
      class="q-money__note"
      :title="noteDetail || tr('جوایز تعهد برگزارکننده یا مسئول اعلام‌شده است و پلتفرم پرداخت آن‌ها را تضمین نمی‌کند.', 'Prizes are an obligation of the stated responsible party; the platform does not guarantee payment.')"
    ><QIcon name="info" :size="14" />{{ typeof note === 'string' ? note : tr('بدون تضمین', 'Not guaranteed') }}</span>
  </span>
</template>
