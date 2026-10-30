<script setup lang="ts">
import { computed } from 'vue';
import { fa, num, tr } from '../locale';
import { pageList } from '../maps/navigation';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

/**
 * Pagination — mode 'cursor': «نمایش بیشتر» + «۲۴ از ۱۱۸» (`more` emit); mode 'numbered': prev/next with mirrored chevrons,
 * current page in green (`v-model:page` + `change`).
 */
export interface QPaginationProps {
  mode?: ('numbered' | 'cursor') | undefined;
  /** cursor: items shown so far and the total (if known). */
  shown?: (number) | undefined;
  total?: (number) | undefined;
  hasMore?: boolean | undefined;
  loading?: (boolean) | undefined;
  moreLabel?: (string) | undefined;
  doneLabel?: (string) | undefined;
  /** v1.1 — cursor: replaces the «۲۴ از ۱۱۸» count (or the `countLabel` slot); false hides it. */
  countLabel?: string | false | undefined;
  /** numbered */
  pageCount?: (number) | undefined;
  defaultPage?: (number) | undefined;
  siblings?: (number) | undefined;
  showSummary?: (boolean) | undefined;
  ariaLabel?: (string) | undefined;
}
const p = withDefaults(defineProps<QPaginationProps>(), {
  mode: 'numbered', shown: 0, hasMore: undefined, countLabel: undefined, pageCount: 1, defaultPage: 1, siblings: 1,
});
const page = defineModel<number>('page');
const emit = defineEmits<{ change: [page: number]; more: [] }>();

const cur = computed(() => page.value ?? p.defaultPage);
const count = computed(() => Math.max(1, p.pageCount));
function go(n: number) {
  if (n < 1 || n > count.value || n === cur.value) return;
  page.value = n;
  emit('change', n);
}
const done = computed(() => p.hasMore === false || (p.total != null && p.shown >= p.total));
const pct = computed(() => (p.total ? Math.min(100, Math.round((p.shown / p.total) * 100)) : 0));
const all = computed(() => num(p.total ?? p.shown));
</script>

<template>
  <div v-if="mode === 'cursor'" class="q-pagination q-pagination--cursor">
    <QButton v-if="!done" variant="secondary" icon="chevron-down" :loading="loading" @click="emit('more')">{{ moreLabel || tr('نمایش بیشتر', 'Load more') }}</QButton>
    <div class="q-pagination__progress">
      <span class="q-pagination__count" aria-live="polite">
        <template v-if="done">{{ doneLabel || tr(`همهٔ ${all} مورد نمایش داده شد`, `All ${all} items shown`) }}</template>
        <slot v-else-if="$slots.countLabel" name="countLabel" />
        <template v-else-if="countLabel !== undefined">{{ countLabel === false ? '' : countLabel }}</template>
        <template v-else><span class="q-num">{{ num(shown) }}</span>{{ tr(' از ', ' of ') }}<span class="q-num">{{ total != null ? num(total) : '…' }}</span></template>
      </span>
      <span v-if="total" class="q-pagination__meter" aria-hidden="true"><span :style="{ width: `${pct}%` }" /></span>
    </div>
  </div>
  <nav v-else class="q-pagination q-pagination--numbered" :aria-label="ariaLabel || tr('صفحه‌بندی', 'Pagination')">
    <button type="button" class="q-pagination__step" :disabled="cur <= 1" :aria-label="tr('صفحهٔ قبل', 'Previous page')" @click="go(cur - 1)">
      <QIcon name="chevron-left" :size="18" flip /><span class="q-pagination__step-label">{{ tr('قبلی', 'Previous') }}</span>
    </button>
    <ul class="q-pagination__pages">
      <template v-for="n in pageList(cur, count, siblings)" :key="n">
        <li v-if="typeof n === 'string'" class="q-pagination__gap" aria-hidden="true">…</li>
        <li v-else>
          <button
            type="button" :class="['q-pagination__page', { 'is-current': n === cur }]" :aria-current="n === cur ? 'page' : undefined"
            :aria-label="tr('صفحهٔ ', 'Page ') + fa(n)" @click="go(n)"
          >{{ fa(n) }}</button>
        </li>
      </template>
    </ul>
    <button type="button" class="q-pagination__step" :disabled="cur >= count" :aria-label="tr('صفحهٔ بعد', 'Next page')" @click="go(cur + 1)">
      <span class="q-pagination__step-label">{{ tr('بعدی', 'Next') }}</span><QIcon name="chevron-right" :size="18" flip />
    </button>
    <span v-if="showSummary" class="q-pagination__summary">{{ tr('صفحهٔ ', 'Page ') }}<span class="q-num">{{ fa(cur) }}</span>{{ tr(' از ', ' of ') }}<span class="q-num">{{ fa(count) }}</span></span>
  </nav>
</template>
