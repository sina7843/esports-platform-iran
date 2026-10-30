<script setup lang="ts">
import logoColor from '../assets/qesb-logo.svg';
import logoWhite from '../assets/qesb-logo-white.svg';
import logoBlack from '../assets/qesb-logo-black.svg';

/** The QeSB mark. variant 'auto' shows the white mark on dark and the colour mark on light. */
export interface QLogoProps {
  variant?: 'auto' | 'color' | 'white' | 'black';
  size?: number;
  alt?: string;
}
defineOptions({ inheritAttrs: false });
withDefaults(defineProps<QLogoProps>(), { variant: 'auto', size: 56, alt: 'QeSB' });
const SRC = { color: logoColor, white: logoWhite, black: logoBlack } as const;
</script>

<template>
  <img v-if="variant !== 'auto'" v-bind="$attrs" :src="SRC[variant]" :alt="alt" :width="size" :height="size" class="q-logo" />
  <template v-else>
    <img v-bind="$attrs" :src="logoWhite" :alt="alt" :width="size" :height="size" class="q-logo q-logo-dark" />
    <img v-bind="$attrs" :src="logoColor" :alt="alt" :width="size" :height="size" class="q-logo q-logo-light" />
  </template>
</template>
