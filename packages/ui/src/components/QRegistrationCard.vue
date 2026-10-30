<script setup lang="ts">
import { computed, useId } from 'vue';
import type { IconName } from '../icons';
import { toman, tr } from '../locale';
import { REG, REG_ACTIVE, fmtDate, stateBadge, tx } from '../maps/people';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

export type QRegistrationCardState = 'draft' | 'incomplete' | 'awaiting_payment' | 'awaiting_review' | 'awaiting_capacity' | 'confirmed' | 'rejected' | 'withdrawn' | 'removed';
export interface QRegistrationCardAction { key: string; label: string; variant: 'primary' | 'green' | 'secondary' | 'ghost'; icon?: IconName }
/**
 * «ثبت‌نام‌های من» item: event, discipline, team, state with tone, next-step note and the one next action.
 * Emits action(key) (pay | confirm_roster | check_in | complete | re_review). «انصراف» shows only while a @withdraw
 * listener is bound and the state is active. Slots: default (attached content), actions (extra buttons).
 */
export interface QRegistrationCardProps {
  event: string;
  eventHref?: string;
  game?: string;
  discipline?: string;
  team?: string;
  kind?: 'team' | 'player';
  state: QRegistrationCardState;
  stateLabel?: string;
  trackingCode?: string;
  /** Entry fee in rial; 0 → «رایگان». */
  amountRial?: number;
  deadlines?: { label: string; at: string; urgent?: boolean }[];
  note?: string;
  /** Override the next action; null hides it. */
  action?: QRegistrationCardAction | null | undefined;
  checkedIn?: boolean;
  receiptHref?: string;
  /** Listener of @withdraw (declared as a prop: its presence shows the button). */
  onWithdraw?: () => void;
  actions?: string;
}
const p = withDefaults(defineProps<QRegistrationCardProps>(), { state: 'draft', action: undefined });
const emit = defineEmits<{ action: [key: string] }>();
const hid = useId();
const s = computed(() => REG[p.state] ?? REG.draft!);
const badge = computed(() => stateBadge(REG, REG[p.state] ? p.state : 'draft'));
const act = computed(() => {
  if (p.state === 'confirmed' && p.checkedIn) return null;
  return p.action === null ? null : (p.action ?? s.value.act ?? null);
});
const canWithdraw = computed(() => !!p.onWithdraw && REG_ACTIVE.includes(p.state));
</script>

<template>
  <article :class="['q-registration-card', `q-registration-card--${state}`]" :aria-labelledby="hid">
    <div class="q-registration-card__head">
      <div class="q-registration-card__titles">
        <h3 :id="hid" class="q-registration-card__event"><QLink v-if="eventHref" :href="eventHref"><bdi>{{ event }}</bdi></QLink><bdi v-else>{{ event }}</bdi></h3>
        <span class="q-registration-card__sub">
          <span v-if="game" class="q-registration-card__game q-ltr">{{ game }}</span>
          <span v-if="discipline">{{ discipline }}</span>
          <span v-if="team"><QIcon name="users" :size="14" /><bdi>{{ team }}</bdi></span>
          <span v-else-if="kind === 'player'"><QIcon name="user" :size="14" />{{ tr('انفرادی', 'Solo') }}</span>
        </span>
      </div>
      <QBadge v-bind="badge.props">{{ stateLabel || badge.label }}</QBadge>
    </div>
    <dl class="q-registration-card__facts">
      <div v-if="trackingCode"><dt>{{ tr('کد پیگیری', 'Tracking code') }}</dt><dd><span class="q-registration-card__code q-ltr">{{ trackingCode }}</span></dd></div>
      <div v-if="amountRial != null"><dt>{{ tr('ورودی', 'Entry fee') }}</dt><dd class="q-num">{{ amountRial ? toman(amountRial) : tr('رایگان', 'Free') }}</dd></div>
      <div v-for="(d, i) in deadlines ?? []" :key="i" :class="['q-registration-card__deadline', { 'q-registration-card__urgent': d.urgent }]">
        <dt>{{ d.label }}</dt>
        <dd><QIcon v-if="d.urgent" name="clock" :size="14" /><time :datetime="d.at">{{ fmtDate(d.at, 'datetime') }}</time></dd>
      </div>
    </dl>
    <p class="q-registration-card__next"><QIcon name="info" :size="16" /><span>{{ note || tx(s.next) }}</span></p>
    <p v-if="checkedIn && state === 'confirmed'" class="q-registration-card__done"><QIcon name="check-circle" :size="16" />{{ tr('حضور ثبت شد.', 'Checked in.') }}</p>
    <div v-if="$slots.default" class="q-registration-card__extra"><slot /></div>
    <div v-if="act || receiptHref || actions || $slots.actions || canWithdraw" class="q-registration-card__actions">
      <QButton v-if="act" :variant="act.variant" v-bind="act.icon ? { icon: act.icon } : {}" @click="emit('action', act.key)">{{ tx(act.label) }}</QButton>
      <slot name="actions">{{ actions }}</slot>
      <QButton v-if="receiptHref" variant="secondary" icon="file" :href="receiptHref">{{ tr('مشاهده رسید', 'View receipt') }}</QButton>
      <QButton v-if="canWithdraw" variant="danger" class="q-registration-card__withdraw" @click="onWithdraw?.()">{{ tr('انصراف', 'Withdraw') }}</QButton>
    </div>
  </article>
</template>
