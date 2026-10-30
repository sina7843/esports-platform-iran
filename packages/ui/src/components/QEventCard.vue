<script setup lang="ts">
import { computed } from 'vue';
import { tr } from '../locale';
import { EVENT_STATUS, capacityText, feeText, presenceText, statusBadge, type EventCardPresence, type EventCardStatus } from '../maps/competition';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

/** Event teaser for grids (layout="card") and lists (layout="list"); the whole card is one link. @click and class fall through to the <a>. */
export interface QEventCardProps {
  href?: (string) | undefined;
  title: string;
  /** Latin game name; outlined caps on the stripe placeholder when there is no cover. */
  game?: (string) | undefined;
  cover?: (string) | undefined;
  status: EventCardStatus;
  statusLabel?: (string) | undefined;
  /** Pre-formatted Jalali date, e.g. «۱۲ آذر ۱۴۰۵». */
  date?: (string) | undefined;
  mode?: (EventCardPresence | (string & {})) | undefined;
  city?: (string) | undefined;
  capacity?: ({ filled: number; total: number; unit?: string; text?: string }) | undefined;
  /** Entry fee in rial; 0 / undefined = «رایگان». */
  feeRial?: (number) | undefined;
  featured?: (boolean) | undefined;
  layout?: ('card' | 'list') | undefined;
}
const p = withDefaults(defineProps<QEventCardProps>(), { href: '#', layout: 'card' });

const badge = computed(() => statusBadge(EVENT_STATUS, p.status, p.statusLabel));
const pct = computed(() => (p.capacity?.total ? Math.min(100, Math.round((p.capacity.filled / p.capacity.total) * 100)) : 0));
</script>

<template>
  <QLink
    :href="href"
    :class="['q-event-card', layout === 'list' ? 'q-event-card--list' : 'q-event-card--card', { 'q-event-card--featured': featured, 'q-event-card--cancelled': status === 'cancelled' }]"
  >
    <span class="q-event-card__cover">
      <img v-if="cover" class="q-event-card__img" :src="cover" alt="" />
      <span v-else class="q-event-card__ph q-stripes" aria-hidden="true"><span class="q-event-card__game" dir="ltr">{{ game ?? '' }}</span></span>
      <span class="q-event-card__tags">
        <QBadge v-bind="badge.props">{{ badge.label }}</QBadge>
        <span v-if="featured" class="q-event-card__featured">{{ tr('رویداد ویژه', 'Featured event') }}</span>
      </span>
    </span>
    <span class="q-event-card__body">
      <span class="q-event-card__title h4">{{ title }}</span>
      <span class="q-event-card__meta caption">
        <span v-if="date" class="q-event-card__fact"><QIcon name="calendar" :size="16" />{{ date }}</span>
        <span v-if="mode" class="q-event-card__fact"><QIcon :name="mode === 'online' ? 'globe' : 'map-pin'" :size="16" />{{ presenceText(mode, city) }}</span>
        <span v-if="game && cover" class="q-event-card__fact q-ltr">{{ game }}</span>
      </span>
      <span class="q-event-card__foot">
        <span v-if="capacity" class="q-event-card__cap">
          <span class="q-event-card__cap-row micro"><span>{{ tr('ظرفیت', 'Capacity') }}</span><span class="q-num">{{ capacityText(capacity) }}</span></span>
          <span class="q-event-card__meter" aria-hidden="true"><span :style="{ inlineSize: pct + '%' }" /></span>
        </span>
        <span class="q-event-card__fee">
          <span class="micro q-event-card__fee-label">{{ tr('ورودی', 'Entry fee') }}</span>
          <span :class="['label', { 'q-event-card__free': !feeRial }]">{{ feeText(feeRial) }}</span>
        </span>
      </span>
    </span>
  </QLink>
</template>
