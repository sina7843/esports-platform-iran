<script setup lang="ts">
import QLogo from './QLogo.vue';

/** Broadcast name strap: kicker, title, subtitle, brand-green (or tricolour) accent bar, optional QeSB mark. */
export interface QLowerThirdProps {
  /** Name line, e.g. «علی رضایی». */
  title: string;
  subtitle?: (string) | undefined;
  /** Role above the name in green-text, e.g. «مفسر». */
  kicker?: (string) | undefined;
  accent?: ('green' | 'tricolor') | undefined;
  logo?: (boolean) | undefined;
  logoVariant?: ('auto' | 'color' | 'white' | 'black') | undefined;
  transparent?: (boolean) | undefined;
}
withDefaults(defineProps<QLowerThirdProps>(), { accent: 'green', logoVariant: 'auto' });
</script>

<template>
  <div :class="['q-lower-third', { 'q-lower-third--transparent': transparent }]" role="group" :aria-label="title">
    <div class="q-lower-third__plate q-chamfer-md">
      <span :class="['q-lower-third__bar', `q-lower-third__bar--${accent}`]" aria-hidden="true"><template v-if="accent === 'tricolor'"><i /><i /><i /></template></span>
      <span v-if="logo" class="q-lower-third__logo"><QLogo :size="48" :variant="logoVariant" /></span>
      <div class="q-lower-third__text">
        <span v-if="kicker" class="q-lower-third__kicker">{{ kicker }}</span>
        <strong class="q-lower-third__title"><bdi>{{ title }}</bdi></strong>
        <span v-if="subtitle" class="q-lower-third__subtitle"><bdi>{{ subtitle }}</bdi></span>
      </div>
    </div>
  </div>
</template>
