<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QButton, QCard, QCheckbox, QContainer, QDataState, QFileUpload, QIcon, QPageHeader, QSegmentedControl, QSelect, QStatusBadge, QTabs, QTextField, fa, formatJalali, num, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp04 as esp04Api, type PublicMatch } from '../api/esp04';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n === '✓' ? t('rv.done') : n, duration: 3000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
const tab = ref('gate');
const tabs = computed(() => [
  { key: 'gate', label: t('lan.gate'), icon: 'qr' as const },
  { key: 'venue', label: t('lan.venue'), icon: 'map-pin' as const, count: venues.value.length },
  { key: 'stations', label: t('lan.stations'), icon: 'monitor' as const, count: stations.value.length },
  { key: 'equipment', label: t('lan.equipment'), icon: 'gamepad' as const, count: equipment.value.length },
  { key: 'credentials', label: t('lan.credentials'), icon: 'ticket' as const, count: credentials.value.filter((c) => c.state === 'active').length },
  { key: 'offline', label: t('lan.offline'), icon: 'upload' as const, count: imports.value.length },
]);
const gateMode = computed({ get: () => gate.mode, set: (v: string) => { gate.mode = v === 'ticket' ? 'ticket' : 'qr'; } });
const areaOpts = computed(() => areaKeys.value.map((a) => ({ value: a, label: a })));
const venueOpts = computed(() => venues.value.map((v) => ({ value: v._id, label: v.name })));
const stationAreaOpts = computed(() => (venues.value.find((v) => v._id === station.venueId)?.areas ?? []).map((a) => ({ value: a.key, label: a.name })));
const matchOpts = computed(() => [{ value: '', label: '—' }, ...matches.value.map((m) => ({ value: m.id, label: matchLabel(m) }))]);
const callable = computed(() => matches.value.filter((x) => ['scheduled', 'awaiting_readiness', 'ready'].includes(x.state)));
const CRED_ROLES = computed(() => ['player', 'coach', 'media', 'staff', 'spectator'].map((r) => ({ value: r, label: t(`lan.role.${r}` as never) })));
const setDecision = (impId: string, row: number, v: boolean | null) => { (decisions[impId] ??= {})[row] = !!v; };
</script>

