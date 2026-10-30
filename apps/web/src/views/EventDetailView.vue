<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  QAlert, QButton, QCard, QCheckbox, QContainer, QDataState, QDisciplineCard, QEventHeader, QFileUpload, QSection, QSelect, QTextField,
  EVENT_STATUS, fa, formatJalali, statusBadge, toman,
} from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp02, type MyTeam } from '../api/esp02';
import { esp03, type PublicDiscipline } from '../api/esp03';
import EventResultsPanel from '../components/EventResultsPanel.vue';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';
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


const teams = ref<MyTeam[]>([]);
const form = reactive<{ open: string | null; teamId: string; entryCode: string; accept: boolean; answers: Record<string, string | number | boolean>; files: Record<string, string> }>({ open: null, teamId: '', entryCode: '', accept: false, answers: {}, files: {} });
const uploading = ref('');
// REG-001/008: documents are uploaded private to this event's scope, scanned, and readable only by authorized staff
async function uploadDocument(key: string, retentionClass: string, files: File[]) {
  const file = files[0];
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
      teams.value = (await esp02.myTeams()).items.filter((x) => ['owner', 'captain', 'manager'].includes(x.role));
    } catch (e) {
      failure.value = toClientError(e);
    }
  }
}

async function register(d: PublicDiscipline) {
  if (!d.rules || !form.accept) return;
  busy.value = true;
  failure.value = null;
  try {
    const reg = await esp03.register(d.id, { teamId: d.participantKind === 'team' ? form.teamId || null : null, entryCode: form.entryCode.trim() || null, formAnswers: form.answers, documentFileIds: form.files, acceptRulesHash: d.rules.hash });
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

const ticketQty = ref('1');
async function buyTicket() {
  if (!data.value) return;
  failure.value = null;
  try {
    const { orderId } = await esp03.buyTickets(data.value.event.id, Math.min(10, Math.max(1, Number(ticketQty.value) || 1)));
    await startPayment(orderId);
  } catch (e) {
    failure.value = toClientError(e);
  }
}

const ds = useDataState({ loading: computed(() => loading.value && !data.value), error });
const status = computed(() => statusBadge(EVENT_STATUS, data.value?.event.state));
const facts = computed(() => {
  const e = data.value?.event;
  if (!e) return [];
  return [
    { label: t('ed.start'), value: formatJalali(e.startsAt, 'datetime', { timeZone: e.timeZone }) },
    { label: t('ed.end'), value: formatJalali(e.endsAt, 'datetime', { timeZone: e.timeZone }) },
    { label: t('ed.tz'), value: e.timeZone, ltr: true },
    { label: t('ed.presence'), value: t(`reg.presence.${e.presence}` as MessageKey) },
    ...(e.contact ? [{ label: t('ed.contact'), value: e.contact }] : []),
  ];
});
const badges = computed(() => {
  const b = data.value?.badges;
  if (!b) return [];
  return [
    ...(b.rated ? [{ label: t('reg.badge.rated'), tone: 'info' as const, icon: 'chart' as const }] : []),
    ...(b.organizerVerified ? [{ label: t('reg.badge.organizer'), tone: 'success' as const, icon: 'shield' as const }] : []),
    ...(b.affiliation ? [{ label: `${t(`evm.aff.${b.affiliation.kind}` as MessageKey)}: ${b.affiliation.body}`, tone: 'neutral' as const }] : []),
  ];
});
const tq = computed(() => (token.value ? `?t=${token.value}` : ''));
const stages = (d: PublicDiscipline) => d.stages.map((x) => ({ id: x.id, name: x.name, format: x.format, state: x.state, href: `/stages/${encodeURIComponent(x.id)}${tq.value}` }));
const answer = (k: string) => computed({ get: () => String(form.answers[k] ?? ''), set: (v: string) => { form.answers[k] = v; } });
const isOpen = (d: PublicDiscipline) => data.value?.event.state === 'registration_open' && !!d.rules;
function login() {
  void router.push({ name: 'login', query: { redirect: route.fullPath } });
}
</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" @retry="load" />
    <div v-else class="k-stack p-event">
      <QEventHeader
        :title="data.event.name" :cover="data.event.posterUrl ?? undefined" :status="(data.event.state === 'active' ? 'live' : data.event.state) as never" :status-label="status.label"
        :verified="data.badges.organizerVerified" :badges="badges.map((b) => b.label)" :starts-at="data.event.startsAt ?? undefined" :ends-at="data.event.endsAt ?? undefined"
        :time-zone="data.event.timeZone" :presence="data.event.presence as never" :facts="facts" :note="data.badges.organizerVerified || data.badges.affiliation ? t('reg.badgeNote') : undefined"
      />
      <div class="p-event-links">
        <QButton v-if="data.event.presence !== 'online' || ['active', 'paused', 'finished'].includes(data.event.state)" variant="primary" icon="broadcast" :href="`/events/${data.event.id}/live${tq}`">{{ t('ed.live') }}</QButton>
        <QButton v-if="data.event.presence !== 'online'" variant="secondary" icon="monitor" :href="`/events/${data.event.id}/hall${tq}`">{{ t('ed.hall') }}</QButton>
        <QButton v-if="session.me && data.event.presence !== 'online'" variant="ghost" icon="qr" :href="`/events/${data.event.id}/my-qr`">{{ t('ed.pass') }}</QButton>
      </div>

      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <QAlert v-if="done" tone="success" :title="t('ed.registered')" :actions="[{ label: t('reg.mine'), href: '/account/registrations' }]">
        {{ t('reg.created', { code: done.trackingCode }) }} — {{ t(`reg.next.${done.state}` as MessageKey) }}
      </QAlert>

      <div class="p-event-grid">
        <div class="p-event-main">
          <QSection v-if="data.event.description" id="about" small :title="t('ed.about')">
            <p class="p-event-desc" dir="auto">{{ data.event.description }}</p>
          </QSection>

          <QSection id="disciplines" small :title="t('ed.disciplines')">
            <p v-if="data.disciplines.length === 0" class="p-event-muted">{{ t('events.noDisciplines') }}</p>
            <QDisciplineCard
              v-for="d in data.disciplines" :key="d.id" :name="d.name" :platform="d.platform" :mode="d.mode" :game-version="d.gameVersion"
              :participant-kind="d.participantKind" :capacity="d.capacity" :remaining="d.remaining" :waitlisted="d.waitlisted || undefined" :fee-rial="d.feeRial"
              :opens-at="d.registrationOpensAt ?? undefined" :closes-at="d.registrationClosesAt ?? undefined" :late-until="d.lateRegistrationUntil ?? undefined"
              :withdraw-by="d.withdrawalDeadline ?? undefined" :rules="d.rules ? { label: d.rules.label, version: d.rules.version, href: `/rules/${d.rules.packageId}` } : undefined"
              :stages="stages(d)"
            >
              <template v-if="isOpen(d)">
                <QButton v-if="!session.me" variant="primary" @click="login">{{ t('reg.loginToRegister') }}</QButton>
                <QButton v-else-if="form.open !== d.id" variant="primary" @click="openForm(d)">{{ d.remaining > 0 ? t('reg.register') : t('reg.joinWaitlist') }}</QButton>
                <form v-else class="p-event-form" novalidate @submit.prevent="register(d)">
                  <QSelect
                    v-if="d.participantKind === 'team'" :id="`rg-team-${d.id}`" v-model="form.teamId" :label="t('reg.team')" required
                    :options="teams.map((tm) => ({ value: tm.teamId, label: `${tm.name} (${tm.tag})` }))"
                  />
                  <template v-for="f in d.formFields" :key="f.key">
                    <QSelect v-if="f.type === 'select'" :id="`rg-${d.id}-${f.key}`" v-model="answer(f.key).value" :label="f.label" :required="f.required" :options="(f.options ?? []).map((o) => ({ value: o, label: o }))" />
                    <QCheckbox v-else-if="f.type === 'checkbox'" :model-value="!!form.answers[f.key]" :label="f.label" @update:model-value="(v) => (form.answers[f.key] = !!v)" />
                    <QTextField v-else :id="`rg-${d.id}-${f.key}`" v-model="answer(f.key).value" :label="f.label" :required="f.required" :type="f.type === 'number' ? 'number' : 'text'" :ltr="f.type === 'number'" />
                  </template>
                  <QFileUpload
                    v-for="doc in d.requiredDocuments" :key="doc.key" :label="doc.label" :hint="form.files[doc.key] ? t('reg.docUploaded') : t('reg.docPrivate')" required
                    accept="application/pdf,image/png,image/jpeg" :disabled="uploading === doc.key" @files="(fs) => uploadDocument(doc.key, doc.retentionClass, fs)"
                  />
                  <QTextField :id="`rg-code-${d.id}`" v-model="form.entryCode" :label="t('reg.entryCode')" :hint="t('reg.entryCodeHint')" ltr />
                  <QCheckbox v-model="form.accept" :label="t('reg.accept', { v: d.rules!.version })" required />
                  <p v-if="d.feeRial > 0" class="p-event-muted">{{ t('reg.payNote') }} · {{ toman(d.feeRial) }}</p>
                  <div class="k-row">
                    <QButton
                      type="submit" variant="primary" :loading="busy"
                      :disabled="!!uploading || !form.accept || (d.participantKind === 'team' && !form.teamId) || d.requiredDocuments.some((x) => !form.files[x.key])"
                    >{{ d.feeRial > 0 ? t('reg.registerAndPay') : t('reg.register') }}</QButton>
                    <QButton variant="secondary" @click="form.open = null">{{ t('ed.cancel') }}</QButton>
                  </div>
                </form>
              </template>
              <p v-else-if="!d.rules" class="p-event-muted">{{ t('reg.noRules') }}</p>
            </QDisciplineCard>
          </QSection>

          <QSection v-if="['active', 'paused', 'finished', 'closed', 'archived'].includes(data.event.state)" id="results" small :title="t('ed.results')">
            <EventResultsPanel :event-id="data.event.id" :token="token" :state="data.event.state" />
          </QSection>
        </div>

        <aside class="p-event-side">
          <QCard v-if="data.prizes.length">
            <div class="k-stack">
              <h2 class="h4 p-event-h">{{ t('ed.prizes') }}</h2>
              <QAlert tone="info">{{ t('reg.prizesNotGuaranteed') }}</QAlert>
              <ul class="p-event-list">
                <li v-for="p in data.prizes" :key="p.id">
                  <strong><bdi>{{ p.title }}</bdi></strong>
                  <span>{{ p.kind === 'cash' ? toman(p.amountRial) : t('reg.nonCash') }}</span>
                  <small>{{ t('reg.responsible') }}: {{ t(`reg.resp.${p.responsible}` as MessageKey) }}</small>
                </li>
              </ul>
            </div>
          </QCard>
          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-event-h">{{ t('ed.terms') }}</h2>
              <template v-if="data.event.refundPolicy">
                <h3 class="p-event-sub">{{ t('reg.refundPolicy') }}</h3>
                <ul class="p-event-list p-event-bullets">
                  <li>{{ t('reg.refundBefore', { p: fa(data.event.refundPolicy.beforeDeadlinePercent) }) }}</li>
                  <li>{{ t('reg.refundAfter', { p: fa(data.event.refundPolicy.afterDeadlinePercent) }) }}</li>
                  <li>{{ t('reg.refundCancel', { p: fa(data.event.refundPolicy.onEventCancelPercent) }) }}</li>
                  <li>{{ t('reg.refundDq', { p: fa(data.event.refundPolicy.onDisqualificationPercent) }) }}</li>
                </ul>
                <p class="p-event-muted" dir="auto">{{ data.event.refundPolicy.text }}</p>
              </template>
              <p v-if="data.event.cancellationTerms" class="p-event-muted" dir="auto"><strong>{{ t('reg.cancelTerms') }}:</strong> {{ data.event.cancellationTerms }}</p>
              <p v-if="data.event.disputeTerms" class="p-event-muted" dir="auto"><strong>{{ t('reg.disputeTerms') }}:</strong> {{ data.event.disputeTerms }}</p>
            </div>
          </QCard>
          <QCard v-if="data.sponsors.length">
            <div class="k-stack">
              <h2 class="h4 p-event-h">{{ t('ed.sponsors') }}</h2>
              <p v-for="s in data.sponsors" :key="s.id" class="p-event-muted"><strong>{{ t(`reg.label.${s.label}` as MessageKey) }}</strong> <bdi>{{ s.sponsorName }}</bdi></p>
            </div>
          </QCard>
          <QCard v-if="session.me && ['published', 'registration_open', 'registration_closed', 'ready'].includes(data.event.state)">
            <form class="k-stack" novalidate @submit.prevent="buyTicket">
              <h2 class="h4 p-event-h">{{ t('reg.tickets') }}</h2>
              <QTextField id="tk-q" v-model="ticketQty" :label="t('reg.quantity')" type="number" input-mode="numeric" ltr />
              <div><QButton type="submit" variant="green" icon="ticket">{{ t('reg.buyTicket') }}</QButton></div>
            </form>
          </QCard>
        </aside>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-event { gap: var(--space-6); }
.p-event-h { margin: 0; }
.p-event-sub { margin: 0; font-size: 14px; font-weight: 800; }
.p-event-links { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.p-event-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-event-main, .p-event-side { display: flex; flex-direction: column; gap: var(--space-6); min-width: 0; }
.p-event-desc { margin: 0; font-size: 16px; line-height: 30px; color: var(--ink-muted); white-space: pre-line; }
.p-event-muted { margin: 0; font-size: 14px; line-height: 24px; color: var(--ink-muted); }
.p-event-form { display: flex; flex-direction: column; gap: var(--space-4); inline-size: 100%; }
.p-event-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-3); font-size: 14px; }
.p-event-list li { display: flex; flex-direction: column; gap: 2px; }
.p-event-list small { color: var(--ink-subtle); }
.p-event-bullets { padding-inline-start: var(--space-5); list-style: disc; gap: var(--space-1); color: var(--ink-muted); }
.p-event-bullets li { display: list-item; }
@media (max-width: 960px) { .p-event-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
