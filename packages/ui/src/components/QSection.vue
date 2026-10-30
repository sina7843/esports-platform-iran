<script setup lang="ts">
import QTricolor from './QTricolor.vue';

/** Kit page section: heading row (eyebrow with Tricolor, title, description, action at the inline end) + content. */
export interface QSectionProps {
  id?: (string) | undefined;
  eyebrow?: (string) | undefined;
  title?: (string) | undefined;
  description?: (string) | undefined;
  /** heading element, default h2 */
  level?: ('h1' | 'h2' | 'h3' | 'h4') | undefined;
  /** smaller h4-styled title */
  small?: (boolean) | undefined;
}
withDefaults(defineProps<QSectionProps>(), { level: 'h2' });
</script>

<template>
  <section class="k-section" :id="id" :aria-labelledby="id ? `${id}-h` : undefined">
    <div v-if="title || $slots.title || $slots.action" class="k-section__head">
      <div class="k-section__titles">
        <span v-if="eyebrow || $slots.eyebrow" class="k-section__eyebrow"><QTricolor /><slot name="eyebrow">{{ eyebrow }}</slot></span>
        <component :is="level" v-if="title || $slots.title" :id="id ? `${id}-h` : undefined" :class="small ? 'h4' : 'h2'"><slot name="title">{{ title }}</slot></component>
        <p v-if="description || $slots.description" class="k-section__desc"><slot name="description">{{ description }}</slot></p>
      </div>
      <div v-if="$slots.action" class="k-section__action"><slot name="action" /></div>
    </div>
    <slot />
  </section>
</template>
