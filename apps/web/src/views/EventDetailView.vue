<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp02, type MyTeam, type TeamMemberRow } from '../api/esp02';
import { esp03, type PublicDiscipline } from '../api/esp03';
import DataState from '../components/DataState.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import MoneyLabel from '../components/MoneyLabel.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import EventResultsPanel from '../components/EventResultsPanel.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';
import { startPayment } from '../payment';

/** EVT-001..008, REG-001..004: public event page, terms, capacity, prizes (never shown as guaranteed) and registration. */
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));
const token = computed(() => (typeof route.query['t'] === 'string' ? route.query['t'] : undefined));
const { data, loading, error, load } = useLoad(() => esp03.event(id.value, token.value));
watch(id, () => void load());
// link-only and private events must not be indexed (EVT-003)
watch(data, (d) => {
  let m = document.querySelector('meta[name="robots"]');
  if (!m) {
    m = document.createElement('meta');
    m.setAttribute('name', 'robots');
    document.head.appendChild(m);
  }
  m.setAttribute('content', d?.event.robots === 'noindex' ? 'noindex, nofollow' : 'index, follow');
});

const stageCols = () => [
  { key: 'order', label: '#' },
  { key: 'name', label: t('events.stage') },
  { key: 'format', label: t('events.format') },
  { key: 'state', label: t('events.state') },
];

const teams = ref<MyTeam[]>([]);
const form = reactive<{ open: string | null; teamId: string; entryCode: string; accept: boolean; answers: Record<string, string | number | boolean>; files: Record<string, string> }>({ open: null, teamId: '', entryCode: '', accept: false, answers: {}, files: {} });
type RosterRole = 'starter' | 'substitute' | 'coach' | 'manager';
const rosterMembers = ref<TeamMemberRow[]>([]);
const rosterRoles = reactive<Record<string, RosterRole | ''>>({});
const rosterLoading = ref(false);
const loadedTeamId = ref('');
let rosterRequest = 0;
watch(() => form.teamId, async (teamId) => {
  const request = ++rosterRequest;
  loadedTeamId.value = '';
  rosterMembers.value = [];
  for (const key of Object.keys(rosterRoles)) delete rosterRoles[key];
  rosterLoading.value = !!teamId;
  if (!teamId) return;
  try {
    const team = await esp02.team(teamId);
    if (request !== rosterRequest) return;
    rosterMembers.value = team.currentMembers;
    for (const member of team.currentMembers) rosterRoles[member.principalId] = member.role === 'player' || member.role === 'captain' ? 'starter' : member.role === 'substitute' ? 'substitute' : '';
    loadedTeamId.value = teamId;
  } catch (e) {
    if (request === rosterRequest) failure.value = toClientError(e);
  } finally {
    if (request === rosterRequest) rosterLoading.value = false;
  }
});
const selectedRoster = computed(() => rosterMembers.value.flatMap((m) => {
  const role = rosterRoles[m.principalId];
  return role ? [{ principalId: m.principalId, role }] : [];
}));
function rosterLimit(d: PublicDiscipline, key: string, fallback: number): number {
  const value = d.rules?.clauses.find((c) => c.key === key)?.value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}
function rosterReady(d: PublicDiscipline): boolean {
  if (d.participantKind !== 'team') return true;
  const starters = selectedRoster.value.filter((m) => m.role === 'starter').length;
  const subs = selectedRoster.value.filter((m) => m.role === 'substitute').length;
  return !rosterLoading.value && !!form.teamId && loadedTeamId.value === form.teamId && selectedRoster.value.length > 0 && selectedRoster.value.length <= 30 && starters >= rosterLimit(d, 'roster.min', 1) && starters <= rosterLimit(d, 'roster.max', 30) && subs <= rosterLimit(d, 'roster.substitutes', 30);
}
const eligibilityMessages = computed(() => {
  const details = failure.value?.details as { issues?: Array<{ message?: unknown }> } | undefined;
  return Array.isArray(details?.issues) ? details.issues.flatMap((x) => typeof x.message === 'string' ? [x.message] : []) : [];
});

const uploading = ref('');
// REG-001/008: documents are uploaded private to this event's scope, scanned, and readable only by authorized staff
async function uploadDocument(key: string, retentionClass: string, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !data.value) return;
  failure.value = null;
  uploading.value = key;
  try {
    form.files[key] = (await esp03.uploadFile(file, { visibility: 'private', scopeType: 'event', scopeId: data.value.event.id, retentionClass })).id;
  } catch (err) {
    failure.value = toClientError(err);
  } finally {
    uploading.value = '';
  }
}
const failure = ref<ApiClientError | null>(null);
const busy = ref(false);
const done = ref<{ trackingCode: string; state: string; regId: string } | null>(null);

