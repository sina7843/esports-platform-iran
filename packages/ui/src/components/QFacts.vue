<script setup lang="ts">
import { computed } from 'vue';
import { fa } from '../locale';
import type { IconName } from '../icons';
import QIcon from './QIcon.vue';

export interface QFactsItem { label: string; value: string | number; ltr?: boolean; icon?: IconName; hint?: string }
/** Key/value grid (dl) for event detail: «شروع ۱۲ آذر», «ظرفیت ۱۱ از ۱۶ تیم». columns 2|3|4, variant grid | list. Numbers go through fa(). */
export interface QFactsProps {
  items: QFactsItem[];
  columns?: 2 | 3 | 4;
  variant?: 'grid' | 'list';
  dense?: boolean;
}
const p = withDefaults(defineProps<QFactsProps>(), { columns: 3, variant: 'grid' });
const cols = computed(() => ([2, 3, 4].includes(Number(p.columns)) ? Number(p.columns) : 3));
const val = (v: string | number) => (typeof v === 'number' ? fa(v) : v);
</script>

<template>
  <div :class="['q-facts', variant === 'list' ? 'q-facts--list' : `q-facts--cols-${cols}`, { 'q-facts--dense': dense }]">
    <dl class="q-facts__dl">
      <div v-for="(it, i) in items" :key="i" class="q-facts__item">
        <dt class="q-facts__label"><QIcon v-if="it.icon" :name="it.icon" :size="14" />{{ it.label }}</dt>
        <dd class="q-facts__value">
          <span v-if="it.ltr" class="q-ltr">{{ val(it.value) }}</span><template v-else>{{ val(it.value) }}</template>
          <small v-if="it.hint" class="q-facts__hint">{{ it.hint }}</small>
        </dd>
      </div>
    </dl>
  </div>
</template>
