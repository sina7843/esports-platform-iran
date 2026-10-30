<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { tr } from '../locale';
import { useControlled, useUid } from '../composables/inputs-field';
import QIcon from './QIcon.vue';

/**
 * Checkbox: 24px box (green fill + on-green check when checked), indeterminate, label + description. 44px hit area.
 * v-model = checked (+ change(checked, event)); defaultChecked seeds it when unbound. label / description / error: prop or slot.
 */
export interface QCheckboxProps {
  label?: (string) | undefined;
  description?: (string) | undefined;
  error?: (string) | undefined;
  required?: (boolean) | undefined;
  disabled?: (boolean) | undefined;
  indeterminate?: (boolean) | undefined;
  defaultChecked?: (boolean) | undefined;
  id?: (string) | undefined;
  name?: (string) | undefined;
  value?: (string) | undefined;
  /** Extra ids for the input's aria-describedby (pass as aria-describedby). */
  ariaDescribedby?: (string) | undefined;
}
const p = defineProps<QCheckboxProps>();
const model = defineModel<boolean | null>({ default: null });
const emit = defineEmits<{ change: [checked: boolean, event: Event] }>();
const slots = useSlots();
const cur = useControlled(model, !!p.defaultChecked);
const id = useUid('q-checkbox', () => p.id);
const descId = computed(() => (p.description || slots.description ? `${id.value}-desc` : undefined));
const errId = computed(() => (p.error || slots.error ? `${id.value}-error` : undefined));
const describedBy = computed(() => [descId.value, errId.value, p.ariaDescribedby].filter(Boolean).join(' ') || undefined);

function onChange(e: Event) {
  const v = (e.target as HTMLInputElement).checked;
  model.value = v;
  emit('change', v, e);
}
</script>

<template>
  <div :class="['q-checkbox', { 'q-checkbox--disabled': disabled, 'q-checkbox--invalid': errId }]">
    <span class="q-checkbox__box-wrap">
      <input
        :id="id"
        type="checkbox"
        :name="name"
        :value="value"
        class="q-checkbox__input"
        :checked="!!cur"
        :indeterminate="!!indeterminate"
        :disabled="disabled"
        :required="required"
        :aria-invalid="errId ? 'true' : undefined"
        :aria-describedby="describedBy"
        @change="onChange"
      />
      <span class="q-checkbox__box" aria-hidden="true"><QIcon :name="indeterminate ? 'minus' : 'check'" :size="16" :stroke-width="3" /></span>
    </span>
    <span class="q-checkbox__text">
      <label :for="id" class="q-checkbox__label">
        <slot name="label">{{ label }}</slot>
        <template v-if="required"><span class="q-form-field__req" aria-hidden="true">*</span><span class="q-sr">{{ tr('الزامی', 'required') }}</span></template>
      </label>
      <span v-if="descId" :id="descId" class="q-checkbox__desc"><slot name="description">{{ description }}</slot></span>
      <span v-if="errId" :id="errId" class="q-checkbox__error" role="alert"><QIcon name="alert" :size="16" /><slot name="error">{{ error }}</slot></span>
    </span>
  </div>
</template>
