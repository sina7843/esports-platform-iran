<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { tr } from '../locale';
import { EVENT_STATUS, countdownAria, feeText, pad2, presenceText, splitCountdown, statusBadge, type Countdown, type EventCardPresence, type EventCardStatus } from '../maps/competition';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QTricolor from './QTricolor.vue';

export interface QEventHeaderFact { label: string; value: string; /** Isolate as LTR (time zone, IDs). */ ltr?: boolean }
export interface QEventHeaderRegistration {
  /** Label before the countdown, default «پایان ثبت‌نام تا». */
  label?: string;
  /** Static countdown. */
  countdown?: Countdown;
  /** ISO deadline; the countdown refreshes every 30 s (ignored when countdown is given). */
  deadline?: string;
  /** e.g. «۱۱ از ۱۶ تیم». */
  capacity?: string;
  /** Rial number (0 = «رایگان») or a ready string. */
  fee?: number | string;
  /** CTA text, default «ثبت‌نام تیم». */
  cta?: string;
  href?: string;
  /** Same as listening to @register. */
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
}
/** Event-detail hero: chamfered panel with cover band, title, status, verified organiser, facts and the registration box. */
export interface QEventHeaderProps {
  /** Used to label the section with the title. */
  id?: string;
  title: string;
  game?: string;
  cover?: string;
  status: EventCardStatus;
  statusLabel?: string;
  featured?: boolean;
  verified?: boolean;
  organizer?: string;
  badges?: string[];
  eyebrow?: string;
  startsAt?: string;
  endsAt?: string;
  timeZone?: string;
  presence?: EventCardPresence;
  city?: string;
  /** Replaces the default facts (start, end, time zone, presence). */
  facts?: QEventHeaderFact[];
  /** null hides the registration box. */
  registration?: QEventHeaderRegistration | null;
  /** null hides the note; default is the reg.badgeNote copy. */
  note?: string | null;
}
const p = defineProps<QEventHeaderProps>();
const emit = defineEmits<{ register: [e: MouseEvent] }>();

const reg = computed<QEventHeaderRegistration>(() => p.registration ?? {});
const now = ref(Date.now());
watchEffect((onCleanup) => {
  if (!reg.value.deadline || reg.value.countdown) return;
  const id = setInterval(() => { now.value = Date.now(); }, 30000);
  onCleanup(() => clearInterval(id));
});
const cd = computed(() => splitCountdown(reg.value, now.value));
const factList = computed<QEventHeaderFact[]>(() => p.facts ?? [
  p.startsAt ? { label: tr('شروع', 'Starts'), value: p.startsAt } : null,
  p.endsAt ? { label: tr('پایان', 'Ends'), value: p.endsAt } : null,
  p.timeZone ? { label: tr('منطقه زمانی رویداد', 'Event time zone'), value: p.timeZone, ltr: true } : null,
  p.presence ? { label: tr('نوع برگزاری', 'Format'), value: presenceText(p.presence, p.city) } : null,
].filter((f): f is QEventHeaderFact => !!f));
const cells = computed<[number, string][]>(() => (cd.value ? [[cd.value.days, tr('روز', 'Days')], [cd.value.hours, tr('ساعت', 'Hours')], [cd.value.minutes, tr('دقیقه', 'Minutes')]] : []));
const badge = computed(() => statusBadge(EVENT_STATUS, p.status, p.statusLabel));
const titleId = computed(() => (p.id ? `${p.id}-t` : undefined));
const ctaAttrs = computed(() => ({ ...(reg.value.href ? { href: reg.value.href } : {}), ...(reg.value.disabled ? { disabled: true } : {}) }));
function onCta(e: MouseEvent) {
  reg.value.onClick?.(e);
  emit('register', e);
}
</script>

<template>
  <section class="q-event-header" :aria-labelledby="titleId">
    <div class="q-event-header__panel q-chamfer-xl">
      <div class="q-event-header__cover">
        <img v-if="cover" :src="cover" alt="" />
        <span v-else class="q-event-header__ph q-stripes" aria-hidden="true"><span class="q-event-header__game" dir="ltr">{{ game ?? '' }}</span></span>
        <span class="q-event-header__tags">
          <QBadge v-bind="badge.props">{{ badge.label }}</QBadge>
          <span v-if="featured" class="q-event-header__featured">{{ tr('رویداد ویژه', 'Featured event') }}</span>
        </span>
      </div>
      <div class="q-event-header__body">
        <div class="q-event-header__head">
          <span v-if="eyebrow" class="q-event-header__eyebrow label"><QTricolor />{{ eyebrow }}</span>
          <h1 :id="titleId" class="q-event-header__title display-lg">{{ title }}</h1>
          <div class="q-event-header__badges">
            <span v-if="verified" class="q-event-header__verified label"><QIcon name="check" :size="16" :stroke-width="2.6" />{{ tr('برگزارکنندهٔ تأییدشده', 'Verified organizer') }}</span>
            <span v-if="organizer" class="q-event-header__org body-sm">{{ organizer }}</span>
            <QBadge v-for="(b, i) in badges ?? []" :key="i" tone="neutral">{{ b }}</QBadge>
          </div>
        </div>
        <dl v-if="factList.length" class="q-event-header__facts">
          <div v-for="(f, i) in factList" :key="i" class="q-event-header__fact">
            <dt class="micro">{{ f.label }}</dt>
            <dd class="label"><bdi v-if="f.ltr" class="q-ltr">{{ f.value }}</bdi><template v-else>{{ f.value }}</template></dd>
          </div>
        </dl>
        <div v-if="registration !== null" class="q-event-header__reg">
          <div class="q-event-header__reg-info">
            <span class="caption q-event-header__reg-label">{{ reg.label || tr('پایان ثبت‌نام تا', 'Registration closes in') }}</span>
            <div v-if="cd && cells.length" class="q-event-header__cd" role="timer" :aria-label="countdownAria(cd)">
              <span v-for="(c, i) in cells" :key="i" class="q-event-header__cd-cell" aria-hidden="true"><strong class="numeral">{{ pad2(c[0]) }}</strong><small>{{ c[1] }}</small></span>
            </div>
            <span v-if="reg.capacity || reg.fee != null" class="q-event-header__reg-meta caption">
              <span v-if="reg.capacity">{{ tr('ظرفیت: ', 'Capacity: ') }}<b>{{ reg.capacity }}</b></span>
              <span v-if="reg.fee != null">{{ tr('ورودی: ', 'Entry fee: ') }}<b>{{ typeof reg.fee === 'number' ? feeText(reg.fee) : reg.fee }}</b></span>
            </span>
          </div>
          <QButton variant="primary" size="lg" chamfer v-bind="ctaAttrs" class="q-event-header__cta" @click="onCta">{{ reg.cta || tr('ثبت‌نام تیم', 'Register team') }}</QButton>
        </div>
        <p v-if="note !== null" class="q-event-header__note caption">
          <QIcon name="info" :size="16" />{{ note || tr('هر نشان جداگانه و بر پایهٔ مدرک بررسی شده است و هیچ‌کدام تضمین جایزه نیست.', 'Each badge is reviewed separately on evidence; none is a prize guarantee.') }}
        </p>
      </div>
    </div>
  </section>
</template>
