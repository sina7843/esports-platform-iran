<script setup lang="ts">
import { computed, useId } from 'vue';
import { fa, tr } from '../locale';
import { STAGE_STATUS, feeText, formatLabel, statusBadge } from '../maps/competition';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';

export interface QDisciplineCardStage {
  id?: string;
  name: string;
  /** single_elim | double_elim | round_robin | groups | swiss | ladder | multi_lobby | record | time_trial | mixed */
  format: string;
  /** draft | scheduled | pending | draw | active | live | paused | finished | final | cancelled */
  state: string;
  stateLabel?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live';
  href?: string;
}
/** A discipline block on the event page: facts, rules package link and a compact stages table. Default slot = action area. */
export interface QDisciplineCardProps {
  name: string;
  platform?: string;
  mode?: string;
  gameVersion?: string;
  participantKind?: 'team' | 'player';
  capacity?: number;
  remaining?: number;
  capacityText?: string;
  waitlisted?: number;
  feeRial?: number;
  fee?: string;
  opensAt?: string;
  closesAt?: string;
  lateUntil?: string;
  withdrawBy?: string;
  rules?: { label: string; version: string; href?: string };
  stages?: QDisciplineCardStage[];
}
const p = defineProps<QDisciplineCardProps>();
const uid = useId();

const kind = computed(() => (p.participantKind === 'player' ? tr('انفرادی', 'Solo') : tr('تیمی', 'Team')));
const facts = computed(() => {
  const capVal = p.capacityText || (p.capacity != null
    ? (p.remaining != null
      ? tr(`${fa(p.remaining)} جای خالی از ${fa(p.capacity)}`, `${fa(p.remaining)} of ${fa(p.capacity)} places left`)
      : fa(p.capacity))
    : null);
  const list: ([string, string] | null | undefined | '' | 0)[] = [
    [tr('نوع شرکت‌کننده', 'Participant type'), kind.value],
    capVal ? [tr('ظرفیت', 'Capacity'), capVal] : null,
    p.waitlisted ? [tr('فهرست انتظار', 'Waitlist'), fa(p.waitlisted)] : null,
    [tr('ورودی', 'Entry fee'), typeof p.fee === 'string' ? p.fee : feeText(p.feeRial)],
    p.opensAt ? [tr('شروع ثبت‌نام', 'Registration opens'), p.opensAt] : null,
    p.closesAt ? [tr('پایان ثبت‌نام', 'Registration closes'), p.closesAt] : null,
    p.lateUntil ? [tr('ثبت‌نام دیرهنگام', 'Late registration'), p.lateUntil] : null,
    p.withdrawBy ? [tr('مهلت انصراف', 'Withdrawal deadline'), p.withdrawBy] : null,
  ];
  return list.filter((f): f is [string, string] => !!f);
});
const stageList = computed(() => (p.stages ?? []).map((s) => ({ ...s, badge: statusBadge(STAGE_STATUS, s.state, s.stateLabel, s.tone) })));
const stagesLabel = computed(() => tr('مراحل ', 'Stages: ') + (p.name || ''));
const pm = computed(() => [p.platform, p.mode, p.gameVersion].filter(Boolean).join(' / '));
</script>

<template>
  <section class="q-discipline-card" :aria-labelledby="uid">
    <header class="q-discipline-card__head">
      <h3 :id="uid" class="h4 q-discipline-card__name">
        <bdi>{{ name }}</bdi>
        <span v-if="platform || mode" class="q-discipline-card__pm body-sm"><bdi class="q-ltr">{{ pm }}</bdi></span>
      </h3>
      <QBadge tone="neutral" :icon="participantKind === 'player' ? 'user' : 'users'">{{ kind }}</QBadge>
    </header>
    <dl class="q-discipline-card__facts">
      <div v-for="(f, i) in facts" :key="i" class="q-discipline-card__fact"><dt class="micro">{{ f[0] }}</dt><dd class="label">{{ f[1] }}</dd></div>
    </dl>
    <div v-if="rules" class="q-discipline-card__rules body-sm">
      <QIcon name="file" :size="18" />
      <span>{{ tr('قوانین: ', 'Rules: ') }}<bdi>{{ rules.label }}</bdi> <bdi class="q-ltr q-discipline-card__ver">v{{ rules.version }}</bdi></span>
      <a class="q-discipline-card__link label" :href="rules.href || '#'">{{ tr('متن کامل نسخهٔ قوانین', 'Full rules version') }}<QIcon name="arrow-right" :size="16" flip /></a>
    </div>
    <div v-if="stageList.length" class="q-discipline-card__scroll" role="region" tabindex="0" :aria-label="stagesLabel">
      <table class="q-discipline-card__table body-sm">
        <caption class="q-sr">{{ stagesLabel }}</caption>
        <thead>
          <tr>
            <th scope="col" class="q-discipline-card__n">#</th>
            <th scope="col">{{ tr('مرحله', 'Stage') }}</th>
            <th scope="col">{{ tr('قالب', 'Format') }}</th>
            <th scope="col">{{ tr('وضعیت', 'State') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in stageList" :key="s.id || i">
            <td class="q-discipline-card__n q-num">{{ fa(i + 1) }}</td>
            <th scope="row">
              <a v-if="s.href" :href="s.href" class="q-discipline-card__stage"><bdi>{{ s.name }}</bdi></a>
              <bdi v-else>{{ s.name }}</bdi>
            </th>
            <td>{{ formatLabel(s.format) }}</td>
            <td>
              <QBadge v-bind="s.badge.props">{{ s.badge.label }}</QBadge>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="$slots.default" class="q-discipline-card__actions"><slot /></div>
  </section>
</template>
