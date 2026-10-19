<script setup lang="ts">
import { computed } from 'vue';
import { formatToman, normalizeDigits } from '@esp/contracts';
import { settings } from '../settings';

const props = defineProps<{ rial: number }>();
const text = computed(() => {
  const s = formatToman(props.rial, settings.locale);
  return settings.locale === 'fa' && settings.digits === 'latn' ? normalizeDigits(s) : s;
});
</script>

<template>
  <span class="bidi num" :title="`${rial} IRR`">{{ text }}</span>
</template>
