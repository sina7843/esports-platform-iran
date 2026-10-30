<script setup lang="ts">
import { fa, formatJalali, tr } from '../locale';
import type { IconName } from '../icons';
import { TL, type TimelineTone } from '../maps/data';
import QIcon from './QIcon.vue';
import QJalaliDate from './QJalaliDate.vue';

/** Timeline: vertical audit/log list — time (green), actor, action, detail; typed icons; compact variant. */
export type QTimelineEventType = 'result' | 'referee' | 'pause' | 'resume' | 'start' | 'ready' | 'correction' | 'decision' | 'dispute' | 'message' | 'system';
export interface QTimelineItem {
  id?: string | number;
  type?: QTimelineEventType;
  /** ISO instant (rendered as Tehran time). */
  at?: string;
  /** Pre-formatted time when there is no ISO. */
  time?: string;
  actor?: string;
  action: string;
  detail?: string;
  badge?: string;
  icon?: IconName;
  tone?: TimelineTone;
}
export interface QTimelineProps {
  items: QTimelineItem[];
  compact?: (boolean) | undefined;
  /** time (default) | datetime (adds the short date under the time). */
  timeFormat?: ('time' | 'datetime') | undefined;
  emptyText?: (string) | undefined;
}
withDefaults(defineProps<QTimelineProps>(), { timeFormat: 'time' });

const meta = (it: QTimelineItem) => (it.type && TL[it.type]) || TL.system!;
</script>

<template>
  <p v-if="!items.length" class="q-timeline__none"><slot name="emptyText">{{ emptyText || tr('رویدادی ثبت نشده است.', 'No events recorded yet.') }}</slot></p>
  <ol v-else :class="['q-timeline', { 'q-timeline--compact': compact, 'q-timeline--dated': timeFormat === 'datetime' }]">
    <li v-for="(it, i) in items" :key="it.id ?? i" :class="['q-timeline__item', `q-timeline__item--${it.tone || meta(it).tone}`]">
      <span v-if="it.at" class="q-timeline__time">
        <QJalaliDate :iso="it.at" format="time" />
        <span v-if="timeFormat === 'datetime'" class="q-timeline__date">{{ formatJalali(it.at, 'dateShort') }}</span>
      </span>
      <span v-else class="q-timeline__time q-num">{{ fa(it.time || '') }}</span>
      <span class="q-timeline__rail" aria-hidden="true">
        <span class="q-timeline__node"><QIcon v-if="!compact" :name="it.icon || meta(it).icon" :size="16" /></span>
      </span>
      <div class="q-timeline__body">
        <p class="q-timeline__head">
          <template v-if="it.actor"><strong class="q-timeline__actor">{{ it.actor }}</strong>{{ ' ' }}</template>
          <span class="q-timeline__action">{{ it.action }}</span>
          <span v-if="it.badge" class="q-timeline__badge">{{ it.badge }}</span>
        </p>
        <p v-if="it.detail" class="q-timeline__detail">{{ it.detail }}</p>
      </div>
    </li>
  </ol>
</template>
