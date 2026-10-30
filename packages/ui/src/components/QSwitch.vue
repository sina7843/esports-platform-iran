<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { useControlled, useUid } from '../composables/inputs-field';

/** Switch: role=switch button with a 44×24 track (on = green), label at the inline start, optional description. v-model = checked + change(checked, event). */
export interface QSwitchProps {
  label?: string;
  description?: string;
  disabled?: boolean;
  block?: boolean;
  defaultChecked?: boolean;
  id?: string;
  name?: string;
  hideLabel?: boolean;
}
const p = defineProps<QSwitchProps>();
const model = defineModel<boolean | null>({ default: null });
const emit = defineEmits<{ change: [checked: boolean, event: MouseEvent] }>();
const slots = useSlots();
const cur = useControlled(model, !!p.defaultChecked);
const id = useUid('q-switch', () => p.id);
const on = computed(() => !!cur.value);
const descId = computed(() => (p.description || slots.description ? `${id.value}-desc` : undefined));

function toggle(e: MouseEvent) {
  const v = !on.value;
  model.value = v;
  emit('change', v, e);
}
</script>

<template>
  <div :class="['q-switch', { 'q-switch--block': block, 'q-switch--disabled': disabled }]">
    <span class="q-switch__text">
      <label :id="`${id}-label`" :for="id" :class="['q-switch__label', { 'q-sr': hideLabel }]"><slot name="label">{{ label }}</slot></label>
      <span v-if="descId" :id="descId" class="q-switch__desc"><slot name="description">{{ description }}</slot></span>
    </span>
    <button
      :id="id"
      type="button"
      role="switch"
      :aria-checked="on ? 'true' : 'false'"
      :disabled="disabled"
      :name="name"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="descId"
      :class="['q-switch__control', { 'q-switch__control--on': on }]"
      @click="toggle"
    >
      <span class="q-switch__track" aria-hidden="true"><span class="q-switch__thumb" /></span>
    </button>
  </div>
</template>
