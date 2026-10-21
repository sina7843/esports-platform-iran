<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { normalizeDigits } from '@esp/contracts';
import { num, t } from '../i18n';
const props = defineProps<{ modelValue: string; id: string; describedBy?: string | undefined; invalid?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const cells = ref(Array.from({ length: 6 }, (_, i) => props.modelValue[i] ?? ''));
const inputs: Array<HTMLInputElement | null> = [];
const bind = (index: number, el: unknown) => { inputs[index] = el instanceof HTMLInputElement ? el : null; };
watch(() => props.modelValue, value => {
  if (value !== cells.value.join('')) cells.value = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
});
function insert(index: number, text: string) {
  const digits = normalizeDigits(text).replace(/\D/g, '').slice(0, 6);
  if (!digits) cells.value[index] = '';
  else for (let i = 0; i < digits.length && index + i < 6; i++) cells.value[index + i] = digits[i]!;
  emit('update:modelValue', cells.value.join(''));
  inputs[Math.min(index + digits.length, 5)]?.focus();
}
function input(index: number, event: Event) {
  const target = event.target as HTMLInputElement;
  insert(index, target.value);
  target.value = num(cells.value[index] ?? '');
}
function paste(index: number, event: ClipboardEvent) {
  event.preventDefault(); insert(index, event.clipboardData?.getData('text') ?? '');
}
function key(index: number, event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') { event.preventDefault(); inputs[Math.max(index - 1, 0)]?.focus(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); inputs[Math.min(index + 1, 5)]?.focus(); }
  if (event.key === 'Backspace' && !cells.value[index] && index > 0) {
    event.preventDefault(); cells.value[index - 1] = ''; emit('update:modelValue', cells.value.join('')); inputs[index - 1]?.focus();
  }
}
onMounted(() => inputs[0]?.focus());
</script>
<template>
  <div class="otp-cells" dir="ltr" role="group" :aria-label="t('otp.code')">
    <input v-for="(_, i) in cells" :id="i === 0 ? id : `${id}-${i}`" :key="i" :ref="el => bind(i, el)" type="text" inputmode="numeric" :autocomplete="i === 0 ? 'one-time-code' : 'off'" :maxlength="6" :value="num(cells[i] ?? '')" :disabled="disabled" :aria-label="t('otp.digit', { n: num(i + 1) })" :aria-describedby="describedBy" :aria-invalid="invalid ? 'true' : undefined" class="input num" @input="input(i, $event)" @paste="paste(i, $event)" @keydown="key(i, $event)" @focus="($event.target as HTMLInputElement).select()" />
  </div>
</template>
<style scoped>
.otp-cells { display: flex; gap: var(--sp-2); max-inline-size: 24rem; }
.otp-cells .input { min-inline-size: 0; inline-size: 100%; text-align: center; padding-inline: 0; font-size: var(--fs-lg); min-block-size: 48px; }
</style>
