<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  QAlert, QBadge, QButton, QCard, QConfirmDialog, QContainer, QDataState, QFacts, QPageHeader, QSection, QSelect, QStatusBadge, QTextField,
  fa, formatJalali, toman, useToast,
} from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03, type Order, type Registration } from '../api/esp03';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { startPayment } from '../payment';
import { session } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const call: typeof esp03 = esp03;

/** REG-005/006/009, ROS-001/002, CHK-001, FIN-003: my registrations, roster confirmation, withdrawal, check-in, receipts. */
const { data, loading, error, load } = useLoad(async () => {
  const [regs, orders, tickets, subs] = await Promise.all([esp03.myRegistrations(), esp03.myOrders(), esp03.myTickets(), esp03.mySubscriptions()]);
  return { regs: regs.items, orders: orders.items, tickets: tickets.items, subs: subs.items };
});
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const meId = computed(() => session.me?.principal.id ?? '');

async function act(fn: () => Promise<unknown>, msg = '✓') {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = msg;
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const myRosterStatus = (r: Registration) => r.roster.find((m) => m.principalId === meId.value)?.status;
const ACTIVE = ['draft', 'incomplete', 'awaiting_payment', 'awaiting_review', 'awaiting_capacity', 'confirmed'];
const withdrawing = ref<Registration | null>(null);
function withdraw(r: Registration) {
  withdrawing.value = r;
}
function confirmWithdraw() {
  const r = withdrawing.value;
  withdrawing.value = null;
  if (r) void act(() => esp03.withdraw(r.id), t('reg.withdrawn'));
}

// REG-007 edit until the deadline; ROS-004/005 substitutions (rules and season cap enforced by the server)
const edits = reactive<Record<string, Record<string, string>>>({});
const editOf = (r: Registration) => (edits[r.id] ??= Object.fromEntries(Object.entries(r.formAnswers ?? {}).map(([k, v]) => [k, String(v ?? '')])));
// inputs are text; send each answer back with its original type
const editPayload = (r: Registration) =>
  Object.fromEntries(Object.entries(editOf(r)).map(([k, v]) => [k, typeof r.formAnswers[k] === 'number' ? Number(v) : typeof r.formAnswers[k] === 'boolean' ? v === 'true' : v]));
const plan = reactive({ plan: 'player_pro', holderRef: '' });
const subs = reactive<Record<string, { kind: string; out: string; in: string; reason: string }>>({});
const subOf = (r: Registration) => (subs[r.id] ??= { kind: 'regular', out: '', in: '', reason: '' });
const pay = (orderId: string) => act(() => startPayment(orderId));
const receiptOf = (o: Order) => `/payments/return?order=${encodeURIComponent(o.id)}`;
const { push } = useToast();
watch(notice, (n) => { if (n && n !== '✓') push({ tone: 'success', message: n, duration: 4000 }); });
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error, empty: () => !!data.value && !data.value.regs.length && !data.value.orders.length });
const facts = (r: Registration) => [
  { label: t('reg.tracking'), value: r.trackingCode, ltr: true },
  ...(r.feeRial ? [{ label: t('reg.fee'), value: toman(r.feeRial) }] : []),
  ...(r.reservationExpiresAt ? [{ label: t('reg.holdUntil'), value: formatJalali(r.reservationExpiresAt) }] : []),
  ...(r.waitlisted ? [{ label: t('reg.waitlist'), value: t('reg.waitlistNote') }] : []),
];
const SUB_KINDS = ['regular', 'between_maps', 'emergency'];
const PLANS = ['player_pro', 'team_pro', 'organizer_pro'];
const buy = () => act(async () => { const r = await call.subscribe(plan.plan, plan.plan === 'player_pro' ? meId.value : plan.holderRef); await startPayment(r.orderId); });
</script>

