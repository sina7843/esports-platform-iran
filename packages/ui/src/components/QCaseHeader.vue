<script setup lang="ts">
import { computed, useId } from 'vue';
import { fa, tr } from '../locale';
import { DISPUTE_STEPS, crest, firstChar, fmtDate, remaining, tx } from '../maps/people';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

export interface QCaseHeaderParty { name: string; initial?: string; logoSrc?: string; role?: string }
/** Dispute case header: LTR case ID, 7-step progress (current green), parties, deadline countdown, referee. Slot: actions. */
export interface QCaseHeaderProps {
  caseId: string;
  title: string;
  state: 'filed' | 'assigned' | 'defense_received' | 'under_review' | 'first_decision' | 'appeal' | 'closed';
  category?: string;
  eyebrow?: string;
  parties?: QCaseHeaderParty[];
  /** Countdown turns warning under 24h, danger when passed. */
  deadline?: { label?: string; at: string };
  /** Reference "now" (ISO) for deterministic rendering. Default Date.now(). */
  now?: string;
  referee?: string;
  match?: string;
  matchHref?: string;
  actions?: string;
}
const p = defineProps<QCaseHeaderProps>();
const hid = useId();
const idx = computed(() => Math.max(0, DISPUTE_STEPS.findIndex((s) => s[0] === p.state)));
const closed = computed(() => p.state === 'closed');
const left = computed(() => {
  if (!p.deadline) return null;
  // ponytail: Date.now() is read at render, no ticking timer (same as the DS); pass `now` or re-render to refresh.
  const now = p.now ? new Date(p.now).getTime() : Date.now();
  return new Date(p.deadline.at).getTime() - now;
});
const dlTone = computed(() => (left.value == null ? null : left.value <= 0 ? 'over' : left.value < 864e5 ? 'soon' : 'ok'));
const pc = crest('q-case-header__crest', 40, true);
</script>

<template>
  <section class="q-case-header" :aria-labelledby="hid">
    <div class="q-case-header__top">
      <span class="q-case-header__eyebrow"><QIcon name="gavel" :size="16" />{{ eyebrow || tr('پرونده اعتراض', 'Dispute case') }}</span>
      <span class="q-case-header__id q-ltr">{{ caseId }}</span>
      <QBadge v-if="category" tone="neutral">{{ category }}</QBadge>
      <QBadge :tone="closed ? 'neutral' : 'green'" :dot="!closed">{{ tx(DISPUTE_STEPS[idx]?.[1]) }}</QBadge>
    </div>
    <h2 :id="hid" class="q-case-header__title"><bdi>{{ title }}</bdi></h2>
    <div v-if="parties?.length" class="q-case-header__parties" role="group" :aria-label="tr('طرفین', 'Parties')">
      <template v-for="(t, i) in parties" :key="i">
        <span v-if="i === 1" class="q-case-header__vs">{{ tr('در برابر', 'vs') }}</span>
        <span class="q-case-header__party">
          <span :class="pc.class" :style="pc.style" aria-hidden="true"><img v-if="t.logoSrc" :src="t.logoSrc" alt="" /><template v-else>{{ t.initial || firstChar(t.name) }}</template></span>
          <span class="q-case-header__party-txt"><strong><bdi>{{ t.name }}</bdi></strong><small>{{ t.role || (i === 0 ? tr('معترض', 'Claimant') : tr('طرف مقابل', 'Respondent')) }}</small></span>
        </span>
      </template>
    </div>
    <ol class="q-case-header__steps" :aria-label="tr('مراحل رسیدگی', 'Case progress')">
      <li
        v-for="(s, i) in DISPUTE_STEPS" :key="s[0]"
        :class="['q-case-header__step', { 'q-case-header__step--done': i < idx || closed, 'q-case-header__step--current': i === idx && !closed }]"
        :aria-current="i === idx && !closed ? 'step' : undefined"
      >
        <span class="q-case-header__marker" aria-hidden="true">
          <QIcon v-if="i < idx || closed" name="check" :size="14" :stroke-width="3" /><template v-else>{{ fa(i + 1) }}</template>
        </span>
        <span class="q-case-header__step-label">{{ tx(s[1]) }}<span v-if="i < idx || closed" class="q-sr">{{ tr(' (انجام‌شده)', ' (done)') }}</span><span v-else-if="i === idx" class="q-sr">{{ tr(' (مرحلهٔ فعلی)', ' (current step)') }}</span></span>
      </li>
    </ol>
    <div class="q-case-header__foot">
      <dl class="q-case-header__meta">
        <div v-if="deadline" :class="['q-case-header__deadline', `q-case-header__deadline--${dlTone}`]">
          <dt>{{ deadline.label || tr('مهلت', 'Deadline') }}</dt>
          <dd>
            <QIcon :name="dlTone === 'ok' ? 'clock' : 'alert'" :size="16" />
            <strong>{{ dlTone === 'over' ? tr('مهلت پایان یافت', 'Deadline passed') : remaining(left ?? 0) }}</strong>
            <span class="q-case-header__abs"><time :datetime="deadline.at">{{ fmtDate(deadline.at, 'datetime') }}</time></span>
          </dd>
        </div>
        <div>
          <dt>{{ tr('رسیدگی‌کننده', 'Assignee') }}</dt>
          <dd><bdi v-if="referee">{{ referee }}</bdi><span v-else class="q-case-header__none">{{ tr('هنوز ارجاع نشده', 'Not assigned yet') }}</span></dd>
        </div>
        <div v-if="match">
          <dt>{{ tr('رویارویی', 'Match') }}</dt>
          <dd><QLink v-if="matchHref" :href="matchHref"><bdi>{{ match }}</bdi></QLink><bdi v-else>{{ match }}</bdi></dd>
        </div>
      </dl>
      <div v-if="actions || $slots.actions" class="q-case-header__actions"><slot name="actions">{{ actions }}</slot></div>
    </div>
  </section>
</template>
