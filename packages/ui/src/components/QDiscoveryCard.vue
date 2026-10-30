<script setup lang="ts">
import { computed, useAttrs, useSlots } from 'vue';
import type { IconName } from '../icons';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

/** DiscoveryCard: «مسیرت را انتخاب کن» shortcut — chamfered green icon tile, title, description, forward arrow; the whole card is the link. */
export interface QDiscoveryCardProps {
  icon?: IconName;
  title: string;
  description?: string;
  meta?: string;
  /** Renders the card as a link; otherwise a native `@click` makes it a button. */
  href?: string;
  /** aria-current="page". */
  current?: boolean;
  arrow?: boolean;
  headingLevel?: 2 | 3 | 4;
}
const p = withDefaults(defineProps<QDiscoveryCardProps>(), { icon: 'trophy', arrow: true, headingLevel: 3 });
const attrs = useAttrs();
const slots = useSlots();

const tag = computed(() => (p.href ? 'a' : attrs.onClick ? 'button' : 'div'));
const titleTag = computed(() => (tag.value === 'button' ? 'span' : `h${p.headingLevel}`));
</script>

<template>
  <component
    :is="href ? QLink : tag"
    :href="href"
    :type="tag === 'button' ? 'button' : undefined"
    :aria-current="current ? 'page' : undefined"
    :class="['q-discovery-card', { 'q-discovery-card--interactive': tag !== 'div' }]"
  >
    <span class="q-discovery-card__tile q-chamfer-sm" aria-hidden="true"><QIcon :name="icon" :size="24" /></span>
    <component :is="titleTag" class="q-discovery-card__title"><slot name="title">{{ title }}</slot></component>
    <span v-if="description || slots.description" class="q-discovery-card__desc"><slot name="description">{{ description }}</slot></span>
    <span v-if="meta || slots.meta" class="q-discovery-card__meta"><slot name="meta">{{ meta }}</slot></span>
    <QIcon v-if="arrow !== false && tag !== 'div'" name="arrow-right" flip :size="18" class="q-discovery-card__arrow" />
  </component>
</template>
