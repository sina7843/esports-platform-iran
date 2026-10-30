<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import type { IconName } from '../icons';
import { useControlled } from '../composables/inputs-field';
import QFormField from './QFormField.vue';
import QIcon from './QIcon.vue';

/**
 * TextField: single-line input (48px) or multiline textarea with an optional «۱۲ / ۲۸۰» counter. ltr for phones, codes, URLs.
 * v-model (+ change(value, event)); blur / focus / keyDown(event). label, hint, error, suffix: prop or slot.
 */
export interface QTextFieldProps {
  label?: (string) | undefined;
  hint?: (string) | undefined;
  error?: (string) | undefined;
  required?: (boolean) | undefined;
  disabled?: (boolean) | undefined;
  readOnly?: (boolean) | undefined;
  placeholder?: (string) | undefined;
  id?: (string) | undefined;
  name?: (string) | undefined;
  type?: ('text' | 'email' | 'tel' | 'url' | 'password' | 'number' | 'search') | undefined;
  inputMode?: ('text' | 'numeric' | 'tel' | 'decimal' | 'email' | 'url' | 'search') | undefined;
  autoComplete?: (string) | undefined;
  prefixIcon?: (IconName) | undefined;
  suffixIcon?: (IconName) | undefined;
  suffix?: (string) | undefined;
  ltr?: (boolean) | undefined;
  multiline?: (boolean) | undefined;
  rows?: (number) | undefined;
  maxLength?: (number) | undefined;
  showCount?: (boolean) | undefined;
  hideLabel?: (boolean) | undefined;
  defaultValue?: (string) | undefined;
}
const p = withDefaults(defineProps<QTextFieldProps>(), { type: 'text', rows: 4, showCount: true });
const model = defineModel<string>();
const emit = defineEmits<{ change: [value: string, event: Event]; blur: [event: FocusEvent]; focus: [event: FocusEvent]; keyDown: [event: KeyboardEvent] }>();
const cur = useControlled(model, p.defaultValue ?? '');
const val = computed(() => (cur.value == null ? '' : String(cur.value)));
const showCount = computed(() => !!(p.multiline && p.maxLength && p.showCount));

function onInput(e: Event) {
  const v = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  model.value = v;
  emit('change', v, e);
}
const inputClass = computed(() => ['q-text-field__input', { 'q-text-field__input--multiline': p.multiline, 'q-text-field__input--ltr': p.ltr }]);
</script>

<template>
  <QFormField :id="id" :label="label" :hint="hint" :error="error" :required="required" :disabled="disabled" :hide-label="hideLabel">
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <template v-if="$slots.hint" #hint><slot name="hint" /></template>
    <template v-if="$slots.error" #error><slot name="error" /></template>
    <template #default="f">
      <div
        :class="['q-form-field__control', 'q-text-field', {
          'q-text-field--multiline': multiline, 'q-form-field__control--invalid': f.invalid,
          'q-form-field__control--disabled': disabled, 'q-form-field__control--readonly': readOnly }]"
      >
        <QIcon v-if="prefixIcon" :name="prefixIcon" :size="20" class="q-text-field__icon" />
        <component
          :is="multiline ? 'textarea' : 'input'"
          :id="f.id"
          :name="name"
          :value="val"
          :placeholder="placeholder"
          :disabled="disabled"
          :readonly="readOnly"
          :required="required"
          :maxlength="maxLength"
          :autocomplete="autoComplete"
          :inputmode="inputMode"
          :dir="ltr ? 'ltr' : undefined"
          :aria-invalid="f.invalid ? 'true' : undefined"
          :aria-describedby="[f.describedBy, showCount ? `${f.id}-count` : null].filter(Boolean).join(' ') || undefined"
          :rows="multiline ? rows : undefined"
          :type="multiline ? undefined : type"
          :class="inputClass"
          @input="onInput"
          @blur="emit('blur', $event)"
          @focus="emit('focus', $event)"
          @keydown="emit('keyDown', $event)"
        />
        <span v-if="suffix != null || $slots.suffix" class="q-text-field__suffix"><slot name="suffix">{{ suffix }}</slot></span>
        <QIcon v-if="suffixIcon" :name="suffixIcon" :size="20" class="q-text-field__icon" />
      </div>
      <div v-if="showCount" :id="`${f.id}-count`" class="q-text-field__count">
        <span aria-hidden="true">{{ fa(val.length) }} / {{ fa(maxLength) }}</span>
        <span class="q-sr">{{ tr(`${fa(val.length)} از ${fa(maxLength)} نویسه`, `${val.length} of ${maxLength} characters`) }}</span>
      </div>
    </template>
  </QFormField>
</template>
