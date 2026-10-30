<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { tr } from '../locale';
import { useUid } from '../composables/inputs-field';
import QIcon from './QIcon.vue';

/** What FormField hands to its scoped default slot (React: the render-function child). */
export interface QFormFieldRenderProps {
  id: string;
  labelId: string;
  hintId?: string | undefined;
  errorId?: string | undefined;
  describedBy?: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}
/**
 * FormField: label (+ required mark), hint and error around any control. The default slot is scoped with
 * { id, labelId, hintId, errorId, describedBy, invalid, required, disabled }. group renders fieldset + legend.
 * label / hint / error: string prop or same-named slot (slot wins).
 */
export interface QFormFieldProps {
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  labelFor?: string | undefined;
  describedBy?: string | undefined;
  group?: boolean | undefined;
  hideLabel?: boolean | undefined;
}
const p = defineProps<QFormFieldProps>();
defineSlots<{
  default?(f: QFormFieldRenderProps): unknown;
  label?(): unknown;
  hint?(): unknown;
  error?(): unknown;
}>();
const slots = useSlots();
const id = useUid('q-field', () => p.id);

const hasLabel = computed(() => p.label != null || !!slots.label);
const hasHint = computed(() => !!p.hint || !!slots.hint);
const hasError = computed(() => !!p.error || !!slots.error);
const f = computed<QFormFieldRenderProps>(() => {
  const hintId = hasHint.value ? `${id.value}-hint` : undefined;
  const errorId = hasError.value ? `${id.value}-error` : undefined;
  const describedBy = [hintId, errorId, p.describedBy].filter(Boolean).join(' ') || undefined;
  const out: QFormFieldRenderProps = { id: id.value, labelId: `${id.value}-label`, invalid: hasError.value, required: !!p.required, disabled: !!p.disabled };
  if (hintId) out.hintId = hintId;
  if (errorId) out.errorId = errorId;
  if (describedBy) out.describedBy = describedBy;
  return out;
});
const labelClass = computed(() => ['q-form-field__label', { 'q-sr': p.hideLabel }]);
</script>

<template>
  <component
    :is="group ? 'fieldset' : 'div'"
    :class="['q-form-field', { 'q-form-field--group': group, 'q-form-field--disabled': disabled }]"
    :disabled="group && disabled ? true : undefined"
  >
    <template v-if="hasLabel">
      <legend v-if="group" :id="f.labelId" :class="labelClass">
        <slot name="label">{{ label }}</slot>
        <template v-if="required"><span class="q-form-field__req" aria-hidden="true">*</span><span class="q-sr">{{ tr('الزامی', 'required') }}</span></template>
      </legend>
      <label v-else :id="f.labelId" :for="labelFor || f.id" :class="labelClass">
        <slot name="label">{{ label }}</slot>
        <template v-if="required"><span class="q-form-field__req" aria-hidden="true">*</span><span class="q-sr">{{ tr('الزامی', 'required') }}</span></template>
      </label>
    </template>
    <slot v-bind="f" />
    <p v-if="hasHint" :id="f.hintId" class="q-form-field__hint"><slot name="hint">{{ hint }}</slot></p>
    <p v-if="hasError" :id="f.errorId" class="q-form-field__error" role="alert">
      <QIcon name="alert" :size="16" /><span><slot name="error">{{ error }}</slot></span>
    </p>
  </component>
</template>
