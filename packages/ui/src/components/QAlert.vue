<script setup lang="ts">
import { computed, ref } from 'vue';
import { tr } from '../locale';
import type { IconName } from '../icons';
import { TONE_ICON, noticeTone } from '../maps/display';
import { defined } from '../composables/inputs-field';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

export interface QAlertAction { label: string; onClick?: (e: MouseEvent) => void; href?: string; variant?: 'primary' | 'green' | 'secondary' | 'ghost' | 'danger'; icon?: IconName }
/**
 * Inline notice. tone info | success | warning | danger; title, body (default slot), actions (array or #actions slot), dismiss.
 * The × shows with `dismissible` or a bound @dismiss; the alert hides itself unless `open` is controlled. danger uses role=alert.
 */
export interface QAlertProps {
  tone?: 'info' | 'success' | 'warning' | 'danger' | undefined;
  title?: string | undefined;
  actions?: QAlertAction[] | undefined;
  dismissible?: boolean | undefined;
  dismissLabel?: string | undefined;
  open?: boolean | undefined;
  icon?: IconName | undefined;
  role?: string | undefined;
  /** Listener presence (@dismiss) shows the ×, as in the DS. */
  onDismiss?: () => void;
}
const p = withDefaults(defineProps<QAlertProps>(), { open: undefined });
const emit = defineEmits<{ dismiss: [] }>();
const t = computed(() => noticeTone(p.tone));
const hidden = ref(false);
function dismiss() {
  if (p.open == null) hidden.value = true;
  emit('dismiss');
}
</script>

<template>
  <div v-if="!hidden && open !== false" :class="['q-alert', `q-alert--${t}`]" :role="role || (t === 'danger' ? 'alert' : 'status')">
    <span class="q-alert__icon"><QIcon :name="icon || TONE_ICON[t]" :size="20" /></span>
    <div class="q-alert__body">
      <p v-if="title || $slots.title" class="q-alert__title"><slot name="title">{{ title }}</slot></p>
      <div v-if="$slots.default" class="q-alert__text"><slot /></div>
      <div v-if="$slots.actions || actions?.length" class="q-alert__actions">
        <slot name="actions">
          <QButton
            v-for="(a, i) in actions"
            :key="i"
            size="sm"
            :variant="a.variant || (i === 0 ? 'secondary' : 'ghost')"
            v-bind="defined({ icon: a.icon, href: a.href })"
            @click="a.onClick?.($event)"
          >{{ a.label }}</QButton>
        </slot>
      </div>
    </div>
    <button v-if="dismissible || onDismiss" type="button" class="q-alert__close" :aria-label="dismissLabel || tr('بستن پیام', 'Dismiss message')" @click="dismiss">
      <QIcon name="x" :size="16" />
    </button>
  </div>
</template>
