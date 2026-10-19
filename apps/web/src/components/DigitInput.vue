<script setup lang="ts">
import { computed } from 'vue';
import { normalizeDigits } from '@esp/contracts';
import { num } from '../i18n';

const props = defineProps<{ modelValue: string; id: string; describedBy?: string | undefined; invalid?: boolean; disabled?: boolean; inputmode?: 'numeric' | 'tel' | 'decimal' | 'text' }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

/** The model always holds ASCII digits; the display follows the user's digits setting. */
const display = computed(() => num(props.modelValue));

interface InputLike { value: string; selectionStart: number | null; setSelectionRange: (a: number, b: number) => void }
function onInput(e: { target: unknown }) {
  const el = e.target as InputLike;
  const caret = el.selectionStart;
  const normalized = normalizeDigits(el.value);
  emit('update:modelValue', normalized);
  const shown = num(normalized);
  if (el.value !== shown) {
    el.value = shown;
    if (caret !== null) el.setSelectionRange(caret, caret);
  }
}
</script>

<template>
  <!-- dir="ltr" keeps digit runs in logical order; alignment follows the page direction -->
  <input :id="id" class="input num digit-input" type="text" dir="ltr" autocomplete="off" :inputmode="inputmode ?? 'numeric'" :value="display" :disabled="disabled" :aria-invalid="invalid ? 'true' : undefined" :aria-describedby="describedBy" @input="onInput" />
</template>

<style scoped>
:global([dir='rtl']) .digit-input { text-align: right; }
</style>
