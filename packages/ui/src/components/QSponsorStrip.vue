<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { latin } from '../maps/broadcast';
import QIcon from './QIcon.vue';

export interface QSponsorStripSponsor { name: string; logoUrl?: string | null }
/** Sponsor row for overlays: «اسپانسر» label, logo slots (placeholders show the name) and the stream-sync indicator. */
export interface QSponsorStripProps {
  sponsors: QSponsorStripSponsor[];
  /** Label before the slots. Default «اسپانسر». */
  label?: (string) | undefined;
  /** synced → «هماهنگ با پخش (تأخیر ۳۰ ثانیه)», latest → «آخرین نتیجه». */
  sync?: ({ mode: 'synced' | 'latest'; delaySeconds?: number; label?: string }) | undefined;
  transparent?: (boolean) | undefined;
}
const p = defineProps<QSponsorStripProps>();

const synced = computed(() => p.sync?.mode !== 'latest');
const syncText = computed(() => {
  const s = p.sync;
  if (!s) return '';
  if (s.label) return s.label;
  if (!synced.value) return tr('آخرین نتیجه', 'Latest result');
  const n = s.delaySeconds ?? 30;
  return tr(`هماهنگ با پخش (تأخیر ${fa(n)} ثانیه)`, `Synced to stream (${n}s delay)`);
});
const groupLabel = computed(() => p.label || tr('اسپانسر', 'Sponsor'));
</script>

<template>
  <div :class="['q-sponsor-strip', { 'q-sponsor-strip--transparent': transparent }]" role="group" :aria-label="groupLabel">
    <div class="q-sponsor-strip__plate q-chamfer-sm">
      <span class="q-sponsor-strip__label">{{ groupLabel }}</span>
      <ul class="q-sponsor-strip__slots">
        <li v-for="(s, i) in sponsors ?? []" :key="i" :class="['q-sponsor-strip__slot', { 'q-stripes': !s.logoUrl }]">
          <img v-if="s.logoUrl" :src="s.logoUrl" :alt="s.name" />
          <bdi v-else :class="latin(s.name) ? 'q-ltr' : undefined">{{ s.name }}</bdi>
        </li>
      </ul>
    </div>
    <span v-if="sync" :class="['q-sponsor-strip__sync', synced ? 'q-sponsor-strip__sync--synced' : 'q-sponsor-strip__sync--latest']" role="status">
      <QIcon :name="synced ? 'broadcast' : 'clock'" :size="16" />{{ syncText }}
    </span>
  </div>
</template>
