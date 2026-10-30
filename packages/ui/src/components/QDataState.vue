<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { tr } from '../locale';
import type { IconName } from '../icons';
import { emptyTitle as defaultEmptyTitle, px } from '../maps/display';
import QButton from './QButton.vue';
import QCode from './QCode.vue';
import QEmptyState from './QEmptyState.vue';
import QSkeleton from './QSkeleton.vue';

export type QDataStateKind = 'loading' | 'empty' | 'error' | 'forbidden' | 'offline' | 'later' | 'content';
/**
 * The product's data states in one place: loading | empty | error | forbidden | offline | later; renders the default slot
 * for content. Without `state` the booleans decide: offline > forbidden > error > loading > empty > content.
 * skeleton: 'cards' (default) | 'rows' | #skeleton slot. Retry («تلاش دوباره») shows on error/offline when @retry is bound.
 * message / detail / emptyTitle / emptyBody / emptyAction: prop or same-named slot.
 */
export interface QDataStateProps {
  state?: QDataStateKind;
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  forbidden?: boolean;
  offline?: boolean;
  message?: string;
  detail?: string;
  requestId?: string;
  requestIdLabel?: string;
  retryLabel?: string;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: string;
  skeleton?: 'cards' | 'rows';
  minHeight?: number | string;
  icon?: IconName;
  /** Listener presence (@retry) shows the retry button, as in the DS. */
  onRetry?: (e: MouseEvent) => void;
}
const p = withDefaults(defineProps<QDataStateProps>(), { skeleton: 'cards' });
const emit = defineEmits<{ retry: [e: MouseEvent] }>();
const slots = useSlots();

const s = computed<QDataStateKind>(() => p.state
  || (p.offline ? 'offline' : p.forbidden ? 'forbidden' : p.error ? 'error' : p.loading ? 'loading' : p.empty ? 'empty' : 'content'));
const minH = computed(() => px(p.minHeight || (s.value === 'loading' ? 384 : undefined)));
const cls = computed(() => ['q-data-state', `q-data-state--${s.value}`]);

interface Conf { icon?: IconName; tone?: 'neutral' | 'danger' | 'warning' | 'info'; title?: string; body?: string; role?: string; variant?: 'later' }
const conf = computed<Conf>(() => {
  switch (s.value) {
    case 'empty': return { icon: 'inbox', tone: 'neutral', title: defaultEmptyTitle() };
    case 'error': return { icon: 'alert', tone: 'danger', title: tr('خطا در دریافت اطلاعات.', 'Could not load the data.'), role: 'alert' };
    case 'forbidden': return { icon: 'lock', tone: 'warning', title: tr('دسترسی ندارید', 'No access'), body: tr('شما به این بخش دسترسی ندارید.', 'You do not have access to this area.'), role: 'alert' };
    case 'offline': return { icon: 'wifi-off', tone: 'info', title: tr('اتصال اینترنت برقرار نیست.', 'You are offline.'), body: tr('پس از برقراری اتصال دوباره تلاش کنید.', 'Try again once you are back online.'), role: 'alert' };
    case 'later': return { variant: 'later' };
    default: return { icon: 'inbox', tone: 'neutral' };
  }
});
const isEmpty = computed(() => s.value === 'empty');
const title = computed(() => p.message || (isEmpty.value && p.emptyTitle) || conf.value.title);
const customTitle = computed(() => !!slots.message || (isEmpty.value && !!slots.emptyTitle));
const hasDetail = computed(() => !!(slots.detail || p.detail || conf.value.body));
const showRid = computed(() => s.value === 'error' && !!p.requestId);
const ridLabel = computed(() => tr('شناسه درخواست', 'Request ID'));
const retry = computed(() => (s.value === 'error' || s.value === 'offline') && !!p.onRetry);
const emptyAct = computed(() => isEmpty.value && !!(slots.emptyAction || p.emptyAction));
</script>

<template>
  <slot v-if="s === 'content'" />
  <div v-else-if="s === 'loading'" :class="cls" role="status" aria-busy="true" :style="{ minBlockSize: minH }">
    <span class="q-sr"><slot name="message">{{ message || tr('در حال بارگذاری…', 'Loading…') }}</slot></span>
    <slot name="skeleton">
      <div v-if="skeleton === 'rows'" class="q-data-state__rows"><QSkeleton v-for="i in 4" :key="i" variant="table-row" /></div>
      <div v-else class="q-data-state__cards"><QSkeleton v-for="i in 3" :key="i" variant="card" /></div>
    </slot>
  </div>
  <QEmptyState
    v-else
    :class="cls"
    :variant="conf.variant"
    :icon="icon || conf.icon"
    :tone="conf.tone"
    :role="conf.role"
    :style="minH ? { minBlockSize: minH } : undefined"
    :title="title || undefined"
    :body="isEmpty && emptyBody ? emptyBody : undefined"
  >
    <template v-if="customTitle" #title>
      <slot v-if="$slots.message" name="message" />
      <slot v-else name="emptyTitle" />
    </template>
    <template v-if="isEmpty && $slots.emptyBody" #body><slot name="emptyBody" /></template>
    <template v-if="hasDetail || showRid" #default>
      <p v-if="hasDetail" class="q-data-state__detail"><slot name="detail">{{ detail || conf.body }}</slot></p>
      <p v-if="showRid" class="q-data-state__rid">{{ (requestIdLabel || ridLabel) + ': ' }}<QCode copy :value="requestId" :label="ridLabel" /></p>
    </template>
    <template v-if="retry || emptyAct" #action>
      <QButton v-if="retry" variant="secondary" icon="refresh" @click="emit('retry', $event)">{{ retryLabel || tr('تلاش دوباره', 'Try again') }}</QButton>
      <slot v-else name="emptyAction">{{ emptyAction }}</slot>
    </template>
  </QEmptyState>
</template>
