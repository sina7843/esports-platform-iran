<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp04 as esp04Api, type PublicMatch } from '../api/esp04';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';

/**
 * LAN-001..007 operations: venue and areas, stations (checklist, faults, assignment), equipment and personal equipment,
 * role credentials, the gate (QR and ticket admission — works with keyboard-wedge or camera scanner apps that type the
 * code), call-ups and the numbered emergency import with row-by-row human decisions.
 */
type Obj = Record<string, unknown>;
/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const esp04: typeof esp04Api = esp04Api;
const route = useRoute();
const eventId = computed(() => String(route.params.id));
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const venues = ref<Array<Obj & { _id: string; name: string; areas: Array<{ key: string; name: string; kind: string; capacity: number }> }>>([]);
const stations = ref<Array<Obj & { _id: string; label: string; state: string; matchId: string | null; areaKey: string }>>([]);
const equipment = ref<Array<Obj & { _id: string; label: string; state: string; loan: Obj | null }>>([]);
const personal = ref<Array<Obj & { _id: string; item: string; state: string; principalId: string }>>([]);
const credentials = ref<Array<{ id: string; principalId: string; role: string; areas: string[]; state: string }>>([]);
const imports = ref<Awaited<ReturnType<typeof esp04Api.offlineImports>>['items']>([]);
const matches = ref<PublicMatch[]>([]);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    venues.value = (await esp04.venues(eventId.value)).items as typeof venues.value;
    const opt = <T,>(p: Promise<T>) => p.catch(() => null);
    const [s, e, p, c, i, m] = await Promise.all([opt(esp04.stations(eventId.value)), opt(esp04.equipment(eventId.value)), opt(esp04.personalEquipment(eventId.value)), opt(esp04.credentials(eventId.value)), opt(esp04.offlineImports(eventId.value)), opt(esp04.schedule(eventId.value, { limit: 200 }))]);
    stations.value = s?.items ?? [];
    equipment.value = e?.items ?? [];
    personal.value = p?.items ?? [];
    credentials.value = c?.items ?? [];
    imports.value = i?.items ?? [];
    matches.value = m?.items ?? [];
  } catch (err) {
    error.value = toClientError(err);
  } finally {
    loading.value = false;
  }
}
watch(eventId, () => void load(), { immediate: true });
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
const matchLabel = (m: PublicMatch) => `${m.slot?.key ?? ''} ${m.sides.map((s) => s.displayName).join(' — ')}`;

const venue = reactive({ name: '', address: '', directions: '', parking: '', guide: '', areas: 'hall|سالن اصلی|hall|200\nstage|استیج|stage|20\nmedia|رسانه|media|20\naud|تماشاگران|audience|500' });
function createVenue() {
  const areas = venue.areas.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length === 4).map(([key, name, kind, cap]) => ({ key, name, kind, capacity: Number(cap) }));
  return act(() => esp04.createVenue(eventId.value, { name: venue.name, addressText: venue.address, directions: venue.directions || null, parking: venue.parking || null, attendanceGuide: venue.guide || null, areas }));
}
const station = reactive({ venueId: '', areaKey: '', label: '', checklist: 'شبکه|ok\nمانیتور|ok\nصفحه‌کلید و ماوس|ok\nهدست|ok', fault: '', matchId: '' });
const parseChecklist = () => station.checklist.split('\n').map((l) => l.split('|')).filter((p) => p[0]?.trim()).map(([item, ok]) => ({ item: item!.trim(), ok: (ok ?? '').trim() === 'ok' }));
const eq = reactive({ label: '', kind: 'headset', serial: '', to: '', condition: 'سالم' });
const cred = reactive({ principalId: '', role: 'player' });
const gate = reactive({ code: '', gate: 'G1', area: '', mode: 'qr' as 'qr' | 'ticket' });
const gateResult = ref<{ ok: boolean; text: string } | null>(null);
async function admit() {
  gateResult.value = null;
  try {
    if (gate.mode === 'qr') {
      const r = await esp04.admit(eventId.value, gate.code.trim(), gate.gate, gate.area);
      gateResult.value = { ok: true, text: `${t('lan.admitted')}: ${r.displayName ?? ''} (${t(`lan.role.${r.role}` as never)})` };
    } else {
      await esp04.admitTicket(eventId.value, gate.code.trim(), gate.gate, gate.area);
      gateResult.value = { ok: true, text: t('lan.ticketAdmitted') };
    }
  } catch (e) {
    gateResult.value = { ok: false, text: toClientError(e).message };
  }
  gate.code = '';
}
const offline = reactive({ procedureNo: 'EP-01', kind: 'result', file: null as File | null });
const decisions = reactive<Record<string, Record<number, boolean>>>({});
const areaKeys = computed(() => venues.value.flatMap((v) => v.areas.map((a) => a.key)));
</script>

