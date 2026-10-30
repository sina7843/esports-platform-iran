<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { fa, tr } from '../locale';
import { POST_KIND, POST_SRC, cnt, fmtDate, tx } from '../maps/people';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

export interface QLivePostScore { home: string; away: string; homeScore: number; awayScore: number; map?: string; final?: boolean }
/** Live-centre timeline post: green time, type icon, body, attached score line, pinned / newest («زنده») states. */
export interface QLivePostProps {
  kind?: 'goal' | 'result' | 'announcement' | 'media';
  time?: string;
  timeText?: string;
  source?: 'official' | 'reporter' | 'automatic';
  title?: string;
  body?: string;
  score?: QLivePostScore;
  pinned?: boolean;
  newest?: boolean;
  edited?: string;
  withdrawn?: string;
  mediaCount?: number;
  lowData?: boolean;
}
const p = defineProps<QLivePostProps>();
const hid = useId();
const k = computed(() => (p.kind && POST_KIND[p.kind]) || POST_KIND.announcement!);
const showMedia = ref(!p.lowData);
const n = computed(() => p.mediaCount || 0);
const lead = computed(() => {
  const s = p.score;
  return s ? (s.homeScore > s.awayScore ? 'home' : s.awayScore > s.homeScore ? 'away' : null) : null;
});
const scoreLabel = computed(() => (p.score
  ? tr('نتیجه: ', 'Result: ') + p.score.home + ' ' + fa(p.score.homeScore) + tr('، ', ', ') + p.score.away + ' ' + fa(p.score.awayScore)
  : ''));
</script>

<template>
  <article
    :class="['q-live-post', { 'q-live-post--pinned': pinned, 'q-live-post--newest': newest, 'q-live-post--withdrawn': withdrawn }]"
    :aria-labelledby="title ? hid : undefined"
  >
    <div class="q-live-post__rail">
      <time v-if="time" class="q-live-post__time" :datetime="time">{{ fmtDate(time, 'time') }}</time>
      <span v-else class="q-live-post__time">{{ timeText }}</span>
      <span class="q-live-post__node" aria-hidden="true"><QIcon :name="k.icon" :size="16" /></span>
    </div>
    <div class="q-live-post__card">
      <div class="q-live-post__head">
        <span class="q-live-post__kind"><QIcon :name="k.icon" :size="14" />{{ tx(k.label) }}</span>
        <span v-if="source" class="q-live-post__src">{{ tx(POST_SRC[source]) || source }}</span>
        <QBadge v-if="newest" tone="live">{{ tr('زنده', 'Live') }}</QBadge>
        <QBadge v-if="pinned" tone="neutral" icon="flag">{{ tr('سنجاق‌شده', 'Pinned') }}</QBadge>
        <span v-if="edited" class="q-live-post__src" :title="edited">{{ tr('ویرایش‌شده', 'Edited') }}</span>
      </div>
      <h3 v-if="title" :id="hid" class="q-live-post__title"><bdi>{{ title }}</bdi></h3>
      <p v-if="withdrawn" class="q-live-post__withdrawn" role="note">{{ tr('این خبر پس گرفته شد: ', 'This post was withdrawn: ') }}<bdi>{{ withdrawn }}</bdi></p>
      <p v-else-if="body" class="q-live-post__body"><bdi>{{ body }}</bdi></p>
      <div v-if="score && !withdrawn" class="q-live-post__score" role="group" :aria-label="scoreLabel">
        <span class="q-live-post__team"><bdi>{{ score.home }}</bdi></span>
        <span :class="['q-live-post__pts', { 'q-live-post__pts--lead': lead === 'home' }]">{{ fa(score.homeScore) }}</span>
        <span class="q-live-post__colon" aria-hidden="true">:</span>
        <span :class="['q-live-post__pts', { 'q-live-post__pts--lead': lead === 'away' }]">{{ fa(score.awayScore) }}</span>
        <span class="q-live-post__team"><bdi>{{ score.away }}</bdi></span>
        <span v-if="score.map" class="q-live-post__map q-ltr">{{ score.map }}</span>
        <QBadge v-if="score.final != null" :tone="score.final ? 'success' : 'warning'">{{ score.final ? tr('نتیجه رسمی', 'Official result') : tr('نتیجه موقت', 'Provisional result') }}</QBadge>
      </div>
      <template v-if="n && !withdrawn">
        <div v-if="showMedia" class="q-live-post__media">
          <span v-for="i in Math.min(n, 3)" :key="i" class="q-live-post__thumb q-stripes" role="img" :aria-label="tr('تصویر ', 'Image ') + fa(i)" />
        </div>
        <QButton v-else size="sm" variant="secondary" icon="image" class="q-live-post__show" @click="showMedia = true">
          {{ tr('نمایش ' + fa(n) + ' تصویر', 'Show ' + cnt(n, '', 'image')) }}
        </QButton>
      </template>
    </div>
  </article>
</template>
