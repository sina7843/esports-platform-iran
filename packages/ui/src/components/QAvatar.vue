<script setup lang="ts">
import { computed } from 'vue';
import { tr } from '../locale';
import { avChamfer, avSize, initial, type AvatarSize } from '../maps/display';
import QIcon from './QIcon.vue';

/** Avatar for a user (circle) or team/organizer (chamfered square). Image or first-letter initial; verified mark; online dot. */
export interface QAvatarProps {
  name: string;
  src?: string | undefined;
  kind?: 'user' | 'team' | 'organizer' | undefined;
  shape?: 'circle' | 'chamfer' | undefined;
  size?: AvatarSize | undefined;
  verified?: boolean | undefined;
  verifiedLabel?: string | undefined;
  online?: boolean | undefined;
  onlineLabel?: string | undefined;
  alt?: string | undefined;
  decorative?: boolean | undefined;
}
const p = withDefaults(defineProps<QAvatarProps>(), { kind: 'user', size: 40 });
const sz = computed(() => avSize(p.size));
const circle = computed(() => (p.shape ?? (p.kind === 'user' ? 'circle' : 'chamfer')) === 'circle');
const markSize = computed(() => (sz.value >= 72 ? 14 : sz.value >= 40 ? 10 : 8));
</script>

<template>
  <span :class="['q-avatar', `q-avatar--${sz}`]">
    <span
      :class="['q-avatar__face', circle ? 'q-avatar__face--circle' : avChamfer(sz)]"
      :role="decorative ? undefined : 'img'"
      :aria-label="decorative ? undefined : (alt ?? name)"
      :aria-hidden="decorative ? 'true' : undefined"
    >
      <img v-if="src" :src="src" alt="" class="q-avatar__img" />
      <span v-else aria-hidden="true">{{ initial(name) }}</span>
    </span>
    <span v-if="verified" class="q-avatar__verified">
      <QIcon name="check" :size="markSize" :stroke-width="3.5" /><span class="q-sr">{{ verifiedLabel || tr('تأییدشده', 'Verified') }}</span>
    </span>
    <span v-if="online" class="q-avatar__online"><span class="q-sr">{{ onlineLabel || tr('آنلاین', 'Online') }}</span></span>
  </span>
</template>
