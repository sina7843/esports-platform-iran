<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { dec, fa, tr } from '../locale';
import { ORG_DISCLAIMER, STAR, cnt, crest, firstChar, tx } from '../maps/people';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';
import QVerifiedMark from './QVerifiedMark.vue';

/**
 * Organizer summary: logo, name, verified mark with its disclaimer tooltip (click toggles, hover/focus opens via CSS,
 * Escape closes), participant rating, events count, link. `rating` takes { average, count } or a bare average number
 * (count from `ratingCount`); null or a null average → «هنوز امتیازی ثبت نشده است.».
 */
export interface QOrganizerCardProps {
  name: string;
  initial?: (string) | undefined;
  logoSrc?: (string) | undefined;
  city?: (string) | undefined;
  verified?: (boolean) | undefined;
  verifiedLabel?: (string) | undefined;
  disclaimer?: (string) | undefined;
  defaultDisclaimerOpen?: (boolean) | undefined;
  rating?: ({ average: number | null; count?: number } | number | null) | undefined;
  ratingCount?: (number) | undefined;
  events?: (number) | undefined;
  level?: (string) | undefined;
  href?: (string) | undefined;
  linkLabel?: (string) | undefined;
}
const p = defineProps<QOrganizerCardProps>();
const tipId = useId();
const tip = ref(!!p.defaultDisclaimerOpen);
const c = crest('q-organizer-card__logo', 56, true);
const r = computed(() => (typeof p.rating === 'number' ? { average: p.rating, count: p.ratingCount } : p.rating ?? null));
const avg = computed(() => (r.value && r.value.average != null && Number.isFinite(Number(r.value.average)) ? Number(r.value.average) : null));
const fill = computed(() => `${Math.max(0, Math.min(100, ((avg.value ?? 0) / 5) * 100))}%`);
</script>

<template>
  <article class="q-organizer-card">
    <div class="q-organizer-card__head">
      <span :class="c.class" :style="c.style" aria-hidden="true"><img v-if="logoSrc" :src="logoSrc" alt="" /><template v-else>{{ initial || firstChar(name) }}</template></span>
      <div class="q-organizer-card__id">
        <h3 class="q-organizer-card__name"><QLink v-if="href" :href="href" class="q-organizer-card__link"><bdi>{{ name }}</bdi></QLink><bdi v-else>{{ name }}</bdi></h3>
        <span v-if="city" class="q-organizer-card__city"><QIcon name="map-pin" :size="14" />{{ city }}</span>
      </div>
    </div>
    <div v-if="verified" class="q-organizer-card__verify" @keydown.esc="tip = false">
      <QVerifiedMark :text="verifiedLabel || tr('برگزارکنندهٔ تأییدشده', 'Verified organizer')" :size="18" />
      <button
        type="button" class="q-organizer-card__info" :aria-label="tr('دربارهٔ نشان تأیید', 'About the verification badge')"
        :aria-describedby="tipId" :aria-expanded="tip ? 'true' : 'false'" @click="tip = !tip"
      >
        <QIcon name="info" :size="16" />
      </button>
      <span :id="tipId" role="tooltip" :class="['q-organizer-card__tip', { 'q-organizer-card__tip--open': tip }]">{{ disclaimer || tx(ORG_DISCLAIMER) }}</span>
    </div>
    <dl class="q-organizer-card__facts">
      <div class="q-organizer-card__rating">
        <dt>{{ tr('امتیاز شرکت‌کنندگان', 'Participant rating') }}</dt>
        <dd v-if="avg != null">
          <span class="q-organizer-card__stars" aria-hidden="true">
            <span class="q-organizer-card__stars-base">
              <svg v-for="i in 5" :key="i" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path :d="STAR" /></svg>
            </span>
            <span class="q-organizer-card__stars-fill" :style="{ width: fill }">
              <span class="q-organizer-card__stars-row">
                <svg v-for="i in 5" :key="i" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path :d="STAR" /></svg>
              </span>
            </span>
          </span>
          <span class="q-organizer-card__score">{{ tr(dec(avg, 1) + ' از ' + fa(5), dec(avg, 1) + ' out of 5') }}</span>
          <span v-if="r?.count != null" class="q-organizer-card__count">({{ cnt(r.count, 'رأی', 'vote') }})</span>
        </dd>
        <dd v-else class="q-organizer-card__none">{{ tr('هنوز امتیازی ثبت نشده است.', 'No ratings yet.') }}</dd>
      </div>
      <div v-if="events != null"><dt>{{ tr('رویدادها', 'Events') }}</dt><dd>{{ cnt(events, 'رویداد', 'event') }}</dd></div>
      <div v-if="level"><dt>{{ tr('سطح اعتبار', 'Trust level') }}</dt><dd><span class="q-organizer-card__level q-ltr">{{ level }}</span></dd></div>
    </dl>
    <QButton v-if="href" variant="secondary" :href="href" icon-end="arrow-right" flip-icon block>{{ linkLabel || tr('صفحهٔ برگزارکننده', 'Organizer page') }}</QButton>
  </article>
</template>
