<script setup lang="ts">
import { getCurrentInstance, useSlots } from 'vue';
import { tr, type DateFormat } from '../locale';
import type { IconName } from '../icons';
import { initial } from '../maps/data';
import QIcon from './QIcon.vue';
import QJalaliDate from './QJalaliDate.vue';
import QLink from './QLink.vue';

/**
 * FeedItem: notification/message row — icon or avatar initial, title, 2-line body, time, green unread dot, actions.
 * `@click` binds to the title link/button like the DS onClick (not the row, so clicks on actions do not trigger it); with no
 * `href` a click listener turns the title into a button.
 */
export interface QFeedItemProps {
  title: string;
  body?: string;
  icon?: IconName;
  tone?: 'neutral' | 'green' | 'warning' | 'info' | 'danger' | 'live';
  avatar?: string;
  /** ISO instant; relative by default. */
  time?: string;
  timeFormat?: DateFormat;
  timeText?: string;
  now?: string | number;
  unread?: boolean;
  unreadLabel?: string;
  href?: string;
  badge?: string;
  actions?: string;
  as?: 'div' | 'li' | 'article';
  titleAs?: 'h2' | 'h3' | 'h4' | 'p';
}
withDefaults(defineProps<QFeedItemProps>(), { tone: 'neutral', icon: 'bell', timeFormat: 'relative', as: 'div', titleAs: 'h3' });
const emit = defineEmits<{ click: [e: MouseEvent] }>();
const slots = useSlots();
const inst = getCurrentInstance();
const clickable = () => !!inst?.vnode.props?.onClick;
</script>

<template>
  <component :is="as" :class="['q-feed-item', unread ? 'q-feed-item--unread' : 'q-feed-item--read', { 'q-feed-item--interactive': href || clickable() }]">
    <span v-if="avatar" class="q-feed-item__avatar" aria-hidden="true">{{ initial(avatar) }}</span>
    <span v-else :class="['q-feed-item__icon', `q-feed-item__icon--${tone}`]" aria-hidden="true"><QIcon :name="icon" :size="20" /></span>
    <div class="q-feed-item__main">
      <div class="q-feed-item__top">
        <component :is="titleAs" class="q-feed-item__title">
          <span v-if="unread" class="q-sr">{{ (unreadLabel || tr('خوانده‌نشده', 'Unread')) + ': ' }}</span>
          <QLink v-if="href" :href="href" class="q-feed-item__link" @click="emit('click', $event)"><slot name="title">{{ title }}</slot></QLink>
          <button v-else-if="clickable()" type="button" class="q-feed-item__link" @click="emit('click', $event)"><slot name="title">{{ title }}</slot></button>
          <slot v-else name="title">{{ title }}</slot>
        </component>
        <slot name="badge">{{ badge }}</slot>
        <span v-if="time || timeText || slots.timeText" class="q-feed-item__time">
          <QJalaliDate v-if="time" :iso="time" :format="timeFormat" :now="now" />
          <slot v-else name="timeText">{{ timeText }}</slot>
        </span>
      </div>
      <p v-if="body || slots.body" class="q-feed-item__body"><slot name="body">{{ body }}</slot></p>
      <div v-if="actions || slots.actions" class="q-feed-item__actions"><slot name="actions">{{ actions }}</slot></div>
    </div>
    <span class="q-feed-item__dot" aria-hidden="true" />
  </component>
</template>
