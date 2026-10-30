<script setup lang="ts">
import { computed, getCurrentInstance, ref, useId, useSlots } from 'vue';
import { fa, tr } from '../locale';
import { decState, uidOf, type DecisionState } from '../maps/data';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QJalaliDate from './QJalaliDate.vue';
import QMoney from './QMoney.vue';

/** DecisionBox: approval panel — facts, requester, amount, required reason, «تأیید»/«رد», second-approval indicator, decided state. */
export interface QDecisionBoxFact { label: string; value: string }
export interface QDecisionBoxRecord { by: string; at?: string; reason?: string }
export interface QDecisionBoxProps {
  title?: string;
  /** Machine action key, shown in mono LTR (e.g. refund.request). */
  action?: string;
  summary?: string;
  /** Amount in rial. */
  rial?: number;
  amountLabel?: string;
  requestedBy?: string;
  requestedAt?: string;
  facts?: QDecisionBoxFact[];
  state?: DecisionState;
  stateLabel?: string;
  requiresSecond?: boolean;
  firstApproval?: QDecisionBoxRecord;
  secondHint?: string;
  decision?: QDecisionBoxRecord;
  defaultReason?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonError?: string;
  /** 'both' (default) | 'reject' | 'none'. */
  reasonRequired?: 'both' | 'reject' | 'none';
  minReasonLength?: number;
  note?: string;
  cancelLabel?: string;
  /** Which button shows the spinner; any truthy value disables both. */
  busy?: false | 'approve' | 'reject' | true;
  /** false disables deciding (e.g. requester = approver). */
  canDecide?: boolean;
  blockedText?: string;
  approveLabel?: string;
  rejectLabel?: string;
  hint?: string;
}
const p = withDefaults(defineProps<QDecisionBoxProps>(), { state: 'pending', reasonRequired: 'both', minReasonLength: 1, busy: false, canDecide: true });
const emit = defineEmits<{ reasonChange: [value: string]; approve: [reason: string]; reject: [reason: string]; cancel: [] }>();
const reasonModel = defineModel<string | undefined>('reason', { default: undefined });
const slots = useSlots();
const inst = getCurrentInstance();
const hasCancel = () => !!inst?.vnode.props?.onCancel;

if (reasonModel.value === undefined) reasonModel.value = p.defaultReason ?? '';
const reason = computed({
  get: () => reasonModel.value ?? '',
  set: (v: string) => { reasonModel.value = v; emit('reasonChange', v); },
});

const uid = uidOf(useId());
const ta = ref<HTMLTextAreaElement | null>(null);
const tried = ref(false);
const lastKind = ref<'approve' | 'reject' | null>(null);
const st = computed(() => decState(p.state));
const reqMode = computed(() => (p.reasonRequired === 'reject' || p.reasonRequired === 'none' ? p.reasonRequired : 'both'));
const needs = (kind: 'approve' | 'reject' | null) => reqMode.value === 'both' || (reqMode.value === 'reject' && kind === 'reject');
const short = computed(() => reason.value.trim().length < p.minReasonLength);
const invalid = computed(() => tried.value && needs(lastKind.value) && short.value);
const blocked = computed(() => p.canDecide === false);
const decide = (kind: 'approve' | 'reject') => {
  tried.value = true;
  lastKind.value = kind;
  if (needs(kind) && short.value) { ta.value?.focus(); return; }
  if (kind === 'approve') emit('approve', reason.value.trim());
  else emit('reject', reason.value.trim());
};
const reqText = computed(() => (reqMode.value === 'both' ? tr(' (الزامی)', ' (required)') : reqMode.value === 'reject' ? tr(' (برای رد الزامی)', ' (required to reject)') : tr(' (اختیاری)', ' (optional)')));
const errorText = computed(() => p.reasonError || (p.minReasonLength > 1
  ? tr(`دلیل باید دست‌کم ${fa(p.minReasonLength)} نویسه باشد.`, `The reason needs at least ${p.minReasonLength} characters.`)
  : tr('نوشتن دلیل الزامی است.', 'A reason is required.')));
const secondText = computed(() => p.secondHint || (p.rial != null
  ? tr('برای مبالغ بالاتر از سقف، تأیید فرد دوم لازم است.', 'Amounts above the threshold need a second approval.')
  : tr('این اقدام به تأیید فرد دوم نیاز دارد.', 'This action needs a second person’s approval.')));
const decidedBy = computed(() => (p.state === 'rejected' ? tr('ردکننده: ', 'Rejected by: ') : p.state === 'executed' ? tr('اجراکننده: ', 'Executed by: ')
  : p.state === 'expired' ? tr('ثبت: ', 'Recorded by: ') : tr('تأییدکننده: ', 'Approved by: ')));
const hasFacts = computed(() => !!(p.requestedBy || p.requestedAt || p.facts?.length));
</script>

