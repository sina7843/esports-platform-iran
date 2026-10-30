<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import { tr } from '../locale';
import { PRIO, initialOf, nameOf, slaText, tx, type Priority } from '../maps/broadcast';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

/**
 * Support-ticket / review-queue row: subject, requester, category, assignee initial, SLA (green > 4h, warning < 4h, danger
 * overdue), priority, internal-note mark. Renders a link with href, a button when @click is bound (native fallthrough), else a div.
 */
export interface QQueueItemProps {
  subject: string;
  requester?: (string) | undefined;
  category?: (string) | undefined;
  state?: (string) | undefined;
  stateTone?: ('neutral' | 'success' | 'warning' | 'danger' | 'info') | undefined;
  /** false hides the priority badge. Default 'normal'. */
  priority?: (Priority | false) | undefined;
  priorityLabel?: (string) | undefined;
  /** Minutes to the SLA deadline; negative = overdue. */
  slaMinutes?: (number) | undefined;
  slaLabel?: (string) | undefined;
  /** null = «بدون مسئول» placeholder; false hides the assignee cell. */
  assignee?: ({ name: string; initial?: string } | null | false) | undefined;
  assigneeLabel?: (string) | undefined;
  unassignedLabel?: (string) | undefined;
  internalNote?: (boolean) | undefined;
  noteLabel?: (string) | undefined;
  /** Mono reference, e.g. 'tkt_3c91'. */
  reference?: (string) | undefined;
  selected?: (boolean) | undefined;
  href?: (string) | undefined;
}
// eslint-disable-next-line vue/require-valid-default-prop -- priority is Priority | false; the default is the string 'normal'
const p = withDefaults(defineProps<QQueueItemProps>(), { priority: 'normal', assignee: null, stateTone: 'neutral' });
const attrs = useAttrs();

const tone = computed(() => (p.slaMinutes == null ? null : p.slaMinutes < 0 ? 'danger' : p.slaMinutes < 240 ? 'warning' : 'ok'));
const pr = computed(() => (p.priority ? PRIO[p.priority] : undefined) ?? PRIO.normal);
const tag = computed(() => (p.href ? QLink : attrs.onClick ? 'button' : 'div'));
const rootAttrs = computed(() => (p.href ? { href: p.href } : attrs.onClick ? { type: 'button' } : {}));
const note = computed(() => p.noteLabel || tr('یادداشت داخلی', 'Internal note'));
const none = computed(() => p.unassignedLabel || tr('بدون مسئول', 'Unassigned'));
const who = computed(() => (p.assignee ? p.assignee : null));
</script>

<template>
  <component
    :is="tag"
    v-bind="rootAttrs"
    :class="['q-queue-item', { 'q-queue-item--overdue': tone === 'danger', 'q-queue-item--interactive': !!(href || attrs.onClick), 'q-queue-item--selected': selected }]"
    :aria-current="selected ? 'true' : undefined"
  >
    <span class="q-queue-item__main">
      <span class="q-queue-item__subject">
        <bdi>{{ subject }}</bdi>
        <span v-if="internalNote" class="q-queue-item__note" :title="note"><QIcon name="message" :size="14" /><span>{{ note }}</span></span>
      </span>
      <span class="q-queue-item__meta">
        <span v-if="requester"><QIcon name="user" :size="14" /><bdi>{{ requester }}</bdi></span>
        <span v-if="category">{{ category }}</span>
        <span v-if="reference" class="q-queue-item__ref q-ltr">{{ reference }}</span>
      </span>
    </span>
    <span v-if="state" class="q-queue-item__state"><QBadge :tone="stateTone">{{ state }}</QBadge></span>
    <span v-if="slaMinutes != null" :class="['q-queue-item__sla', `q-queue-item__sla--${tone}`]">
      <QIcon :name="tone === 'danger' ? 'alert' : 'clock'" :size="14" />
      <span>{{ slaLabel || slaText(slaMinutes) }}</span>
    </span>
    <span v-if="priority !== false" class="q-queue-item__prio"><QBadge :tone="pr[0]">{{ priorityLabel || tx(pr[1]) }}</QBadge></span>
    <span v-if="assignee !== false" :class="['q-queue-item__avatar', { 'q-queue-item__avatar--empty': !who }]" :title="who ? nameOf(who) : none">
      <span v-if="who" aria-hidden="true">{{ initialOf(who) }}</span>
      <QIcon v-else name="user" :size="14" />
      <span class="q-sr">{{ `${assigneeLabel || tr('مسئول', 'Assignee')}: ${who ? nameOf(who) : none}` }}</span>
    </span>
  </component>
</template>
