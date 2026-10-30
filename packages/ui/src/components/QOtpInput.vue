<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { fa, tr } from '../locale';
import { pad2, toAscii } from '../maps/inputs';
import { useControlled } from '../composables/inputs-field';
import QButton from './QButton.vue';
import QFormField from './QFormField.vue';

/**
 * OtpInput: 4–6 one-digit cells in LTR order. Accepts Persian, Arabic-Indic and Latin digits; v-model / change get ASCII.
 * Paste (or one-time-code autofill) fills every cell. Resend line counts down «ارسال مجدد کد تا ۰:۴۵», then shows a ghost button.
 * Emits complete(code) once every cell is filled and resend() from the button.
 */
export interface QOtpInputProps {
  length?: (4 | 5 | 6) | undefined;
  label?: (string) | undefined;
  hint?: (string) | undefined;
  error?: (string) | undefined;
  required?: (boolean) | undefined;
  disabled?: (boolean) | undefined;
  digits?: ('fa' | 'latn') | undefined;
  defaultValue?: (string) | undefined;
  autoComplete?: (string) | undefined;
  resendIn?: (number) | undefined;
  resendAfter?: (number) | undefined;
  countdownRunning?: (boolean) | undefined;
  hideResend?: (boolean) | undefined;
  resendText?: (string) | undefined;
  resendLabel?: (string) | undefined;
  id?: (string) | undefined;
}
const p = withDefaults(defineProps<QOtpInputProps>(), { length: 6, countdownRunning: true, resendIn: 45 });
const model = defineModel<string>();
const emit = defineEmits<{ change: [value: string, event: Event]; complete: [code: string]; resend: [] }>();
const cur = useControlled(model, p.defaultValue ?? '');

const len = computed(() => Math.max(4, Math.min(6, p.length || 6)));
const code = computed(() => toAscii(cur.value ?? '').replace(/\D/g, '').slice(0, len.value));
const cells: (HTMLInputElement | null)[] = [];
const left = ref(p.resendIn);

watchEffect((onCleanup) => {
  if (!p.countdownRunning || left.value <= 0) return;
  const t = setTimeout(() => { left.value -= 1; }, 1000);
  onCleanup(() => clearTimeout(t));
});

const cellText = (ch: string) => (ch ? (p.digits !== 'latn' ? fa(ch) : ch) : '');
function focusCell(i: number) {
  const el = cells[Math.max(0, Math.min(len.value - 1, i))];
  if (el) { el.focus(); el.select(); }
}
function commit(next: string, e: Event) {
  const v = next.slice(0, len.value);
  model.value = v;
  emit('change', v, e);
  if (v.length === len.value) emit('complete', v);
}
function onInput(i: number, e: Event) {
  const el = e.target as HTMLInputElement;
  const raw = toAscii(el.value).replace(/\D/g, '');
  const c = code.value;
  el.value = cellText(c.charAt(i)); // controlled cell: drop what was typed, the re-render shows the accepted digit
  if (!raw) return;
  const at = Math.min(i, c.length);
  if (raw.length > 1) { // autofill or IME delivered several digits
    const filled = (c.slice(0, at) + raw).slice(0, len.value);
    commit(filled, e);
    focusCell(filled.length);
    return;
  }
  const next = c.slice(0, at) + raw.charAt(raw.length - 1) + c.slice(at + 1);
  commit(next, e);
  focusCell(at + 1);
}
function onKeyDown(i: number, e: KeyboardEvent) {
  const c = code.value;
  if (e.key === 'Backspace') {
    e.preventDefault();
    if (c.charAt(i)) commit(c.slice(0, i) + c.slice(i + 1), e);
    else if (i > 0) { commit(c.slice(0, i - 1) + c.slice(i), e); focusCell(i - 1); }
  } else if (e.key === 'ArrowLeft') { e.preventDefault(); focusCell(i - 1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); focusCell(i + 1); }
}
function onPaste(e: ClipboardEvent) {
  const d = toAscii(e.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, len.value);
  if (!d) return;
  e.preventDefault();
  commit(d, e);
  focusCell(d.length);
}
function resend() {
  emit('resend');
  left.value = p.resendAfter || p.resendIn || 45;
}
const timer = computed(() => fa(`${Math.floor(left.value / 60)}:${pad2(left.value % 60)}`));
</script>

<template>
  <div class="q-otp-input">
    <QFormField :id="id" group :label="label ?? tr('کد تأیید', 'Verification code')" :hint="hint" :error="error" :required="required" :disabled="disabled" class="q-otp-input__field">
      <template v-if="$slots.label" #label><slot name="label" /></template>
      <template v-if="$slots.hint" #hint><slot name="hint" /></template>
      <template v-if="$slots.error" #error><slot name="error" /></template>
      <template #default="f">
        <div class="q-otp-input__cells" dir="ltr">
          <input
            v-for="(_, i) in len"
            :id="i === 0 ? f.id : `${f.id}-${i}`"
            :key="i"
            :ref="(el) => { cells[i] = el as HTMLInputElement | null }"
            type="text"
            inputmode="numeric"
            :autocomplete="i === 0 ? (autoComplete || 'one-time-code') : 'off'"
            :disabled="disabled"
            :class="['q-otp-input__cell', { 'q-otp-input__cell--filled': code.charAt(i), 'q-otp-input__cell--invalid': f.invalid }]"
            :value="cellText(code.charAt(i))"
            :aria-label="tr(`رقم ${fa(i + 1)} از ${fa(len)}`, `Digit ${i + 1} of ${len}`)"
            :aria-invalid="f.invalid ? 'true' : undefined"
            :aria-describedby="f.describedBy"
            @input="onInput(i, $event)"
            @keydown="onKeyDown(i, $event)"
            @focus="($event.target as HTMLInputElement).select()"
            @paste="onPaste"
          />
        </div>
      </template>
    </QFormField>
    <div v-if="!hideResend" class="q-otp-input__resend">
      <span v-if="left > 0" class="q-otp-input__wait">{{ (resendText || tr('ارسال مجدد کد تا', 'Resend code in')) + ' ' }}<bdi class="q-otp-input__count" dir="ltr">{{ timer }}</bdi></span>
      <QButton v-else variant="ghost" size="md" icon="refresh" class="q-otp-input__resend-btn" :disabled="disabled" @click="resend">
        {{ resendLabel || tr('ارسال مجدد کد', 'Resend code') }}
      </QButton>
    </div>
  </div>
</template>
