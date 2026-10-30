<script setup lang="ts">
import { computed } from 'vue';
import { tr } from '../locale';
import { GID_STATES, stateBadge } from '../maps/people';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

export type QGameIdentityState = 'unverified' | 'pending' | 'verified' | 'rejected' | 'disputed';
/** One game-account ID row: game, platform, ID (LTR), verification state and edit action (@edit; `:on-edit="false"` hides it). */
export interface QGameIdentityProps {
  game: string;
  platform?: string;
  value: string;
  state?: QGameIdentityState;
  note?: string;
  /** Listener of @edit; false hides the edit button. */
  onEdit?: (() => void) | false | undefined;
}
const p = withDefaults(defineProps<QGameIdentityProps>(), { state: 'unverified', onEdit: undefined });
const b = computed(() => stateBadge(GID_STATES, p.state));
const noteText = computed(() => p.note || (p.state === 'disputed'
  ? tr('این شناسه روی حساب دیگری هم ثبت شده و برای بررسی دستی ارسال شد؛ ادغام خودکار انجام نمی‌شود.',
    'This identity is already registered to another account and was sent to manual review; nothing is merged automatically.')
  : null));
function edit() { if (typeof p.onEdit === 'function') p.onEdit(); }
</script>

<template>
  <div :class="['q-game-identity', `q-game-identity--${state}`]">
    <span class="q-game-identity__icon" aria-hidden="true"><QIcon name="gamepad" :size="20" /></span>
    <div class="q-game-identity__body">
      <div class="q-game-identity__line">
        <span class="q-game-identity__game q-ltr">{{ game }}</span>
        <span v-if="platform" class="q-game-identity__platform"><bdi>{{ platform }}</bdi></span>
      </div>
      <span class="q-game-identity__value q-ltr">{{ value }}</span>
    </div>
    <div class="q-game-identity__state"><QBadge v-bind="b.props">{{ b.label }}</QBadge></div>
    <QButton
      v-if="onEdit !== false" variant="ghost" icon-only icon="edit" class="q-game-identity__edit"
      :aria-label="tr('ویرایش شناسه ' + (game || ''), 'Edit ' + (game ? game + ' ' : '') + 'ID')" @click="edit"
    />
    <p v-if="noteText" class="q-game-identity__note" :role="state === 'disputed' || state === 'rejected' ? 'note' : undefined">{{ noteText }}</p>
  </div>
</template>
