<script setup lang="ts">
import { computed, useId } from 'vue';
import { fa, tr } from '../locale';
import { fmtDate } from '../maps/people';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

/** News item: featured (16:9 cover, h2) or compact row; category, Jalali meta, corrected / retracted states, low-data mode. */
export interface QNewsCardProps {
  variant?: 'featured' | 'compact';
  title: string;
  excerpt?: string;
  category?: string;
  format?: string;
  coverSrc?: string;
  coverAlt?: string;
  coverText?: string;
  publishedAt?: string;
  author?: string;
  readMinutes?: number;
  state?: 'published' | 'corrected' | 'retracted';
  correctionNote?: string;
  retractionReason?: string;
  lowData?: boolean;
  href?: string;
  headingLevel?: 2 | 3 | 4;
}
const p = withDefaults(defineProps<QNewsCardProps>(), { variant: 'compact', state: 'published' });
const hid = useId();
const retracted = computed(() => p.state === 'retracted');
// The DS also renders the undocumented variants 'text' (no image) and 'compact-min' (no excerpt); kept for parity.
const v = computed<string>(() => p.variant);
const showImg = computed(() => !p.lowData && !retracted.value && v.value !== 'text');
const ht = computed(() => (p.headingLevel ? `h${p.headingLevel}` : p.variant === 'featured' ? 'h2' : 'h3'));
</script>

<template>
  <article :class="['q-news-card', `q-news-card--${variant}`, { 'q-news-card--retracted': retracted, 'q-news-card--lowdata': lowData }]" :aria-labelledby="hid">
    <div v-if="showImg" :class="['q-news-card__cover', { 'q-stripes': !coverSrc }]">
      <img v-if="coverSrc" :src="coverSrc" :alt="coverAlt || ''" />
      <span v-else class="q-news-card__latin" aria-hidden="true">{{ coverText || '' }}</span>
    </div>
    <div class="q-news-card__body">
      <div class="q-news-card__tags">
        <QBadge v-if="category" tone="neutral">{{ category }}</QBadge>
        <span v-if="format" class="q-news-card__format">{{ format }}</span>
        <QBadge v-if="state === 'corrected'" tone="warning" icon="edit">{{ tr('اصلاحیه', 'Corrected') }}</QBadge>
        <QBadge v-if="retracted" tone="danger" icon="x-circle">{{ tr('بازپس‌گرفته', 'Retracted') }}</QBadge>
      </div>
      <component :is="ht" :id="hid" class="q-news-card__title">
        <s v-if="retracted"><bdi>{{ title }}</bdi></s>
        <QLink v-else-if="href" :href="href" class="q-news-card__link"><bdi>{{ title }}</bdi></QLink>
        <bdi v-else>{{ title }}</bdi>
        <span v-if="retracted" class="q-sr">{{ tr(' (بازپس‌گرفته)', ' (retracted)') }}</span>
      </component>
      <p v-if="retracted" class="q-news-card__notice q-news-card__notice--danger" role="note">
        {{ tr('این خبر پس گرفته شد', 'This post was withdrawn') }}<template v-if="retractionReason">: <bdi>{{ retractionReason }}</bdi></template><template v-else>.</template>
      </p>
      <p v-else-if="state === 'corrected' && correctionNote" class="q-news-card__notice q-news-card__notice--warning" role="note"><bdi>{{ correctionNote }}</bdi></p>
      <p v-if="!retracted && excerpt && v !== 'compact-min'" class="q-news-card__excerpt"><bdi>{{ excerpt }}</bdi></p>
      <p class="q-news-card__meta">
        <time v-if="publishedAt" :datetime="publishedAt">{{ fmtDate(publishedAt, variant === 'featured' ? 'datetime' : 'date') }}</time>
        <span v-if="author">{{ tr('نوشته ', 'By ') }}<bdi>{{ author }}</bdi></span>
        <span v-if="readMinutes">{{ tr(fa(readMinutes) + ' دقیقه مطالعه', fa(readMinutes) + ' min read') }}</span>
        <span v-if="lowData && (coverSrc || coverText)" class="q-news-card__lowdata"><QIcon name="image" :size="14" />{{ tr('تصویر در حالت کم‌مصرف بارگذاری نشد', 'Image not loaded in low-data mode') }}</span>
      </p>
    </div>
  </article>
</template>
