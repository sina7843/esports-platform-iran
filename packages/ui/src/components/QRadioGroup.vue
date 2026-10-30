<script setup lang="ts">
import { useControlled, useUid } from '../composables/inputs-field';
import QFormField from './QFormField.vue';

export interface QRadioGroupOption { value: string; label: string; description?: string; meta?: string; disabled?: boolean }
/** RadioGroup: native radios in a fieldset; selected = green dot ring. orientation vertical | horizontal; variant default | card. v-model + change(value, event). */
export interface QRadioGroupProps {
  label?: (string) | undefined;
  options: QRadioGroupOption[];
  hint?: (string) | undefined;
  error?: (string) | undefined;
  required?: (boolean) | undefined;
  disabled?: (boolean) | undefined;
  orientation?: ('vertical' | 'horizontal') | undefined;
  variant?: ('default' | 'card') | undefined;
  hideLabel?: (boolean) | undefined;
  id?: (string) | undefined;
  name?: (string) | undefined;
  defaultValue?: (string | null) | undefined;
}
const p = withDefaults(defineProps<QRadioGroupProps>(), { orientation: 'vertical', variant: 'default' });
const model = defineModel<string | null>();
const emit = defineEmits<{ change: [value: string, event: Event] }>();
const cur = useControlled<string | null>(model, p.defaultValue ?? null);
const name = useUid('q-radio', () => p.name);

function onChange(o: QRadioGroupOption, e: Event) {
  if (!(e.target as HTMLInputElement).checked) return;
  model.value = o.value;
  emit('change', o.value, e);
}
</script>

<template>
  <QFormField :id="id" group :label="label" :hint="hint" :error="error" :required="required" :disabled="disabled" :hide-label="hideLabel" class="q-radio-group">
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <template v-if="$slots.hint" #hint><slot name="hint" /></template>
    <template v-if="$slots.error" #error><slot name="error" /></template>
    <template #default="f">
      <div
        role="radiogroup"
        :aria-labelledby="f.labelId"
        :aria-describedby="f.describedBy"
        :aria-required="f.required ? 'true' : undefined"
        :aria-invalid="f.invalid ? 'true' : undefined"
        :class="['q-radio-group__list', { 'q-radio-group__list--horizontal': orientation === 'horizontal', 'q-radio-group__list--card': variant === 'card' }]"
      >
        <label
          v-for="(o, i) in options"
          :key="`r${o.value}`"
          :for="`${f.id}-${i}`"
          :class="['q-radio-group__option', {
            'q-radio-group__option--card': variant === 'card', 'q-radio-group__option--checked': cur === o.value,
            'q-radio-group__option--disabled': disabled || o.disabled, 'q-radio-group__option--invalid': f.invalid }]"
        >
          <span class="q-radio-group__dot-wrap">
            <input
              :id="`${f.id}-${i}`"
              type="radio"
              :name="name"
              :value="String(o.value)"
              :checked="cur === o.value"
              :disabled="disabled || o.disabled"
              class="q-radio-group__input"
              :aria-describedby="o.description ? `${f.id}-${i}-desc` : undefined"
              @change="onChange(o, $event)"
            />
            <span class="q-radio-group__dot" aria-hidden="true" />
          </span>
          <span class="q-radio-group__text">
            <span class="q-radio-group__label">{{ o.label }}</span>
            <span v-if="o.description" :id="`${f.id}-${i}-desc`" class="q-radio-group__desc">{{ o.description }}</span>
          </span>
          <span v-if="o.meta" class="q-radio-group__meta">{{ o.meta }}</span>
        </label>
      </div>
    </template>
  </QFormField>
</template>
