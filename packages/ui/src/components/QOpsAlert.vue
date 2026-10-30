<script setup lang="ts">
import { computed, getCurrentInstance, ref, useId } from 'vue';
import { tr } from '../locale';
import type { IconName } from '../icons';
import { SEV, tx, type Severity } from '../maps/broadcast';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

/**
 * Operations alert: severity word + icon, title, affected match/station, time, «تأیید دریافت» and «اقدام» actions.
 * `acknowledged` is controlled when given (also v-model:acknowledged); omit it to let the component track it. title/detail also have slots.
 */
export interface QOpsAlertProps {
  severity?: Severity;
  severityLabel?: string;
  title?: string;
  detail?: string;
  /** Affected match / station, e.g. «سیمرغ — پارس · ایستگاه ۴». */
  target?: string;
  /** Icon name for the target (default 'monitor'). */
  targetIcon?: IconName;
  time?: string;
  /** Controlled acknowledged state; omit to let the component track it. */
  acknowledged?: boolean | undefined;
  ackLabel?: string;
  acknowledgedLabel?: string;
  /** Default «اقدام» (green secondary action). */
  actionLabel?: string;
  actionHref?: string;
}
const p = withDefaults(defineProps<QOpsAlertProps>(), { severity: 'warning', targetIcon: 'monitor', acknowledged: undefined });
const emit = defineEmits<{ acknowledge: []; action: []; 'update:acknowledged': [value: boolean] }>();
const slots = defineSlots<{ title?: () => unknown; detail?: () => unknown }>();
const inst = getCurrentInstance();
const titleId = useId();

const sev = computed(() => SEV[p.severity] ?? SEV.warning);
const showAction = computed(() => !!(inst?.vnode.props?.onAction || p.actionHref || p.actionLabel));
const own = ref(false);
const acked = computed(() => p.acknowledged ?? own.value);
function ack() {
  if (p.acknowledged == null) own.value = true;
  emit('update:acknowledged', true);
  emit('acknowledge');
}
</script>

<template>
  <article :class="['q-ops-alert', `q-ops-alert--${severity}`, { 'q-ops-alert--acked': acked }]" :aria-labelledby="titleId">
    <span class="q-ops-alert__icon q-chamfer-sm" aria-hidden="true"><QIcon :name="acked ? 'check' : sev.icon" :size="20" /></span>
    <div class="q-ops-alert__body">
      <div class="q-ops-alert__top">
        <QBadge :tone="acked ? 'neutral' : sev.tone">{{ severityLabel || tx(sev.word) }}</QBadge>
        <h3 :id="titleId" class="q-ops-alert__title"><slot name="title">{{ title }}</slot></h3>
      </div>
      <p v-if="detail || slots.detail" class="q-ops-alert__detail"><slot name="detail">{{ detail }}</slot></p>
      <p class="q-ops-alert__meta">
        <span v-if="target" class="q-ops-alert__fact"><QIcon :name="targetIcon" :size="14" /><bdi>{{ target }}</bdi></span>
        <span v-if="time" class="q-ops-alert__fact"><QIcon name="clock" :size="14" /><time>{{ time }}</time></span>
        <span v-if="acked" class="q-ops-alert__fact q-ops-alert__fact--ok"><QIcon name="check-circle" :size="14" />{{ acknowledgedLabel || tr('دریافت شد', 'Acknowledged') }}</span>
      </p>
    </div>
    <div class="q-ops-alert__actions">
      <QButton v-if="!acked" variant="secondary" size="md" icon="check" @click="ack">{{ ackLabel || tr('تأیید دریافت', 'Acknowledge') }}</QButton>
      <QButton v-if="showAction" variant="green" size="md" v-bind="actionHref ? { href: actionHref } : {}" @click="emit('action')">{{ actionLabel || tr('اقدام', 'Take action') }}</QButton>
    </div>
  </article>
</template>
