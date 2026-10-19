<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp03, type Order, type Registration } from '../api/esp03';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import MoneyLabel from '../components/MoneyLabel.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { startPayment } from '../payment';
import { session } from '../session';
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
function withdraw(r: Registration) {
  if (!window.confirm(t('reg.withdrawConfirm'))) return;
  void act(() => esp03.withdraw(r.id), t('reg.withdrawn'));
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
</script>

<template>
  <PageHeader :title="t('reg.mine')" :lead="t('reg.mineLead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="notice">{{ notice }}</p>
  <DataState :loading="loading" :error="error" :empty="!!data && !data.regs.length && !data.orders.length" @retry="load">
    <template v-if="data">
      <section v-for="r in data.regs" :key="r.id" class="card stack item">
        <div class="row between">
          <h2><bdi>{{ r.displayName }}</bdi></h2>
          <StatusBadge :state="r.state" />
        </div>
        <dl class="kv">
          <div><dt>{{ t('reg.tracking') }}</dt><dd><bdi class="ltr">{{ r.trackingCode }}</bdi></dd></div>
          <div><dt>{{ t('reg.event') }}</dt><dd><RouterLink :to="`/events/${r.eventId}`">{{ t('reg.viewEvent') }}</RouterLink></dd></div>
          <div v-if="r.feeRial"><dt>{{ t('reg.fee') }}</dt><dd><MoneyLabel :rial="r.feeRial" /></dd></div>
          <div v-if="r.reservationExpiresAt"><dt>{{ t('reg.holdUntil') }}</dt><dd><JalaliDate :iso="r.reservationExpiresAt" /></dd></div>
          <div v-if="r.waitlisted"><dt>{{ t('reg.waitlist') }}</dt><dd>{{ t('reg.waitlistNote') }}</dd></div>
          <div v-if="r.late"><dt>{{ t('reg.late') }}</dt><dd>✓</dd></div>
        </dl>
        <ul v-if="r.eligibility.issues.length" class="list issues">
          <li v-for="i in r.eligibility.issues" :key="i.code + (i.clause ?? '')" dir="auto">{{ i.message }}<span v-if="i.needsReview" class="muted"> ({{ t('reg.needsReview') }})</span></li>
        </ul>
        <details v-if="r.roster.length">
          <summary>{{ t('reg.roster') }} ({{ num(r.roster.length) }})</summary>
          <ul class="list"><li v-for="m in r.roster" :key="m.principalId"><bdi>{{ m.displayName }}</bdi> — {{ m.role }} — <StatusBadge :state="m.status" /></li></ul>
        </details>
        <div class="row">
          <template v-if="myRosterStatus(r) === 'invited'">
            <button type="button" class="btn btn-primary" @click="act(() => call.rosterResponse(r.id, 'confirm'))">{{ t('reg.confirmMembership') }}</button>
            <button type="button" class="btn" @click="act(() => call.rosterResponse(r.id, 'decline'))">{{ t('reg.decline') }}</button>
          </template>
          <button v-if="r.state === 'awaiting_payment' && r.orderId" type="button" class="btn btn-primary" @click="pay(r.orderId)">{{ t('reg.payNow') }}</button>
          <button v-if="r.state === 'confirmed'" type="button" class="btn" @click="act(() => call.checkIn('event', r.eventId), t('reg.checkedIn'))">{{ t('reg.checkIn') }}</button>
          <button v-if="r.state === 'rejected'" type="button" class="btn" @click="act(() => call.reReview(r.id))">{{ t('reg.reReview') }}</button>
          <button v-if="ACTIVE.includes(r.state)" type="button" class="btn btn-danger" @click="withdraw(r)">{{ t('reg.withdraw') }}</button>
        </div>
        <details v-if="Object.keys(r.formAnswers ?? {}).length && ['draft', 'incomplete', 'awaiting_review', 'awaiting_payment'].includes(r.state)">
          <summary>{{ t('reg.edit') }}</summary>
          <form class="stack" novalidate @submit.prevent="act(() => call.editRegistration(r.id, { formAnswers: editPayload(r), expectedVersion: r.version }))">
            <FormField v-for="(_, k) in r.formAnswers" :id="`ed-${r.id}-${k}`" :key="k" :label="String(k)">
              <template #default="{ id: fid }"><input :id="fid" v-model="editOf(r)[k]" class="input" dir="auto" /></template>
            </FormField>
            <p class="muted">{{ t('reg.editHint') }}</p>
            <button type="submit" class="btn btn-sm">{{ t('mgmt.save') }}</button>
          </form>
        </details>
        <details v-if="r.kind === 'team' && r.state === 'confirmed'">
          <summary>{{ t('reg.substitution') }}</summary>
          <form class="row" novalidate @submit.prevent="act(() => call.substitute(r.id, { kind: subOf(r).kind, outPrincipalId: subOf(r).out, inPrincipalId: subOf(r).in, reason: subOf(r).reason || null }), t('reg.substituted'))">
            <FormField :id="`sb-k-${r.id}`" :label="t('mgmt.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="subOf(r).kind" class="input"><option v-for="k in ['regular', 'between_maps', 'emergency']" :key="k" :value="k">{{ t(`reg.sub.${k}` as never) }}</option></select></template></FormField>
            <FormField :id="`sb-o-${r.id}`" :label="t('reg.subOut')"><template #default="{ id: fid }"><select :id="fid" v-model="subOf(r).out" class="input"><option v-for="m in r.roster.filter((x) => x.status === 'confirmed')" :key="m.principalId" :value="m.principalId">{{ m.displayName }}</option></select></template></FormField>
            <FormField :id="`sb-i-${r.id}`" :label="t('reg.subIn')"><template #default="{ id: fid }"><input :id="fid" v-model="subOf(r).in" class="input ltr" /></template></FormField>
            <FormField :id="`sb-r-${r.id}`" :label="t('evm.reason')"><template #default="{ id: fid }"><input :id="fid" v-model="subOf(r).reason" class="input" dir="auto" /></template></FormField>
            <button type="submit" class="btn btn-sm" :disabled="!subOf(r).out || !subOf(r).in">{{ t('reg.substitute') }}</button>
          </form>
          <p class="muted">{{ t('reg.subHint') }}</p>
        </details>
        <details>
          <summary>{{ t('reg.history') }}</summary>
          <ol class="list"><li v-for="(h, i) in r.history" :key="i"><JalaliDate :iso="h.at" /> — <bdi class="ltr">{{ h.transition }}</bdi><span v-if="h.note" dir="auto"> — {{ h.note }}</span></li></ol>
        </details>
      </section>

      <section class="card stack item">
        <h2>{{ t('pay.orders') }}</h2>
        <p v-if="!data.orders.length" class="muted">—</p>
        <ul class="list">
          <li v-for="o in data.orders" :key="o.id"><RouterLink :to="receiptOf(o)"><bdi class="ltr">{{ o.receiptNo ?? o.id }}</bdi></RouterLink> — <MoneyLabel :rial="o.totalRial" /> — <StatusBadge :state="o.state" /></li>
        </ul>
      </section>

      <section v-if="data.tickets.length" class="card stack item">
        <h2>{{ t('reg.tickets') }}</h2>
        <ul class="list"><li v-for="tk in data.tickets" :key="tk.id"><RouterLink :to="`/events/${tk.eventId}`">{{ t('reg.viewEvent') }}</RouterLink> — <StatusBadge :state="tk.state" /> <bdi v-if="tk.code" class="ltr code">{{ tk.code }}</bdi></li></ul>
      </section>

      <section class="card stack item">
        <h2>{{ t('fin.subscriptions') }}</h2>
        <p class="muted">{{ t('fin.subscriptionNote') }}</p>
        <ul v-if="data.subs.length" class="list">
          <li v-for="s in data.subs" :key="String(s._id)">
            <bdi class="ltr">{{ s.plan }}</bdi> — <StatusBadge :state="String(s.state)" /> — <JalaliDate :iso="(s.periodEnd as string | null) ?? null" format="date" />
            <button v-if="['active', 'pending_payment'].includes(String(s.state))" type="button" class="btn btn-sm" @click="act(() => call.cancelSubscription(String(s._id)))">{{ t('fin.cancelSubscription') }}</button>
          </li>
        </ul>
        <form class="row" novalidate @submit.prevent="act(async () => { const r = await call.subscribe(plan.plan, plan.plan === 'player_pro' ? meId : plan.holderRef); await startPayment(r.orderId); })">
          <FormField id="sub-p" :label="t('fin.plan')"><template #default="{ id: fid }"><select :id="fid" v-model="plan.plan" class="input"><option v-for="p in ['player_pro', 'team_pro', 'organizer_pro']" :key="p" :value="p">{{ t(`fin.plan.${p}` as never) }}</option></select></template></FormField>
          <FormField v-if="plan.plan !== 'player_pro'" id="sub-h" :label="plan.plan === 'team_pro' ? t('fin.teamId') : t('evm.org')"><template #default="{ id: fid }"><input :id="fid" v-model="plan.holderRef" class="input ltr" /></template></FormField>
          <button type="submit" class="btn" :disabled="plan.plan !== 'player_pro' && !plan.holderRef">{{ t('fin.buySubscription') }}</button>
        </form>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.item { margin-block-end: var(--sp-4); }
.between { justify-content: space-between; }
.row { flex-wrap: wrap; gap: var(--sp-2); }
.kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--sp-2); margin: 0; }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.issues { color: var(--warn); }
.code { font-family: monospace; }
.notice { color: var(--ok); }
h2, p { margin: 0; }
</style>
