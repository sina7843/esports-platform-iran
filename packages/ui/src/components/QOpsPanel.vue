<script setup lang="ts">
import { Comment, Fragment, getCurrentInstance, ref, useId, type VNode } from 'vue';
import { fa, num, tr } from '../locale';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QLiveDot from './QLiveDot.vue';

export interface QOpsPanelCounter {
  /** Count of the items shown in this panel — never a platform-wide figure. */
  value: number;
  label: string;
  tone?: 'danger' | 'warning' | 'live' | 'success';
}
/**
 * Event-operations dashboard frame: header with refresh cadence and last update, counters of the shown items, alert list
 * region (each default-slot child becomes an <li>), bulk-action bar with preview. The refresh button renders only with @refresh.
 */
export interface QOpsPanelProps {
  title?: string;
  cadence?: string;
  subtitle?: string;
  updatedAt?: string;
  updatedLabel?: string;
  refreshing?: boolean;
  refreshLabel?: string;
  counters?: QOpsPanelCounter[];
  countersNote?: string;
  listTitle?: string;
  emptyLabel?: string;
  selectedCount?: number;
  selectedLabel?: string;
  /** Bulk action kinds. The bar renders only when given. */
  bulkKinds?: Array<{ value: string; label: string }>;
  bulkKindLabel?: string;
  previewLabel?: string;
  bulkHint?: string;
}
const p = withDefaults(defineProps<QOpsPanelProps>(), { selectedCount: 0 });
const emit = defineEmits<{ refresh: []; preview: [kind: string] }>();
const slots = defineSlots<{ default?: () => VNode[] }>();
const inst = getCurrentInstance();
const selId = useId();
const headId = useId();

const kind = ref(p.bulkKinds?.[0]?.value ?? '');
const hasRefresh = () => !!inst?.vnode.props?.onRefresh;
/** Top-level slot children (fragments from v-for flattened, comments dropped), like React.Children.toArray. */
function kids(): VNode[] {
  const out: VNode[] = [];
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const v of list as VNode[]) {
      if (v.type === Fragment) walk(v.children);
      else if (v.type !== Comment) out.push(v);
    }
  };
  walk(slots.default?.());
  return out;
}
</script>

<template>
  <section class="q-ops-panel" :aria-labelledby="headId">
    <header class="q-ops-panel__head">
      <div class="q-ops-panel__titles">
        <h2 :id="headId" class="q-ops-panel__title">{{ title || tr('داشبورد عملیات', 'Operations dashboard') }}<span class="q-ops-panel__cadence"> · {{ cadence || tr(`به‌روزرسانی هر ${fa(30)} ثانیه`, 'Refreshes every 30 seconds') }}</span></h2>
        <p v-if="subtitle" class="q-ops-panel__subtitle">{{ subtitle }}</p>
      </div>
      <div class="q-ops-panel__refresh">
        <span v-if="updatedAt" class="q-ops-panel__updated" role="status">{{ (updatedLabel || tr('آخرین به‌روزرسانی', 'Last updated')) + ': ' }}<time>{{ updatedAt }}</time></span>
        <QButton v-if="hasRefresh()" variant="secondary" icon="refresh" :loading="refreshing" @click="emit('refresh')">{{ refreshLabel || tr('تازه‌سازی', 'Refresh') }}</QButton>
      </div>
    </header>
    <div v-if="counters && counters.length" class="q-ops-panel__counters-wrap">
      <ul class="q-ops-panel__counters">
        <li v-for="(c, i) in counters" :key="i" :class="['q-ops-panel__counter', c.tone ? `q-ops-panel__counter--${c.tone}` : null]">
          <strong class="q-ops-panel__counter-value"><QLiveDot v-if="c.tone === 'live'" />{{ fa(c.value) }}</strong>
          <span class="q-ops-panel__counter-label">{{ c.label }}</span>
        </li>
      </ul>
      <p v-if="countersNote" class="q-ops-panel__note">{{ countersNote }}</p>
    </div>
    <div class="q-ops-panel__list" role="region" :aria-label="listTitle || tr('هشدارها', 'Alerts')" aria-live="polite">
      <h3 class="q-ops-panel__list-title">{{ listTitle || tr('هشدارها', 'Alerts') }}</h3>
      <ul v-if="kids().length" class="q-ops-panel__items">
        <li v-for="(k, i) in kids()" :key="i"><component :is="k" /></li>
      </ul>
      <p v-else class="q-ops-panel__empty"><QIcon name="check-circle" :size="18" />{{ emptyLabel || tr('هشدار فعالی وجود ندارد.', 'No active alerts.') }}</p>
    </div>
    <div v-if="bulkKinds && bulkKinds.length" class="q-ops-panel__bulk">
      <span class="q-ops-panel__bulk-count">{{ `${num(selectedCount)} ${selectedLabel || tr('مورد انتخاب شده', 'selected')}` }}</span>
      <label class="q-sr" :for="selId">{{ bulkKindLabel || tr('نوع اقدام', 'Action') }}</label>
      <span class="q-ops-panel__select-wrap">
        <select :id="selId" v-model="kind" class="q-ops-panel__select">
          <option v-for="k in bulkKinds" :key="k.value" :value="k.value">{{ k.label }}</option>
        </select>
        <QIcon name="chevron-down" :size="16" class="q-ops-panel__select-icon" />
      </span>
      <QButton variant="green" icon="eye" :disabled="!selectedCount" @click="emit('preview', kind)">{{ previewLabel || tr('پیش‌نمایش اقدام گروهی', 'Preview bulk action') }}</QButton>
      <p v-if="bulkHint" class="q-ops-panel__bulk-hint">{{ bulkHint }}</p>
    </div>
  </section>
</template>
