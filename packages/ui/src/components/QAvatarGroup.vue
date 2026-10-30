<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { avSize, type AvatarSize } from '../maps/display';
import QAvatar from './QAvatar.vue';

export interface QAvatarGroupItem { name: string; src?: string; kind?: 'user' | 'team' | 'organizer'; verified?: boolean }
/** Overlapping stack of avatars with a «+۳» overflow chip. */
export interface QAvatarGroupProps {
  items: QAvatarGroupItem[];
  max?: number;
  size?: AvatarSize;
  kind?: 'user' | 'team' | 'organizer';
  shape?: 'circle' | 'chamfer';
  label?: string;
}
const p = withDefaults(defineProps<QAvatarGroupProps>(), { max: 4, size: 32, kind: 'user' });
const sz = computed(() => avSize(p.size));
const shown = computed(() => p.items.slice(0, p.max));
const rest = computed(() => p.items.length - shown.value.length);
const cut = computed(() => (p.shape ?? (p.kind === 'user' ? 'circle' : 'chamfer')) === 'chamfer');
</script>

<template>
  <span :class="['q-avatar-group', `q-avatar-group--${sz}`, { 'q-avatar-group--cut': cut }]" role="group" :aria-label="label">
    <QAvatar v-for="(it, i) in shown" :key="i" :name="it.name" :src="it.src" :kind="it.kind || kind" :shape="shape" :size="sz" :verified="it.verified" />
    <span v-if="rest > 0" :class="['q-avatar-group__more', `q-avatar--${sz}`]" role="img" :aria-label="tr(`${fa(rest)} مورد دیگر`, `${rest} more`)">
      <span aria-hidden="true" class="q-num q-ltr">+{{ fa(rest) }}</span>
    </span>
  </span>
</template>
