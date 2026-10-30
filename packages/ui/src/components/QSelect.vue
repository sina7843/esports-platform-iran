<script setup lang="ts">
import { computed } from 'vue';
import { useControlled } from '../composables/inputs-field';
import QFormField from './QFormField.vue';
import QIcon from './QIcon.vue';

export interface QSelectOption { value: string; label: string; disabled?: boolean }
export interface QSelectOptionGroup { label: string; options: QSelectOption[] }
/** Select: native select styled as a 48px control with a chevron at the inline end. options may nest { label, options } groups. */
export interface QSelectProps {
  label?: (string) | undefined;
  hint?: (string) | undefined;
  error?: (string) | undefined;
  required?: (boolean) | undefined;
  disabled?: (boolean) | undefined;
  placeholder?: (string) | undefined;
  options: Array<QSelectOption | QSelectOptionGroup>;
  id?: (string) | undefined;
  name?: (string) | undefined;
  hideLabel?: (boolean) | undefined;
  defaultValue?: (string) | undefined;
}
const p = defineProps<QSelectProps>();
const model = defineModel<string>();
const emit = defineEmits<{ change: [value: string, event: Event] }>();
const cur = useControlled(model, p.defaultValue ?? '');
const val = computed(() => cur.value ?? '');
const isGroup = (o: QSelectOption | QSelectOptionGroup): o is QSelectOptionGroup => 'options' in o && Array.isArray(o.options);

function onChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  model.value = v;
  emit('change', v, e);
}
</script>

<template>
  <QFormField :id="id" :label="label" :hint="hint" :error="error" :required="required" :disabled="disabled" :hide-label="hideLabel">
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <template v-if="$slots.hint" #hint><slot name="hint" /></template>
    <template v-if="$slots.error" #error><slot name="error" /></template>
    <template #default="f">
      <div :class="['q-form-field__control', 'q-select', { 'q-form-field__control--invalid': f.invalid, 'q-form-field__control--disabled': disabled }]">
        <select
          :id="f.id"
          :name="name"
          :value="val"
          :disabled="disabled"
          :required="required"
          :aria-invalid="f.invalid ? 'true' : undefined"
          :aria-describedby="f.describedBy"
          :class="['q-select__native', { 'q-select__native--placeholder': val === '' }]"
          @change="onChange"
        >
          <option v-if="placeholder != null" value="" :disabled="!!required">{{ placeholder }}</option>
          <template v-for="o in options" :key="isGroup(o) ? `g${o.label}` : o.value">
            <optgroup v-if="isGroup(o)" :label="o.label">
              <option v-for="c in o.options" :key="c.value" :value="c.value" :disabled="c.disabled">{{ c.label }}</option>
            </optgroup>
            <option v-else :value="o.value" :disabled="o.disabled">{{ o.label }}</option>
          </template>
        </select>
        <QIcon name="chevron-down" :size="20" class="q-select__chevron" />
      </div>
    </template>
  </QFormField>
</template>
