<script setup lang="ts">
import { computed } from 'vue';
import { formatInstant } from '@esp/contracts';
import { settings, TIME_ZONE } from '../settings';

const props = defineProps<{ iso: string | null | undefined; format?: 'date' | 'datetime' | 'time'; timeZone?: string }>();
const text = computed(() => {
  if (!props.iso) return '—';
  try {
    return formatInstant(props.iso, { locale: settings.locale, timeZone: props.timeZone ?? TIME_ZONE, style: props.format ?? 'datetime', digits: settings.digits === 'fa' ? 'locale' : 'latn' });
  } catch {
    return props.iso;
  }
});
</script>

<template>
  <time v-if="iso" class="bidi num" :datetime="iso">{{ text }}</time>
  <span v-else class="muted">—</span>
</template>