<template>
  <QContainer>
    <div class="k-stack p-regs">
      <QPageHeader compact :title="t('reg.mine')" :description="t('reg.mineLead')">
        <template #actions><QButton variant="secondary" icon="trophy" href="/events">{{ t('shell.events') }}</QButton></template>
      </QPageHeader>
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" skeleton="cards" icon="ticket" :empty-title="t('rg.empty')" @retry="load">
        <template #emptyAction><QButton variant="primary" href="/events">{{ t('rg.find') }}</QButton></template>
      </QDataState>
      <template v-else>
        <QSection v-if="data.regs.length" id="regs" small :title="t('rg.regs')">
          <div class="k-stack">
            <QCard v-for="r in data.regs" :key="r.id">
              <div class="k-stack">
                <div class="p-regs-head">
                  <h3 class="h4 p-regs-h"><bdi>{{ r.displayName }}</bdi></h3>
                  <span class="k-row">
                    <QBadge v-if="r.late" tone="warning">{{ t('reg.late') }}</QBadge>
                    <QStatusBadge :state="r.state" machine="registration" />
                  </span>
                </div>
                <QFacts :columns="4" dense :items="facts(r)" />
                <QAlert v-if="r.eligibility.issues.length" tone="warning">
                  <ul class="p-regs-list"><li v-for="i in r.eligibility.issues" :key="i.code + (i.clause ?? '')" dir="auto">{{ i.message }}<span v-if="i.needsReview"> ({{ t('reg.needsReview') }})</span></li></ul>
                </QAlert>
                <div class="k-row">
                  <template v-if="myRosterStatus(r) === 'invited'">
                    <QButton variant="primary" @click="act(() => call.rosterResponse(r.id, 'confirm'))">{{ t('reg.confirmMembership') }}</QButton>
                    <QButton variant="secondary" @click="act(() => call.rosterResponse(r.id, 'decline'))">{{ t('reg.decline') }}</QButton>
                  </template>
                  <QButton v-if="r.state === 'awaiting_payment' && r.orderId" variant="primary" icon="wallet" @click="pay(r.orderId)">{{ t('reg.payNow') }}</QButton>
                  <QButton v-if="r.state === 'confirmed'" variant="green" icon="check" @click="act(() => call.checkIn('event', r.eventId), t('reg.checkedIn'))">{{ t('reg.checkIn') }}</QButton>
                  <QButton v-if="r.state === 'confirmed'" variant="ghost" icon="qr" :href="`/events/${r.eventId}/my-qr`">{{ t('rg.pass') }}</QButton>
                  <QButton v-if="r.state === 'rejected'" variant="secondary" @click="act(() => call.reReview(r.id))">{{ t('reg.reReview') }}</QButton>
                  <QButton variant="ghost" :href="`/events/${r.eventId}`">{{ t('reg.viewEvent') }}</QButton>
                  <QButton v-if="ACTIVE.includes(r.state)" variant="danger" @click="withdraw(r)">{{ t('reg.withdraw') }}</QButton>
                </div>
                <details v-if="r.roster.length" class="p-regs-more">
                  <summary>{{ t('reg.roster') }} ({{ fa(r.roster.length) }})</summary>
                  <ul class="p-regs-roster"><li v-for="m in r.roster" :key="m.principalId"><bdi>{{ m.displayName }}</bdi><span>{{ m.role }}</span><QStatusBadge :state="m.status" /></li></ul>
                </details>
                <details v-if="Object.keys(r.formAnswers ?? {}).length && ['draft', 'incomplete', 'awaiting_review', 'awaiting_payment'].includes(r.state)" class="p-regs-more">
                  <summary>{{ t('reg.edit') }}</summary>
                  <form class="k-stack" novalidate @submit.prevent="act(() => call.editRegistration(r.id, { formAnswers: editPayload(r), expectedVersion: r.version }))">
                    <QTextField v-for="(_, k) in r.formAnswers" :id="`ed-${r.id}-${k}`" :key="k" v-model="editOf(r)[k]" :label="String(k)" />
                    <p class="p-regs-muted">{{ t('reg.editHint') }}</p>
                    <div><QButton type="submit" variant="secondary" size="sm">{{ t('mgmt.save') }}</QButton></div>
                  </form>
                </details>
                <details v-if="r.kind === 'team' && r.state === 'confirmed'" class="p-regs-more">
                  <summary>{{ t('reg.substitution') }}</summary>
                  <form class="p-regs-sub" novalidate @submit.prevent="act(() => call.substitute(r.id, { kind: subOf(r).kind, outPrincipalId: subOf(r).out, inPrincipalId: subOf(r).in, reason: subOf(r).reason || null }), t('reg.substituted'))">
                    <QSelect :id="`sb-k-${r.id}`" v-model="subOf(r).kind" :label="t('mgmt.kind')" :options="SUB_KINDS.map((k) => ({ value: k, label: t(`reg.sub.${k}` as never) }))" />
                    <QSelect :id="`sb-o-${r.id}`" v-model="subOf(r).out" :label="t('reg.subOut')" :options="r.roster.filter((x) => x.status === 'confirmed').map((m) => ({ value: m.principalId, label: m.displayName }))" />
                    <QTextField :id="`sb-i-${r.id}`" v-model="subOf(r).in" :label="t('reg.subIn')" ltr />
                    <QTextField :id="`sb-r-${r.id}`" v-model="subOf(r).reason" :label="t('evm.reason')" />
                    <QButton type="submit" variant="secondary" size="sm" :disabled="!subOf(r).out || !subOf(r).in">{{ t('reg.substitute') }}</QButton>
                  </form>
                  <p class="p-regs-muted">{{ t('reg.subHint') }}</p>
                </details>
                <details class="p-regs-more">
                  <summary>{{ t('reg.history') }}</summary>
                  <ol class="p-regs-list"><li v-for="(h, i) in r.history" :key="i">{{ formatJalali(h.at) }} — <bdi class="q-ltr">{{ h.transition }}</bdi><span v-if="h.note" dir="auto"> — {{ h.note }}</span></li></ol>
                </details>
              </div>
            </QCard>
          </div>
        </QSection>

        <div class="p-regs-two">
          <QSection id="orders" small :title="t('pay.orders')">
            <QCard>
              <p v-if="!data.orders.length" class="p-regs-muted">—</p>
              <ul v-else class="p-regs-rows">
                <li v-for="o in data.orders" :key="o.id"><RouterLink :to="receiptOf(o)"><bdi class="q-ltr">{{ o.receiptNo ?? o.id }}</bdi></RouterLink><span>{{ toman(o.totalRial) }}</span><QStatusBadge :state="o.state" machine="payment" /></li>
              </ul>
            </QCard>
          </QSection>
          <QSection v-if="data.tickets.length" id="tickets" small :title="t('reg.tickets')">
            <QCard>
              <ul class="p-regs-rows">
                <li v-for="tk in data.tickets" :key="tk.id"><RouterLink :to="`/events/${tk.eventId}`">{{ t('reg.viewEvent') }}</RouterLink><QStatusBadge :state="tk.state" /><bdi v-if="tk.code" class="q-ltr q-mono">{{ tk.code }}</bdi></li>
              </ul>
            </QCard>
          </QSection>
        </div>

        <QSection id="subs" small :title="t('fin.subscriptions')" :description="t('fin.subscriptionNote')">
          <QCard>
            <div class="k-stack">
              <ul v-if="data.subs.length" class="p-regs-rows">
                <li v-for="s in data.subs" :key="String(s._id)">
                  <bdi class="q-ltr">{{ s.plan }}</bdi><QStatusBadge :state="String(s.state)" /><span>{{ formatJalali((s.periodEnd as string | null) ?? null, 'date') }}</span>
                  <QButton v-if="['active', 'pending_payment'].includes(String(s.state))" variant="secondary" size="sm" @click="act(() => call.cancelSubscription(String(s._id)))">{{ t('fin.cancelSubscription') }}</QButton>
                </li>
              </ul>
              <form class="p-regs-sub" novalidate @submit.prevent="buy">
                <QSelect id="sub-p" v-model="plan.plan" :label="t('fin.plan')" :options="PLANS.map((p) => ({ value: p, label: t(`fin.plan.${p}` as never) }))" />
                <QTextField v-if="plan.plan !== 'player_pro'" id="sub-h" v-model="plan.holderRef" :label="plan.plan === 'team_pro' ? t('fin.teamId') : t('evm.org')" ltr />
                <QButton type="submit" variant="green" icon="wallet" :disabled="plan.plan !== 'player_pro' && !plan.holderRef">{{ t('fin.buySubscription') }}</QButton>
              </form>
            </div>
          </QCard>
        </QSection>
      </template>
    </div>
    <QConfirmDialog :require-reason="false"
      :open="!!withdrawing" :title="t('reg.withdraw')" :message="t('reg.withdrawConfirm')" :confirm-label="t('reg.withdraw')" :cancel-label="t('rg.cancel')"
      @close="withdrawing = null" @confirm="confirmWithdraw"
    />
  </QContainer>
</template>

<style scoped>
.p-regs { gap: var(--space-7); }
.p-regs-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.p-regs-h { margin: 0; }
.p-regs-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-regs-list { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: 14px; }
.p-regs-more summary { cursor: pointer; min-block-size: 44px; display: flex; align-items: center; font-weight: 700; color: var(--green-text); }
.p-regs-roster, .p-regs-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-regs-roster li, .p-regs-rows li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); padding-block: var(--space-2); border-block-end: 1px solid var(--line); font-size: 14px; }
.p-regs-sub { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: var(--space-3); align-items: end; }
.p-regs-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); align-items: start; }
@media (max-width: 900px) { .p-regs-two { grid-template-columns: minmax(0, 1fr); } }
</style>