async function openForm(d: PublicDiscipline) {
  failure.value = null;
  done.value = null;
  Object.assign(form, { open: d.id, teamId: '', entryCode: '', accept: false, files: {}, answers: Object.fromEntries(d.formFields.map((f) => [f.key, f.type === 'checkbox' ? false : ''])) });
  if (d.participantKind === 'team' && session.me) {
    try {
      teams.value = (await esp02.myTeams()).items.filter((x) => ['owner', 'captain', 'manager'].includes(x.role) && (!x.gameId || x.gameId === d.gameId || x.gameId === 'unassigned'));
    } catch (e) {
      failure.value = toClientError(e);
    }
  }
}

async function register(d: PublicDiscipline) {
  if (!d.rules || !form.accept || !rosterReady(d)) return;
  busy.value = true;
  failure.value = null;
  try {
    const reg = await esp03.register(d.id, { teamId: d.participantKind === 'team' ? form.teamId || null : null, roster: d.participantKind === 'team' ? selectedRoster.value : [], entryCode: form.entryCode.trim() || null, formAnswers: form.answers, documentFileIds: form.files, acceptRulesHash: d.rules.hash });
    done.value = { trackingCode: reg.trackingCode, state: reg.state, regId: reg.id };
    form.open = null;
    // paid entry: go straight to the gateway; capacity is held only until the payment window ends (REG-008)
    if (reg.state === 'awaiting_payment' && reg.orderId) await startPayment(reg.orderId);
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}

const ticketQty = ref(1);
async function buyTicket() {
  if (!data.value) return;
  failure.value = null;
  try {
    const { orderId } = await esp03.buyTickets(data.value.event.id, ticketQty.value);
    await startPayment(orderId);
  } catch (e) {
    failure.value = toClientError(e);
  }
}

const isOpen = (d: PublicDiscipline) => data.value?.event.state === 'registration_open' && !!d.rules;
function login() {
  void router.push({ name: 'login', query: { redirect: route.fullPath } });
}
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <PageHeader :title="data.event.name">
        <template #title><bdi>{{ data.event.name }}</bdi></template>
        <template #actions><StatusBadge :state="data.event.state" /></template>
      </PageHeader>
      <img v-if="data.event.posterUrl" :src="data.event.posterUrl" :alt="t('evm.poster') + ': ' + data.event.name" class="poster" loading="lazy" />
      <ul v-if="data.badges.rated || data.badges.organizerVerified || data.badges.affiliation" class="badges" :aria-label="t('reg.badges')">
        <li v-if="data.badges.rated">{{ t('reg.badge.rated') }}</li>
        <li v-if="data.badges.organizerVerified">{{ t('reg.badge.organizer') }}</li>
        <li v-if="data.badges.affiliation">{{ t(`evm.aff.${data.badges.affiliation.kind}` as never) }}: <bdi>{{ data.badges.affiliation.body }}</bdi></li>
      </ul>
      <p v-if="data.badges.organizerVerified || data.badges.affiliation" class="muted small">{{ t('reg.badgeNote') }}</p>
      <p v-if="data.event.description" dir="auto" class="desc">{{ data.event.description }}</p>
      <div v-if="data.event.presence !== 'online'" class="row links">
        <RouterLink class="btn btn-sm btn-primary" :to="`/events/${data.event.id}/live${token ? `?t=${token}` : ''}`">{{ t('live.title') }}</RouterLink> <RouterLink class="btn btn-sm" :to="`/events/${data.event.id}/hall${token ? `?t=${token}` : ''}`">{{ t('hall.title') }}</RouterLink>
        <RouterLink v-if="session.me" class="btn btn-sm" :to="`/events/${data.event.id}/my-qr`">{{ t('qr.title') }}</RouterLink>
      </div>
      <dl class="meta">
        <div><dt>{{ t('events.startsAt') }}</dt><dd><JalaliDate :iso="data.event.startsAt" :time-zone="data.event.timeZone" /></dd></div>
        <div><dt>{{ t('events.endsAt') }}</dt><dd><JalaliDate :iso="data.event.endsAt" :time-zone="data.event.timeZone" /></dd></div>
        <div><dt>{{ t('events.timeZone') }}</dt><dd><bdi class="ltr">{{ data.event.timeZone }}</bdi></dd></div>
        <div><dt>{{ t('reg.presence') }}</dt><dd>{{ t(`reg.presence.${data.event.presence}` as never) }}</dd></div>
        <div v-if="data.event.contact"><dt>{{ t('reg.contact') }}</dt><dd><bdi>{{ data.event.contact }}</bdi></dd></div>
      </dl>

      <section v-if="data.sponsors.length" class="card stack block" :aria-label="t('reg.sponsors')">
        <p v-for="s in data.sponsors" :key="s.id"><span class="badge-lbl">{{ t(`reg.label.${s.label}` as never) }}</span> <bdi>{{ s.sponsorName }}</bdi></p>
      </section>

      <section v-if="data.prizes.length" class="card stack block">
        <h2>{{ t('reg.prizes') }}</h2>
        <p class="muted" role="note">{{ t('reg.prizesNotGuaranteed') }}</p>
        <ul class="list">
          <li v-for="p in data.prizes" :key="p.id"><bdi>{{ p.title }}</bdi> — <MoneyLabel v-if="p.kind === 'cash'" :rial="p.amountRial" /><span v-else>{{ t('reg.nonCash') }}</span> <span class="muted">({{ t('reg.responsible') }}: {{ t(`reg.resp.${p.responsible}` as never) }})</span></li>
        </ul>
      </section>

      <section class="card stack block">
        <h2>{{ t('reg.terms') }}</h2>
        <template v-if="data.event.refundPolicy">
          <h3>{{ t('reg.refundPolicy') }}</h3>
          <ul class="list">
            <li>{{ t('reg.refundBefore', { p: num(data.event.refundPolicy.beforeDeadlinePercent) }) }}</li>
            <li>{{ t('reg.refundAfter', { p: num(data.event.refundPolicy.afterDeadlinePercent) }) }}</li>
            <li>{{ t('reg.refundCancel', { p: num(data.event.refundPolicy.onEventCancelPercent) }) }}</li>
            <li>{{ t('reg.refundDq', { p: num(data.event.refundPolicy.onDisqualificationPercent) }) }}</li>
          </ul>
          <p dir="auto">{{ data.event.refundPolicy.text }}</p>
        </template>
        <p v-if="data.event.cancellationTerms" dir="auto"><strong>{{ t('reg.cancelTerms') }}:</strong> {{ data.event.cancellationTerms }}</p>
        <p v-if="data.event.disputeTerms" dir="auto"><strong>{{ t('reg.disputeTerms') }}:</strong> {{ data.event.disputeTerms }}</p>
      </section>

      <ErrorNote :error="failure" />
      <ul v-if="eligibilityMessages.length" class="list" role="alert"><li v-for="message in eligibilityMessages" :key="message">{{ message }}</li></ul>
      <p v-if="done" class="card ok" role="status">{{ t('reg.created', { code: done.trackingCode }) }} — <strong>{{ t(`reg.next.${done.state}` as never) }}</strong> <RouterLink to="/account/registrations">{{ t('reg.mine') }}</RouterLink></p>

      <h2>{{ t('events.disciplines') }}</h2>
      <p v-if="data.disciplines.length === 0" class="muted">{{ t('events.noDisciplines') }}</p>
      <section v-for="d in data.disciplines" :key="d.id" class="card stack disc">
        <h3><bdi>{{ d.name }}</bdi> <span class="muted"><bdi class="ltr">{{ d.platform }} / {{ d.mode }} / {{ d.gameVersion }}</bdi></span></h3>
        <dl class="meta">
          <div><dt>{{ t('reg.kind') }}</dt><dd>{{ t(`reg.kind.${d.participantKind}` as never) }}</dd></div>
          <div><dt>{{ t('reg.capacity') }}</dt><dd>{{ t('reg.remaining', { r: num(d.remaining), c: num(d.capacity) }) }}</dd></div>
          <div v-if="d.waitlisted"><dt>{{ t('reg.waitlist') }}</dt><dd>{{ num(d.waitlisted) }}</dd></div>
          <div><dt>{{ t('reg.fee') }}</dt><dd><MoneyLabel v-if="d.feeRial > 0" :rial="d.feeRial" /><span v-else>{{ t('reg.free') }}</span></dd></div>
          <div><dt>{{ t('reg.opens') }}</dt><dd><JalaliDate :iso="d.registrationOpensAt" /></dd></div>
          <div><dt>{{ t('reg.closes') }}</dt><dd><JalaliDate :iso="d.registrationClosesAt" /></dd></div>
          <div v-if="d.lateRegistrationUntil"><dt>{{ t('reg.late') }}</dt><dd><JalaliDate :iso="d.lateRegistrationUntil" /></dd></div>
          <div><dt>{{ t('reg.withdrawBy') }}</dt><dd><JalaliDate :iso="d.withdrawalDeadline" /></dd></div>
        </dl>
        <details v-if="d.rules">
          <summary>{{ t('reg.rules') }}: <bdi>{{ d.rules.label }}</bdi> <bdi class="ltr">v{{ d.rules.version }}</bdi></summary>
          <RouterLink :to="`/rules/${d.rules.packageId}`">{{ t('reg.rulesFull') }}</RouterLink>
          <ul class="list"><li v-for="c in d.rules.clauses" :key="c.key"><bdi class="ltr">{{ c.key }}</bdi>: <bdi>{{ typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value) }}</bdi></li></ul>
        </details>
        <DataTable :caption="d.name" :columns="stageCols()" :rows="d.stages" row-key="id" row-header="name">
          <template #cell-state="{ row }"><StatusBadge :state="(row as { state: string }).state" /></template>
          <template #cell-name="{ row }"><RouterLink :to="`/stages/${(row as { id: string }).id}${token ? `?t=${token}` : ''}`"><bdi>{{ (row as { name: string }).name }}</bdi></RouterLink></template>
          <template #cell-format="{ row }">{{ t(`fmt.${(row as { format: string }).format}` as never) }}</template>
        </DataTable>

        <template v-if="isOpen(d)">
          <button v-if="!session.me" type="button" class="btn btn-primary" @click="login">{{ t('reg.loginToRegister') }}</button>
          <button v-else-if="form.open !== d.id" type="button" class="btn btn-primary" @click="openForm(d)">{{ d.remaining > 0 ? t('reg.register') : t('reg.joinWaitlist') }}</button>
          <form v-else class="stack" novalidate @submit.prevent="register(d)">
            <FormField v-if="d.participantKind === 'team'" :id="`rg-team-${d.id}`" :label="t('reg.team')" required>
              <template #default="{ id: fid }">
                <select :id="fid" v-model="form.teamId" class="input" required>
                  <option value="" disabled>—</option>
                  <option v-for="tm in teams" :key="tm.teamId" :value="tm.teamId">{{ tm.name }} ({{ tm.tag }})</option>
                </select>
              </template>
            </FormField>
            <fieldset v-if="d.participantKind === 'team' && form.teamId" class="stack" :aria-busy="rosterLoading">
              <legend>{{ t('reg.rosterTitle') }}</legend>
              <p class="muted">{{ t('reg.rosterHelp') }}</p>
              <p v-if="rosterLoading" role="status">{{ t('reg.rosterLoading') }}</p>
              <template v-else-if="loadedTeamId === form.teamId">
                <p v-if="!rosterMembers.length" class="muted">{{ t('reg.rosterEmpty') }}</p>
                <FormField v-for="member in rosterMembers" :id="`rg-member-${d.id}-${member.principalId}`" :key="member.principalId" :label="member.nickname || member.principalId">
                  <template #default="{ id: fid }"><select :id="fid" v-model="rosterRoles[member.principalId]" class="input">
                    <option value="">{{ t('reg.rosterExcluded') }}</option>
                    <option value="starter">{{ t('reg.rosterStarter') }}</option>
                    <option value="substitute">{{ t('reg.rosterSubstitute') }}</option>
                    <option value="coach">{{ t('reg.rosterCoach') }}</option>
                    <option value="manager">{{ t('reg.rosterManager') }}</option>
                  </select></template>
                </FormField>
                <p role="status">{{ t('reg.rosterCount', { n: num(selectedRoster.filter((m) => m.role === 'starter').length), min: num(rosterLimit(d, 'roster.min', 1)), max: num(rosterLimit(d, 'roster.max', 30)), sub: num(selectedRoster.filter((m) => m.role === 'substitute').length), maxSub: num(rosterLimit(d, 'roster.substitutes', 30)) }) }}</p>
                <p v-if="!rosterReady(d)" class="muted">{{ t('reg.rosterIncomplete') }}</p>
              </template>
              <RouterLink :to="`/teams/${form.teamId}`">{{ t('reg.manageRoster') }}</RouterLink>
            </fieldset>
            <FormField v-for="f in d.formFields" :id="`rg-${d.id}-${f.key}`" :key="f.key" :label="f.label" :required="f.required">
              <template #default="{ id: fid }">
                <select v-if="f.type === 'select'" :id="fid" v-model="form.answers[f.key]" class="input" :required="f.required"><option v-for="o in f.options ?? []" :key="o" :value="o">{{ o }}</option></select>
                <input v-else-if="f.type === 'checkbox'" :id="fid" v-model="form.answers[f.key]" type="checkbox" />
                <input v-else-if="f.type === 'number'" :id="fid" v-model.number="form.answers[f.key]" type="number" class="input ltr" :required="f.required" />
                <input v-else :id="fid" v-model="form.answers[f.key]" class="input" dir="auto" :required="f.required" />
              </template>
            </FormField>
            <FormField v-for="doc in d.requiredDocuments" :id="`rg-doc-${d.id}-${doc.key}`" :key="doc.key" :label="doc.label" :hint="form.files[doc.key] ? t('reg.docUploaded') : t('reg.docPrivate')" required>
              <template #default="{ id: fid, describedBy }"><input :id="fid" type="file" class="input" accept="application/pdf,image/png,image/jpeg" :aria-describedby="describedBy" :disabled="uploading === doc.key" @change="uploadDocument(doc.key, doc.retentionClass, $event)" /></template>
            </FormField>
            <FormField :id="`rg-code-${d.id}`" :label="t('reg.entryCode')" :hint="t('reg.entryCodeHint')">
              <template #default="{ id: fid, describedBy }"><input :id="fid" v-model="form.entryCode" class="input ltr" :aria-describedby="describedBy" /></template>
            </FormField>
            <label class="row"><input v-model="form.accept" type="checkbox" required /> {{ t('reg.accept', { v: d.rules!.version }) }}</label>
            <p v-if="d.feeRial > 0" class="muted">{{ t('reg.payNote') }}</p>
            <div class="row">
              <button type="submit" class="btn btn-primary" :disabled="busy || !!uploading || !form.accept || !rosterReady(d) || d.requiredDocuments.some((x) => !form.files[x.key])">{{ d.feeRial > 0 ? t('reg.registerAndPay') : t('reg.register') }}</button>
              <button type="button" class="btn" @click="form.open = null">{{ t('mgmt.close') }}</button>
            </div>
          </form>
        </template>
        <p v-else-if="!d.rules" class="muted">{{ t('reg.noRules') }}</p>
      </section>

      <section v-if="session.me && ['published', 'registration_open', 'registration_closed', 'ready'].includes(data.event.state)" class="card stack block">
        <h2>{{ t('reg.tickets') }}</h2>
        <form class="row" novalidate @submit.prevent="buyTicket">
          <FormField id="tk-q" :label="t('reg.quantity')"><template #default="{ id: fid }"><input :id="fid" v-model.number="ticketQty" type="number" min="1" max="10" class="input ltr" /></template></FormField>
          <button type="submit" class="btn">{{ t('reg.buyTicket') }}</button>
        </form>
      </section>
      <EventResultsPanel v-if="['active', 'paused', 'finished', 'closed', 'archived'].includes(data.event.state)" class="block" :event-id="data.event.id" :token="token" :state="data.event.state" />
    </template>
  </DataState>
</template>

<style scoped>
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-3); margin: 0; }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; }
.disc, .block { margin-block-end: var(--sp-4); }
.desc { margin-block-end: var(--sp-4); }
.links { gap: var(--sp-2); margin-block-end: var(--sp-4); }
.poster { display: block; inline-size: 100%; max-inline-size: 40rem; max-block-size: 20rem; object-fit: cover; border-radius: var(--radius-lg); margin-block-end: var(--sp-4); }
.badges { list-style: none; display: flex; flex-wrap: wrap; gap: var(--sp-2); padding: 0; margin: 0 0 var(--sp-2); }
.badges li { padding: 0 var(--sp-3); border-radius: 999px; background: var(--accent-soft); color: var(--accent-strong); font-size: var(--fs-sm); font-weight: 600; }
.small { font-size: var(--fs-sm); margin-block-end: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.ok { border-inline-start: 4px solid var(--ok); }
.badge-lbl { font-size: var(--fs-xs); padding: 0 var(--sp-2); border: 1px solid var(--border); border-radius: 999px; }
.row { flex-wrap: wrap; gap: var(--sp-3); align-items: flex-end; }
p, h3 { margin: 0; }
</style>