<template>
  <DataState :loading="loading && !venues.length" :error="error" @retry="load">
    <PageHeader :title="t('lan.title')">
      <template #actions>
        <RouterLink class="btn btn-sm" :to="`/organizer/events/${eventId}/operations`">{{ t('cops.title') }}</RouterLink>
        <RouterLink class="btn btn-sm" :to="`/events/${eventId}/hall`">{{ t('hall.title') }}</RouterLink>
      </template>
    </PageHeader>
    <ErrorNote :error="failure" />
    <p v-if="notice" role="status" class="ok">{{ notice }}</p>

    <section class="card stack block">
      <h2>{{ t('lan.gate') }}</h2>
      <form class="row" novalidate @submit.prevent="admit">
        <FormField id="g-mode" :label="t('lan.mode')"><template #default="{ id }"><select :id="id" v-model="gate.mode" class="input"><option value="qr">{{ t('lan.qr') }}</option><option value="ticket">{{ t('lan.ticket') }}</option></select></template></FormField>
        <FormField id="g-code" :label="t('lan.code')" :hint="t('lan.codeHint')"><template #default="{ id, describedBy }"><input :id="id" v-model="gate.code" class="input ltr grow" autocomplete="off" :aria-describedby="describedBy" /></template></FormField>
        <FormField id="g-gate" :label="t('lan.gateName')"><template #default="{ id }"><input :id="id" v-model="gate.gate" class="input ltr input-sm" /></template></FormField>
        <FormField id="g-area" :label="t('lan.area')"><template #default="{ id }"><select :id="id" v-model="gate.area" class="input"><option v-for="a in areaKeys" :key="a" :value="a">{{ a }}</option></select></template></FormField>
        <button type="submit" class="btn btn-primary" :disabled="gate.code.trim().length < 6 || !gate.area">{{ t('lan.admit') }}</button>
      </form>
      <p v-if="gateResult" :class="gateResult.ok ? 'gate-ok' : 'gate-no'" role="status">{{ gateResult.text }}</p>
    </section>

    <section class="card stack block">
      <h2>{{ t('lan.venue') }}</h2>
      <article v-for="v in venues" :key="v._id" class="stack"><strong><bdi>{{ v.name }}</bdi></strong><span dir="auto">{{ v.addressText }}</span><span class="muted">{{ v.areas.map((a) => `${a.name} (${num(a.capacity)})`).join('، ') }}</span></article>
      <details>
        <summary>{{ t('lan.addVenue') }}</summary>
        <form class="stack" novalidate @submit.prevent="createVenue">
          <FormField id="v-n" :label="t('events.name')"><template #default="{ id }"><input :id="id" v-model="venue.name" class="input" dir="auto" /></template></FormField>
          <FormField id="v-a" :label="t('lan.address')"><template #default="{ id }"><textarea :id="id" v-model="venue.address" class="input" rows="2" dir="auto" /></template></FormField>
          <FormField id="v-d" :label="t('lan.directions')"><template #default="{ id }"><input :id="id" v-model="venue.directions" class="input" dir="auto" /></template></FormField>
          <FormField id="v-p" :label="t('lan.parking')"><template #default="{ id }"><input :id="id" v-model="venue.parking" class="input" dir="auto" /></template></FormField>
          <FormField id="v-g" :label="t('lan.guide')"><template #default="{ id }"><textarea :id="id" v-model="venue.guide" class="input" rows="2" dir="auto" /></template></FormField>
          <FormField id="v-ar" :label="t('lan.areas')" :hint="t('lan.areasHint')"><template #default="{ id, describedBy }"><textarea :id="id" v-model="venue.areas" class="input" rows="4" dir="auto" :aria-describedby="describedBy" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="venue.name.length < 2 || venue.address.length < 5">{{ t('lan.addVenue') }}</button>
        </form>
      </details>
    </section>

    <section class="card stack block">
      <h2>{{ t('lan.stations') }}</h2>
      <ul class="list"><li v-for="s in stations" :key="s._id"><bdi>{{ s.label }}</bdi> ({{ s.areaKey }}) <StatusBadge :state="s.state" /> <span v-if="s.matchId" class="muted">{{ s.matchId }}</span>
        <button type="button" class="btn btn-sm" @click="act(() => esp04.checklist(s._id, parseChecklist()))">{{ t('lan.applyChecklist') }}</button>
        <button type="button" class="btn btn-sm btn-danger" :disabled="station.fault.length < 2" @click="act(() => esp04.fault(s._id, station.fault))">{{ t('lan.reportFault') }}</button>
        <button type="button" class="btn btn-sm" :disabled="!station.matchId" @click="act(() => esp04.assignStation(station.matchId, s._id, 'assignment'))">{{ t('lan.assign') }}</button></li></ul>
      <div class="grid">
        <FormField id="st-cl" :label="t('lan.checklist')" :hint="t('lan.checklistHint')"><template #default="{ id, describedBy }"><textarea :id="id" v-model="station.checklist" class="input" rows="4" dir="auto" :aria-describedby="describedBy" /></template></FormField>
        <FormField id="st-f" :label="t('lan.faultNote')"><template #default="{ id }"><input :id="id" v-model="station.fault" class="input" dir="auto" /></template></FormField>
        <FormField id="st-m" :label="t('lan.matchToAssign')"><template #default="{ id }"><select :id="id" v-model="station.matchId" class="input"><option value="">—</option><option v-for="m in matches" :key="m.id" :value="m.id">{{ matchLabel(m) }}</option></select></template></FormField>
      </div>
      <form class="row" novalidate @submit.prevent="act(() => esp04.addStation(station.venueId, station.areaKey, station.label))">
        <FormField id="st-v" :label="t('lan.venue')"><template #default="{ id }"><select :id="id" v-model="station.venueId" class="input"><option v-for="v in venues" :key="v._id" :value="v._id">{{ v.name }}</option></select></template></FormField>
        <FormField id="st-a" :label="t('lan.area')"><template #default="{ id }"><select :id="id" v-model="station.areaKey" class="input"><option v-for="a in venues.find((v) => v._id === station.venueId)?.areas ?? []" :key="a.key" :value="a.key">{{ a.name }}</option></select></template></FormField>
        <FormField id="st-l" :label="t('lan.label')"><template #default="{ id }"><input :id="id" v-model="station.label" class="input ltr input-sm" /></template></FormField>
        <button type="submit" class="btn btn-sm" :disabled="!station.venueId || !station.areaKey || !station.label">{{ t('lan.addStation') }}</button>
      </form>
      <div class="row"><button v-for="m in matches.filter((x) => ['scheduled', 'awaiting_readiness', 'ready'].includes(x.state))" :key="m.id" type="button" class="btn btn-sm" @click="act(() => esp04.callUp(m.id), t('lan.called'))">{{ t('lan.callUp') }}: <bdi>{{ matchLabel(m) }}</bdi></button></div>
    </section>

    <section class="card stack block">
      <h2>{{ t('lan.equipment') }}</h2>
      <ul class="list"><li v-for="e in equipment" :key="e._id"><bdi>{{ e.label }}</bdi> <StatusBadge :state="e.state" />
        <button v-if="e.state === 'available'" type="button" class="btn btn-sm" :disabled="!eq.to" @click="act(() => esp04.loan(e._id, eq.to, eq.condition))">{{ t('lan.loan') }}</button>
        <button v-if="e.state === 'loaned'" type="button" class="btn btn-sm" @click="act(() => esp04.returnEquipment(e._id, eq.condition, false))">{{ t('lan.return') }}</button>
        <button v-if="e.state === 'loaned'" type="button" class="btn btn-sm btn-danger" @click="act(() => esp04.returnEquipment(e._id, eq.condition, true))">{{ t('lan.returnFaulty') }}</button></li></ul>
      <div class="grid">
        <FormField id="eq-to" :label="t('lan.loanTo')"><template #default="{ id }"><input :id="id" v-model="eq.to" class="input ltr" /></template></FormField>
        <FormField id="eq-c" :label="t('lan.condition')"><template #default="{ id }"><input :id="id" v-model="eq.condition" class="input" dir="auto" /></template></FormField>
      </div>
      <form class="row" novalidate @submit.prevent="act(() => esp04.addEquipment(eventId, { label: eq.label, kind: eq.kind, serial: eq.serial || null }))">
        <FormField id="eq-l" :label="t('lan.label')"><template #default="{ id }"><input :id="id" v-model="eq.label" class="input" dir="auto" /></template></FormField>
        <FormField id="eq-k" :label="t('mgmt.kind')"><template #default="{ id }"><input :id="id" v-model="eq.kind" class="input ltr input-sm" /></template></FormField>
        <FormField id="eq-s" :label="t('lan.serial')"><template #default="{ id }"><input :id="id" v-model="eq.serial" class="input ltr input-sm" /></template></FormField>
        <button type="submit" class="btn btn-sm" :disabled="!eq.label">{{ t('lan.addEquipment') }}</button>
      </form>
      <h3>{{ t('lan.personal') }}</h3>
      <ul class="list"><li v-for="p in personal" :key="p._id"><span dir="auto">{{ p.item }}</span> — <bdi class="ltr">{{ p.principalId }}</bdi> <StatusBadge :state="p.state" />
        <template v-if="p.state === 'pending'"><button type="button" class="btn btn-sm" @click="act(() => esp04.decidePersonal(p._id, true, 'inspected'))">{{ t('evm.approve') }}</button><button type="button" class="btn btn-sm" @click="act(() => esp04.decidePersonal(p._id, false, 'not allowed'))">{{ t('evm.reject') }}</button></template></li></ul>
    </section>

    <section class="card stack block">
      <h2>{{ t('lan.credentials') }}</h2>
      <form class="row" novalidate @submit.prevent="act(() => esp04.issueCredential(eventId, { principalId: cred.principalId, role: cred.role }))">
        <FormField id="cr-p" :label="t('lan.principalId')"><template #default="{ id }"><input :id="id" v-model="cred.principalId" class="input ltr" /></template></FormField>
        <FormField id="cr-r" :label="t('lan.roleLabel')"><template #default="{ id }"><select :id="id" v-model="cred.role" class="input"><option v-for="r in ['player', 'coach', 'media', 'staff', 'spectator']" :key="r" :value="r">{{ t(`lan.role.${r}` as never) }}</option></select></template></FormField>
        <button type="submit" class="btn btn-sm" :disabled="!cred.principalId">{{ t('lan.issue') }}</button>
      </form>
      <ul class="list"><li v-for="c in credentials" :key="c.id"><bdi class="ltr">{{ c.principalId }}</bdi> — {{ t(`lan.role.${c.role}` as never) }} — {{ c.areas.join('، ') }} <StatusBadge :state="c.state" /><button v-if="c.state === 'active'" type="button" class="btn btn-sm btn-danger" @click="act(() => esp04.revokeCredential(c.id))">{{ t('lan.revoke') }}</button></li></ul>
    </section>

    <section class="card stack block">
      <h2>{{ t('lan.offline') }}</h2>
      <p class="muted">{{ t('lan.offlineHint') }}</p>
      <form class="row" novalidate @submit.prevent="act(() => esp04.importOffline(eventId, offline.procedureNo, offline.kind, offline.file!))">
        <FormField id="of-p" :label="t('lan.procedure')"><template #default="{ id }"><input :id="id" v-model="offline.procedureNo" class="input ltr input-sm" /></template></FormField>
        <FormField id="of-k" :label="t('mgmt.kind')"><template #default="{ id }"><select :id="id" v-model="offline.kind" class="input"><option value="result">{{ t('lan.kindResult') }}</option><option value="attendance">{{ t('lan.kindAttendance') }}</option></select></template></FormField>
        <FormField id="of-f" :label="t('lan.csv')"><template #default="{ id }"><input :id="id" type="file" accept=".csv,text/csv" class="input" @change="offline.file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></template></FormField>
        <button type="submit" class="btn btn-sm" :disabled="!offline.file">{{ t('lan.import') }}</button>
      </form>
      <article v-for="imp in imports" :key="imp._id" class="card stack">
        <p>{{ imp.procedureNo }} — {{ imp.kind }} — <StatusBadge :state="imp.state" /> <JalaliDate :iso="imp.createdAt" /></p>
        <ul class="list"><li v-for="r in imp.rows" :key="r.row"><label class="row"><input v-if="r.status === 'pending'" v-model="(decisions[imp._id] ??= {})[r.row]" type="checkbox" :aria-label="t('lan.applyRow', { n: num(r.row) })" /> #{{ num(r.row) }} <bdi class="ltr small">{{ Object.values(r.data).join(' | ') }}</bdi> <StatusBadge :state="r.status" /> <span v-if="r.conflict" dir="auto" class="warn">{{ r.conflict }}</span></label></li></ul>
        <div class="row">
          <button type="button" class="btn btn-sm btn-primary" @click="act(() => esp04.decideOffline(imp._id, imp.rows.filter((r) => r.status === 'pending').map((r) => ({ row: r.row, apply: !!decisions[imp._id]?.[r.row] }))))">{{ t('lan.decide') }}</button>
        </div>
      </article>
    </section>
  </DataState>
</template>

<style scoped>
.block { margin-block-start: var(--sp-4); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: flex-end; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: var(--sp-3); }
.list { margin: 0; padding-inline-start: var(--sp-5); display: grid; gap: var(--sp-1); }
.grow { min-inline-size: 16rem; }
.input-sm { max-inline-size: 9rem; }
.gate-ok { background: var(--ok-soft); color: var(--ok); padding: var(--sp-3); font-size: var(--fs-lg, 1.25rem); font-weight: 700; border-radius: var(--radius-md); }
.gate-no { background: var(--danger-soft); color: var(--danger); padding: var(--sp-3); font-size: var(--fs-lg, 1.25rem); font-weight: 700; border-radius: var(--radius-md); }
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.small { font-size: var(--fs-xs); }
h2, h3, p { margin: 0; }
</style>
