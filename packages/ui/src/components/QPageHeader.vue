<script setup lang="ts">
import type { IconName } from '../icons';
import QBadge from './QBadge.vue';
import QBreadcrumb, { type BreadcrumbItem } from './QBreadcrumb.vue';
import QTricolor from './QTricolor.vue';

/** PageHeader — breadcrumb, h1 title, status badge, description and end-aligned actions. compact for panels. */
export interface QPageHeaderProps {
  /** h1 text (or the `title` slot). */
  title?: (string) | undefined;
  description?: (string) | undefined;
  breadcrumb?: (BreadcrumbItem[]) | undefined;
  breadcrumbMax?: (number) | undefined;
  /** Status shown next to the title as a Badge. */
  status?: ({ label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live' | 'red' | 'green'; dot?: boolean; icon?: IconName }) | undefined;
  /** Extra node beside the title (or the `badge` slot). */
  badge?: (string) | undefined;
  /** Small green line above the title with the tricolour. */
  eyebrow?: (string) | undefined;
  /** Meta row under the description. */
  meta?: (string) | undefined;
  /** Buttons at the inline end (normally the `actions` slot). */
  actions?: (string) | undefined;
  /** Panel density: h3-sized title, tighter padding. */
  compact?: (boolean) | undefined;
}
defineProps<QPageHeaderProps>();
</script>

<template>
  <header :class="['q-page-header', { 'q-page-header--compact': compact }]">
    <QBreadcrumb v-if="breadcrumb" :items="breadcrumb" v-bind="breadcrumbMax != null ? { maxItems: breadcrumbMax } : {}" />
    <div class="q-page-header__row">
      <div class="q-page-header__text">
        <span v-if="eyebrow || $slots.eyebrow" class="q-page-header__eyebrow"><QTricolor /><slot name="eyebrow">{{ eyebrow }}</slot></span>
        <div class="q-page-header__title-row">
          <h1 class="q-page-header__title"><slot name="title">{{ title }}</slot></h1>
          <QBadge v-if="status" :tone="status.tone ?? 'neutral'" v-bind="{ ...(status.icon ? { icon: status.icon } : {}), ...(status.dot != null ? { dot: status.dot } : {}) }">{{ status.label }}</QBadge>
          <slot name="badge">{{ badge }}</slot>
        </div>
        <p v-if="description || $slots.description" class="q-page-header__desc"><slot name="description">{{ description }}</slot></p>
        <div v-if="meta || $slots.meta" class="q-page-header__meta"><slot name="meta">{{ meta }}</slot></div>
      </div>
      <div v-if="actions || $slots.actions" class="q-page-header__actions"><slot name="actions">{{ actions }}</slot></div>
    </div>
  </header>
</template>