<template>
  <QContainer>
    <div class="k-stack p-lan">
      <QPageHeader compact :title="t('lan.title')" :breadcrumb="[{ label: t('oa.crumb'), href: '/organizer' }, { label: t('lan.title') }]">
        <template #actions>
          <QButton variant="secondary" size="sm" :href="`/organizer/events/${eventId}/operations`">{{ t('cops.title') }}</QButton>
          <QButton variant="secondary" size="sm" icon="monitor" :href="`/events/${eventId}/hall`">{{ t('hall.title') }}</QButton>
        </template>
      </QPageHeader>

      <QDataState v-if="(loading && !venues.length) || error" :state="error ? 'error' : 'loading'" :error="error" skeleton="rows" @retry="load" />
      <QTabs v-else v-model="tab" variant="line" overflow="scroll" :items="tabs" :aria-label="t('lan.title')">
        <template #panel="{ item }">
          <QCard v-if="item.key === 'gate'">
            <form class="k-stack" novalidate @submit.prevent="admit">
              <QSegmentedControl v-model="gateMode" :aria-label="t('lan.mode')" :options="[{ value: 'qr', label: t('lan.qr') }, { value: 'ticket', label: t('lan.ticket') }]" />
              <div class="p-lan-grid">
                <QTextField id="g-code" v-model="gate.code" :label="t('lan.code')" :hint="t('lan.codeHint')" ltr auto-complete="off" />
                <QTextField id="g-gate" v-model="gate.gate" :label="t('lan.gateName')" ltr />
                <QSelect id="g-area" v-model="gate.area" :label="t('lan.area')" :placeholder="'—'" :options="areaOpts" />
              </div>
              <div><QButton type="submit" icon="check" :disabled="gate.code.trim().length < 6 || !gate.area">{{ t('lan.admit') }}</QButton></div>
              <p v-if="gateResult" :class="['p-lan-gate', gateResult.ok ? 'is-ok' : 'is-no']" role="status">
                <QIcon :name="gateResult.ok ? 'check-circle' : 'x-circle'" :size="28" /> {{ gateResult.text }}
              </p>
            </form>
          </QCard>

          <div v-else-if="item.key === 'venue'" class="k-stack">
            <QCard v-for="v in venues" :key="v._id">
              <div class="k-stack">
                <strong><bdi>{{ v.name }}</bdi></strong>
                <p class="p-lan-p"><bdi>{{ v.addressText }}</bdi></p>
                <p class="p-lan-muted">{{ v.areas.map((a) => `${a.name} (${num(a.capacity)})`).join('، ') }}</p>
              </div>
            </QCard>
            <QCard>
              <form class="k-stack" novalidate @submit.prevent="createVenue">
                <h2 class="h4 p-lan-p">{{ t('lan.addVenue') }}</h2>
                <div class="p-lan-grid">
                  <QTextField id="v-n" v-model="venue.name" :label="t('events.name')" required />
                  <QTextField id="v-d" v-model="venue.directions" :label="t('lan.directions')" />
                  <QTextField id="v-p" v-model="venue.parking" :label="t('lan.parking')" />
                </div>
                <QTextField id="v-a" v-model="venue.address" :label="t('lan.address')" required multiline :rows="2" />
                <QTextField id="v-g" v-model="venue.guide" :label="t('lan.guide')" multiline :rows="2" />
                <QTextField id="v-ar" v-model="venue.areas" :label="t('lan.areas')" :hint="t('lan.areasHint')" multiline :rows="4" />
                <div><QButton type="submit" variant="green" icon="plus" :disabled="venue.name.length < 2 || venue.address.length < 5">{{ t('lan.addVenue') }}</QButton></div>
              </form>
            </QCard>
          </div>

          <div v-else-if="item.key === 'stations'" class="k-stack">
            <QCard>
              <div class="p-lan-grid">
                <QTextField id="st-cl" v-model="station.checklist" :label="t('lan.checklist')" :hint="t('lan.checklistHint')" multiline :rows="4" />
                <QTextField id="st-f" v-model="station.fault" :label="t('lan.faultNote')" />
                <QSelect id="st-m" v-model="station.matchId" :label="t('lan.matchToAssign')" :options="matchOpts" />
              </div>
            </QCard>
            <QCard padding="none">
              <ul class="p-lan-rows">
                <li v-for="s in stations" :key="s._id">
                  <span><strong><bdi>{{ s.label }}</bdi></strong> <span class="p-lan-muted q-ltr">({{ s.areaKey }})</span> <QStatusBadge :state="s.state" /> <code v-if="s.matchId" class="q-mono q-ltr p-lan-muted">{{ s.matchId }}</code></span>
                  <span class="k-row">
                    <QButton size="sm" variant="secondary" icon="check" @click="act(() => esp04.checklist(s._id, parseChecklist()))">{{ t('lan.applyChecklist') }}</QButton>
                    <QButton size="sm" variant="secondary" :disabled="!station.matchId" @click="act(() => esp04.assignStation(station.matchId, s._id, 'assignment'))">{{ t('lan.assign') }}</QButton>
                    <QButton size="sm" variant="danger" :disabled="station.fault.length < 2" @click="act(() => esp04.fault(s._id, station.fault))">{{ t('lan.reportFault') }}</QButton>
                  </span>
                </li>
                <li v-if="!stations.length" class="p-lan-muted">{{ t('lan.noStations') }}</li>
              </ul>
            </QCard>
            <QCard>
              <form class="p-lan-grid" novalidate @submit.prevent="act(() => esp04.addStation(station.venueId, station.areaKey, station.label))">
                <QSelect id="st-v" v-model="station.venueId" :label="t('lan.venue')" :placeholder="'—'" :options="venueOpts" />
                <QSelect id="st-a" v-model="station.areaKey" :label="t('lan.area')" :placeholder="'—'" :options="stationAreaOpts" />
                <QTextField id="st-l" v-model="station.label" :label="t('lan.label')" ltr />
                <div><QButton type="submit" variant="green" icon="plus" :disabled="!station.venueId || !station.areaKey || !station.label">{{ t('lan.addStation') }}</QButton></div>
              </form>
            </QCard>
            <div v-if="callable.length" class="k-row">
              <QButton v-for="m in callable" :key="m.id" size="sm" variant="secondary" icon="bell" @click="act(() => esp04.callUp(m.id), t('lan.called'))">{{ t('lan.callUp') }}: <bdi>{{ matchLabel(m) }}</bdi></QButton>
            </div>
          </div>

          <div v-else-if="item.key === 'equipment'" class="k-stack">
            <QCard>
              <div class="p-lan-grid">
                <QTextField id="eq-to" v-model="eq.to" :label="t('lan.loanTo')" ltr />
                <QTextField id="eq-c" v-model="eq.condition" :label="t('lan.condition')" />
              </div>
            </QCard>
            <QCard padding="none">
              <ul class="p-lan-rows">
                <li v-for="e in equipment" :key="e._id">
                  <span><bdi>{{ e.label }}</bdi> <QStatusBadge :state="e.state" /></span>
                  <span class="k-row">
                    <QButton v-if="e.state === 'available'" size="sm" variant="secondary" :disabled="!eq.to" @click="act(() => esp04.loan(e._id, eq.to, eq.condition))">{{ t('lan.loan') }}</QButton>
                    <QButton v-if="e.state === 'loaned'" size="sm" variant="secondary" @click="act(() => esp04.returnEquipment(e._id, eq.condition, false))">{{ t('lan.return') }}</QButton>
                    <QButton v-if="e.state === 'loaned'" size="sm" variant="danger" @click="act(() => esp04.returnEquipment(e._id, eq.condition, true))">{{ t('lan.returnFaulty') }}</QButton>
                  </span>
                </li>
              </ul>
            </QCard>
            <QCard>
              <form class="p-lan-grid" novalidate @submit.prevent="act(() => esp04.addEquipment(eventId, { label: eq.label, kind: eq.kind, serial: eq.serial || null }))">
                <QTextField id="eq-l" v-model="eq.label" :label="t('lan.label')" />
                <QTextField id="eq-k" v-model="eq.kind" :label="t('mgmt.kind')" ltr />
                <QTextField id="eq-s" v-model="eq.serial" :label="t('lan.serial')" ltr />
                <div><QButton type="submit" variant="green" icon="plus" :disabled="!eq.label">{{ t('lan.addEquipment') }}</QButton></div>
              </form>
            </QCard>
            <h2 class="h4 p-lan-p">{{ t('lan.personal') }}</h2>
            <QCard padding="none">
              <ul class="p-lan-rows">
                <li v-for="p in personal" :key="p._id">
                  <span><bdi>{{ p.item }}</bdi> — <code class="q-mono q-ltr">{{ p.principalId }}</code> <QStatusBadge :state="p.state" /></span>
                  <span v-if="p.state === 'pending'" class="k-row">
                    <QButton size="sm" variant="green" @click="act(() => esp04.decidePersonal(p._id, true, 'inspected'))">{{ t('evm.approve') }}</QButton>
                    <QButton size="sm" variant="danger" @click="act(() => esp04.decidePersonal(p._id, false, 'not allowed'))">{{ t('evm.reject') }}</QButton>
                  </span>
                </li>
                <li v-if="!personal.length" class="p-lan-muted">—</li>
              </ul>
            </QCard>
          </div>

          <div v-else-if="item.key === 'credentials'" class="k-stack">
            <QCard>
              <form class="p-lan-grid" novalidate @submit.prevent="act(() => esp04.issueCredential(eventId, { principalId: cred.principalId, role: cred.role }))">
                <QTextField id="cr-p" v-model="cred.principalId" :label="t('lan.principalId')" ltr />
                <QSelect id="cr-r" v-model="cred.role" :label="t('lan.roleLabel')" :options="CRED_ROLES" />
                <div><QButton type="submit" variant="green" icon="ticket" :disabled="!cred.principalId">{{ t('lan.issue') }}</QButton></div>
              </form>
            </QCard>
            <QCard padding="none">
              <ul class="p-lan-rows">
                <li v-for="c in credentials" :key="c.id">
                  <span><code class="q-mono q-ltr">{{ c.principalId }}</code> — {{ t(`lan.role.${c.role}` as never) }} — <span class="p-lan-muted">{{ c.areas.join('، ') }}</span> <QStatusBadge :state="c.state" /></span>
                  <QButton v-if="c.state === 'active'" size="sm" variant="danger" @click="act(() => esp04.revokeCredential(c.id))">{{ t('lan.revoke') }}</QButton>
                </li>
                <li v-if="!credentials.length" class="p-lan-muted">—</li>
              </ul>
            </QCard>
          </div>

          <div v-else class="k-stack">
            <QAlert tone="warning">{{ t('lan.offlineHint') }}</QAlert>
            <QCard>
              <form class="k-stack" novalidate @submit.prevent="act(() => esp04.importOffline(eventId, offline.procedureNo, offline.kind, offline.file!))">
                <div class="p-lan-grid">
                  <QTextField id="of-p" v-model="offline.procedureNo" :label="t('lan.procedure')" ltr />
                  <QSelect id="of-k" v-model="offline.kind" :label="t('mgmt.kind')" :options="[{ value: 'result', label: t('lan.kindResult') }, { value: 'attendance', label: t('lan.kindAttendance') }]" />
                </div>
                <QFileUpload id="of-f" :label="t('lan.csv')" accept=".csv,text/csv" :multiple="false" :files="offline.file ? [{ name: offline.file.name, size: offline.file.size, scanState: 'pending' }] : []" @files="(fs) => (offline.file = fs[0] ?? null)" />
                <div><QButton type="submit" icon="upload" :disabled="!offline.file">{{ t('lan.import') }}</QButton></div>
              </form>
            </QCard>
            <QCard v-for="imp in imports" :key="imp._id">
              <div class="k-stack">
                <p class="p-lan-p"><code class="q-mono q-ltr">{{ imp.procedureNo }}</code> — {{ imp.kind }} — <QStatusBadge :state="imp.state" /> <span class="p-lan-muted">{{ formatJalali(imp.createdAt) }}</span></p>
                <ul class="p-lan-rows">
                  <li v-for="r in imp.rows" :key="r.row">
                    <QCheckbox v-if="r.status === 'pending'" :model-value="!!decisions[imp._id]?.[r.row]" :label="t('lan.applyRow', { n: fa(r.row) })" @update:model-value="(v) => setDecision(imp._id, r.row, v)" />
                    <span v-else>#{{ fa(r.row) }}</span>
                    <span><code class="q-mono q-ltr">{{ Object.values(r.data).join(' | ') }}</code> <QStatusBadge :state="r.status" /> <span v-if="r.conflict" class="p-lan-warn"><bdi>{{ r.conflict }}</bdi></span></span>
                  </li>
                </ul>
                <div><QButton @click="act(() => esp04.decideOffline(imp._id, imp.rows.filter((r) => r.status === 'pending').map((r) => ({ row: r.row, apply: !!decisions[imp._id]?.[r.row] }))))">{{ t('lan.decide') }}</QButton></div>
              </div>
            </QCard>
          </div>
        </template>
      </QTabs>
    </div>
  </QContainer>
</template>

<style scoped>
.p-lan-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: var(--space-4); align-items: end; }
.p-lan-rows { margin: 0; padding: 0; list-style: none; }
.p-lan-rows > li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
.p-lan-p { margin: 0; }
.p-lan-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-lan-warn { color: var(--warning-text); }
.p-lan-gate { display: flex; align-items: center; gap: var(--space-3); margin: 0; padding: var(--space-4); border-radius: var(--radius-md); font-size: 20px; font-weight: 800; }
.p-lan-gate.is-ok { background: var(--success-soft); color: var(--success-text); }
.p-lan-gate.is-no { background: var(--danger-soft); color: var(--danger-text); }
</style>
