<script setup lang="ts">
import { tr } from '../locale';

/** Small green check-in-circle mark. Without `text` it is an image with an accessible label. class/title fall through. */
export interface QVerifiedMarkProps {
  /** Accessible name when no visible text. Default «تأییدشده». */
  label?: (string) | undefined;
  /** Visible text after the mark, e.g. «برگزارکنندهٔ تأییدشده». */
  text?: (string) | undefined;
  /** Icon size in px. Default 18. */
  size?: (number) | undefined;
}
withDefaults(defineProps<QVerifiedMarkProps>(), { size: 18 });
</script>

<template>
  <span
    :class="['q-verified-mark', { 'q-verified-mark--text': text }]"
    :role="text ? undefined : 'img'"
    :aria-label="text ? undefined : label || tr('تأییدشده', 'Verified')"
  >
    <svg class="q-verified-mark__icon" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" /><path d="m7.2 12.4 3.2 3.2 6.4-6.8" />
    </svg>
    <span v-if="text" class="q-verified-mark__text">{{ text }}</span>
  </span>
</template>
