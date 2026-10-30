<script setup lang="ts">
import { computed, ref } from 'vue';
import type { IconName } from '../icons';
import { elIsRtl, hStep } from '../composables/navigation-dom';
import QIcon from './QIcon.vue';

export interface SegmentedControlOption { value: string; label: string; icon?: IconName; disabled?: boolean }
/** SegmentedControl — one-of-few choice (view «کارت‌ها / فهرست», theme). role radiogroup; selected = green-soft. `v-model` + `change`. */
export interface QSegmentedControlProps {
  options: SegmentedControlOption[];
  defaultValue?: (string) | undefined;
  size?: ('sm' | 'md') | undefined;
  /** Show icons only; label becomes aria-label + title. */
  iconOnly?: (boolean) | undefined;
  /** Stretch to the container width. */
  block?: (boolean) | undefined;
  /** Required by the DS; optional in TS only because vue-tsc does not map the kebab `aria-label` attribute onto it. */
  ariaLabel?: (string) | undefined;
}
const p = withDefaults(defineProps<QSegmentedControlProps>(), { size: 'md' });
const model = defineModel<string>();
const emit = defineEmits<{ change: [value: string] }>();

const root = ref<HTMLElement | null>(null);
const val = computed(() => model.value ?? p.defaultValue ?? p.options[0]?.value);
function set(v: string) {
  model.value = v;
  emit('change', v);
}
function onKey(e: KeyboardEvent) {
  const vals = p.options.filter((o) => !o.disabled).map((o) => o.value);
  const cur = vals.indexOf(val.value ?? '');
  const s = hStep(e.key, elIsRtl(root.value)) || (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0);
  let n: number;
  if (s) n = (cur + s + vals.length) % vals.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = vals.length - 1;
  else return;
  e.preventDefault();
  const v = vals[n]!;
  set(v);
  root.value?.querySelector<HTMLElement>(`[data-i="${p.options.findIndex((o) => o.value === v)}"]`)?.focus();
}
</script>

<template>
  <div
    ref="root" role="radiogroup" :aria-label="ariaLabel"
    :class="['q-segmented-control', { 'q-segmented-control--sm': size === 'sm', 'q-segmented-control--block': block }]"
    @keydown="onKey"
  >
    <button
      v-for="(o, i) in options" :key="o.value" type="button" role="radio" :aria-checked="o.value === val ? 'true' : 'false'"
      :data-i="i" :tabindex="o.value === val ? 0 : -1" :disabled="o.disabled"
      :class="['q-segmented-control__option', { 'is-selected': o.value === val, 'q-segmented-control__option--icon': iconOnly }]"
      :aria-label="iconOnly ? o.label : undefined" :title="iconOnly ? o.label : undefined"
      @click="set(o.value)"
    >
      <QIcon v-if="o.icon" :name="o.icon" :size="18" />
      <span v-if="!iconOnly">{{ o.label }}</span>
    </button>
  </div>
</template>
