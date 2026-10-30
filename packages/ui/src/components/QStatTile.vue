<script setup lang="ts">
import { computed } from 'vue';
import { dec, fa, num } from '../locale';
import type { IconName } from '../icons';
import QIcon from './QIcon.vue';

/**
 * A single real count (of the loaded list, never platform-wide invented totals), with optional delta and caption.
 * Numbers are grouped: «۱۲٬۰۰۰» / «12,000», decimals «۱۲٬۵۰۰٫۵». label / value / unit / caption: prop or slot.
 */
export interface QStatTileProps {
  label?: string;
  value?: number | string;
  unit?: string;
  icon?: IconName;
  delta?: number | string;
  trend?: 'up' | 'down' | 'flat';
  deltaTone?: 'success' | 'danger' | 'warning' | 'neutral';
  deltaLabel?: string;
  caption?: string;
}
const p = withDefaults(defineProps<QStatTileProps>(), { trend: 'flat' });
const v = computed(() => (typeof p.value === 'number' ? (Math.round(p.value) === p.value ? num(p.value) : dec(p.value)) : (p.value ?? '')));
const dTone = computed(() => p.deltaTone || (p.trend === 'up' ? 'success' : p.trend === 'down' ? 'danger' : 'neutral'));
</script>

<template>
  <div class="q-stat-tile">
    <div class="q-stat-tile__head">
      <span v-if="icon" class="q-stat-tile__icon"><QIcon :name="icon" :size="18" /></span>
      <span class="q-stat-tile__label"><slot name="label">{{ label }}</slot></span>
    </div>
    <div class="q-stat-tile__row">
      <span class="q-stat-tile__value numeral q-num"><slot name="value">{{ v }}</slot></span>
      <span v-if="unit || $slots.unit" class="q-stat-tile__unit"><slot name="unit">{{ unit }}</slot></span>
      <span v-if="delta != null" :class="['q-stat-tile__delta', `q-stat-tile__delta--${dTone}`]">
        <QIcon v-if="trend !== 'flat'" :name="trend === 'up' ? 'chevron-up' : 'chevron-down'" :size="14" :stroke-width="2.5" />
        <span class="q-num q-ltr">{{ typeof delta === 'number' ? fa(delta) : delta }}</span>
        <span v-if="deltaLabel" class="q-sr">{{ deltaLabel }}</span>
      </span>
    </div>
    <p v-if="caption || $slots.caption" class="q-stat-tile__caption"><slot name="caption">{{ caption }}</slot></p>
  </div>
</template>
