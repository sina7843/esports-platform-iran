<script setup lang="ts">
import { computed } from 'vue';
import { tr } from '../locale';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

export interface BreadcrumbItem { label: string; href?: string }
/** Breadcrumb — the page trail. Chevrons mirror in RTL; the last item is the current page (aria-current), not a link. */
export interface QBreadcrumbProps {
  items: BreadcrumbItem[];
  /** Collapse the middle into «…» when longer than this (≥3). */
  maxItems?: (number) | undefined;
  ariaLabel?: (string) | undefined;
}
const p = withDefaults(defineProps<QBreadcrumbProps>(), { maxItems: 0 });

type Row = { gap: true; i: -1 } | { gap: false; i: number; it: BreadcrumbItem };
const list = computed<Row[]>(() => {
  const all: Row[] = p.items.map((it, i) => ({ gap: false, i, it }));
  const max = p.maxItems;
  if (max >= 3 && p.items.length > max) return [all[0]!, { gap: true, i: -1 }, ...all.slice(p.items.length - (max - 2))];
  return all;
});
const gapTitle = computed(() => p.items.slice(1, p.items.length - (p.maxItems - 2)).map((i) => i.label).join(' / '));
</script>

<template>
  <nav class="q-breadcrumb" :aria-label="ariaLabel || tr('مسیر صفحه', 'Breadcrumb')">
    <ol class="q-breadcrumb__list">
      <li v-for="(x, k) in list" :key="k" class="q-breadcrumb__item">
        <QIcon v-if="k > 0" name="chevron-right" :size="16" flip class="q-breadcrumb__sep" />
        <span v-if="x.gap" class="q-breadcrumb__gap" :title="gapTitle">…</span>
        <span v-else-if="x.i === items.length - 1 || !x.it.href" class="q-breadcrumb__current" :aria-current="x.i === items.length - 1 ? 'page' : undefined">{{ x.it.label }}</span>
        <QLink v-else :href="x.it.href" class="q-breadcrumb__link">{{ x.it.label }}</QLink>
      </li>
    </ol>
  </nav>
</template>