<template>
  <section :class="['q-decision-box', `q-decision-box--${state}`]" :aria-labelledby="uid + 'h'">
    <header class="q-decision-box__head">
      <div class="q-decision-box__heading">
        <h3 :id="uid + 'h'" class="q-decision-box__title"><slot name="title">{{ title || tr('تصمیم', 'Decision') }}</slot></h3>
        <code v-if="action" class="q-decision-box__code q-ltr">{{ action }}</code>
      </div>
      <QBadge :tone="st.tone" :icon="st.icon">{{ stateLabel || st.label }}</QBadge>
    </header>
    <div v-if="slots.summary" class="q-decision-box__summary"><slot name="summary" /></div>
    <p v-else-if="summary" class="q-decision-box__summary">{{ summary }}</p>
    <div v-if="rial != null" class="q-decision-box__amount">
      <span class="q-decision-box__amount-label">{{ amountLabel || tr('مبلغ', 'Amount') }}</span>
      <QMoney :rial="rial" size="xl" />
    </div>
    <dl v-if="hasFacts" class="q-decision-box__facts">
      <div v-if="requestedBy" class="q-decision-box__fact"><dt>{{ tr('درخواست‌دهنده', 'Requested by') }}</dt><dd><bdi>{{ requestedBy }}</bdi></dd></div>
      <div v-if="requestedAt" class="q-decision-box__fact"><dt>{{ tr('زمان درخواست', 'Requested at') }}</dt><dd><QJalaliDate :iso="requestedAt" format="datetime" /></dd></div>
      <div v-for="(f, i) in facts ?? []" :key="i" class="q-decision-box__fact"><dt>{{ f.label }}</dt><dd>{{ f.value }}</dd></div>
    </dl>
    <div v-if="requiresSecond" class="q-decision-box__second">
      <QBadge tone="warning" icon="users">{{ tr('تأیید دوم لازم است', 'Second approval required') }}</QBadge>
      <span v-if="firstApproval" class="q-decision-box__second-text">
        {{ tr('تأیید اول: ', 'First approval: ') }}<bdi>{{ firstApproval.by }}</bdi><template v-if="firstApproval.at">{{ ' · ' }}<QJalaliDate :iso="firstApproval.at" format="datetime" /></template>
      </span>
      <span v-else class="q-decision-box__second-text">{{ secondText }}</span>
    </div>
    <div v-if="state === 'pending'" class="q-decision-box__form">
      <label :for="uid + 'r'" class="q-decision-box__label">{{ reasonLabel || tr('دلیل', 'Reason') }}<span class="q-decision-box__req">{{ reqText }}</span></label>
      <textarea
        :id="uid + 'r'"
        ref="ta"
        v-model="reason"
        class="q-decision-box__input"
        rows="3"
        maxlength="1000"
        dir="auto"
        :required="reqMode === 'both' || undefined"
        :aria-required="reqMode === 'both' ? 'true' : undefined"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="invalid ? uid + 'e' : undefined"
        :placeholder="reasonPlaceholder"
        :disabled="blocked || !!busy"
      />
      <p v-if="invalid" :id="uid + 'e'" class="q-decision-box__error" role="alert"><QIcon name="alert" :size="16" />{{ errorText }}</p>
      <p v-if="blocked && (blockedText || slots.blockedText)" class="q-decision-box__blocked"><QIcon name="lock" :size="16" /><slot name="blockedText">{{ blockedText }}</slot></p>
      <div class="q-decision-box__actions">
        <QButton variant="green" icon="check" :loading="busy === 'approve'" :disabled="blocked || !!busy" @click="decide('approve')">{{ approveLabel || tr('تأیید', 'Approve') }}</QButton>
        <QButton variant="danger" icon="x" :loading="busy === 'reject'" :disabled="blocked || !!busy" @click="decide('reject')">{{ rejectLabel || tr('رد', 'Reject') }}</QButton>
        <QButton v-if="hasCancel()" variant="ghost" @click="emit('cancel')">{{ cancelLabel || tr('انصراف', 'Cancel') }}</QButton>
      </div>
    </div>
    <div v-else class="q-decision-box__outcome">
      <p v-if="decision?.reason" class="q-decision-box__reason" dir="auto"><span class="q-decision-box__reason-label">{{ tr('دلیل: ', 'Reason: ') }}</span>{{ decision.reason }}</p>
      <p v-if="decision" class="q-decision-box__meta">
        {{ decidedBy }}<bdi>{{ decision.by }}</bdi><template v-if="decision.at">{{ ' · ' }}<QJalaliDate :iso="decision.at" format="datetime" /></template>
      </p>
      <div v-if="note || slots.note" class="q-decision-box__note"><QIcon name="info" :size="16" /><div><slot name="note">{{ note }}</slot></div></div>
    </div>
    <p v-if="hint || slots.hint" class="q-decision-box__hint"><QIcon name="shield" :size="16" /><slot name="hint">{{ hint }}</slot></p>
  </section>
</template>
