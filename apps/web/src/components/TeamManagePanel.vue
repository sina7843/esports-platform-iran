<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { CalendarKinds, RecruitmentKinds, TeamRoles, zonedWallTimeToUtc } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp02, type Application, type CalendarEntry, type JoinRequest, type RecruitmentAd, type Scrim, type TeamPage } from '../api/esp02';
import { toClientError } from '../errors';
import { num, stateLabel, t, type MessageKey } from '../i18n';
import ErrorNote from './ErrorNote.vue';
import FormField from './FormField.vue';
import JalaliDate from './JalaliDate.vue';

/**
 * TEAM-004/005/007, REC-001/003/004/005 management for team staff. Every action is authorized by the server
 * against the caller's grant in this team's scope; this panel only offers the controls.
 */
const props = defineProps<{ team: TeamPage; myRole: string; me: string }>();
const emit = defineEmits<{ changed: [] }>();
/** Template-facing alias (plain object, not a ref). */
const call: typeof esp02 = esp02;
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const assignable = TeamRoles.filter((r) => r !== 'owner');
const toIso = (local: string) => (local ? zonedWallTimeToUtc(local) : '');

async function act(fn: () => Promise<unknown>, ok = '', reloadTeam = false) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    await loadAll();
    if (reloadTeam) emit('changed');
  } catch (e) {
    failure.value = toClientError(e);
  }
}

const calendar = ref<CalendarEntry[]>([]);
const joins = ref<JoinRequest[]>([]);
const ads = ref<RecruitmentAd[]>([]);
const apps = reactive<Record<string, Application[]>>({});
const scrims = ref<Scrim[]>([]);
async function loadAll() {
  const id = props.team.id;
  const settle = async <T,>(p: Promise<T>, set: (v: T) => void) => p.then(set).catch(() => undefined); // a forbidden list stays empty
  await Promise.all([
    settle(esp02.calendar(id), (r) => (calendar.value = r.items)),
    settle(esp02.joinRequests(id), (r) => (joins.value = r.items.filter((j) => j.state === 'pending'))),
    settle(esp02.teamAds(id), (r) => (ads.value = r.items)),
    settle(esp02.teamScrims(id), (r) => (scrims.value = r.items)),
  ]);
}
onMounted(loadAll);
async function loadApps(adId: string) {
  await act(async () => (apps[adId] = (await esp02.adApplications(adId)).items));
}

const roleFor = reactive<Record<string, string>>({});
const transfer = reactive({ to: '', note: '' });
const cal = reactive({ kind: 'practice', title: '', startsAt: '', endsAt: '', note: '' });
const ad = reactive({ kind: 'player', role: '', level: '', city: '', activityHours: '', description: '' });
const scrim = reactive({ level: '', windowStart: '', windowEnd: '', server: '', conditions: '' });
const result = reactive<Record<string, { mine: number; theirs: number }>>({});
const res = (id: string) => (result[id] ??= { mine: 0, theirs: 0 });
const opponentOf = (s: Scrim) => (s.requester.id === props.team.id ? (s.proposal?.teamId ?? '') : s.requester.id);
</script>

<template>
  <section class="card stack block" aria-labelledby="mg-h">
    <h2 id="mg-h">{{ t('nav.team') }}</h2>
    <ErrorNote :error="failure" />
    <p v-if="notice" role="status" class="ok">{{ notice }}</p>

    <details open>
      <summary>{{ t('mgmt.roleChange') }}</summary>
      <ul class="list">
        <li v-for="m in team.currentMembers.filter((x) => x.role !== 'owner')" :key="m.principalId" class="row">
          <bdi>{{ m.nickname }}</bdi>
          <label class="sr-only" :for="`rc-${m.principalId}`">{{ t('teams.role') }}</label>
          <select :id="`rc-${m.principalId}`" v-model="roleFor[m.principalId]" class="input sm">
            <option v-for="r in assignable" :key="r" :value="r" :selected="r === m.role">{{ t(`role.${r}` as MessageKey) }}</option>
          </select>
          <button type="button" class="btn btn-sm" :disabled="!roleFor[m.principalId] || roleFor[m.principalId] === m.role" @click="act(() => call.changeRole(team.id, m.principalId, roleFor[m.principalId]!), '', true)">{{ t('mgmt.save') }}</button>
        </li>
      </ul>
    </details>

    <details v-if="myRole === 'owner'">
      <summary>{{ t('mgmt.transfer') }}</summary>
      <form class="stack" novalidate @submit.prevent="act(() => call.requestTransfer(team.id, transfer.to.trim(), transfer.note.trim() || null), t('mgmt.transferSent'))">
        <FormField id="tr-to" :label="t('mgmt.transferTo')"><template #default="{ id }"><input :id="id" v-model="transfer.to" class="input ltr" /></template></FormField>
        <FormField id="tr-note" :label="t('mgmt.transferNote')"><template #default="{ id }"><input :id="id" v-model="transfer.note" class="input" dir="auto" /></template></FormField>
        <button type="submit" class="btn" :disabled="!transfer.to.trim()">{{ t('mgmt.transfer') }}</button>
      </form>
    </details>

    <details>
      <summary>{{ t('mgmt.joinRequests') }} ({{ num(joins.length) }})</summary>
      <ul class="list">
        <li v-for="j in joins" :key="j.id" class="row">
          <bdi class="ltr">{{ j.principalId }}</bdi> — {{ t(`role.${j.role}` as MessageKey) }}
          <button type="button" class="btn btn-sm btn-primary" @click="act(() => call.joinRequestAction(j.id, 'accept'), '', true)">{{ t('teams.accept') }}</button>
          <button type="button" class="btn btn-sm" @click="act(() => call.joinRequestAction(j.id, 'decline'))">{{ t('teams.decline') }}</button>
        </li>
      </ul>
    </details>

    <details>
      <summary>{{ t('mgmt.calendar') }} ({{ num(calendar.length) }})</summary>
      <ul class="list">
        <li v-for="c in calendar" :key="c.id" class="row">
          <bdi>{{ c.title }}</bdi> · <JalaliDate :iso="c.startsAt" />
          <button type="button" class="btn btn-sm" @click="act(() => call.deleteCalendar(team.id, c.id))">{{ t('mgmt.delete') }}</button>
        </li>
      </ul>
      <form class="grid4" novalidate @submit.prevent="act(() => call.addCalendar(team.id, { kind: cal.kind, title: cal.title, startsAt: toIso(cal.startsAt), endsAt: toIso(cal.endsAt), note: cal.note || null }))">
        <FormField id="c-kind" :label="t('mgmt.kind')"><template #default="{ id }"><select :id="id" v-model="cal.kind" class="input"><option v-for="k in CalendarKinds" :key="k" :value="k">{{ k }}</option></select></template></FormField>
        <FormField id="c-title" :label="t('mgmt.title')"><template #default="{ id }"><input :id="id" v-model="cal.title" class="input" dir="auto" /></template></FormField>
        <FormField id="c-start" :label="t('mgmt.startsAt')"><template #default="{ id }"><input :id="id" v-model="cal.startsAt" type="datetime-local" class="input" /></template></FormField>
        <FormField id="c-end" :label="t('mgmt.endsAt')"><template #default="{ id }"><input :id="id" v-model="cal.endsAt" type="datetime-local" class="input" /></template></FormField>
        <button type="submit" class="btn" :disabled="!cal.title || !cal.startsAt || !cal.endsAt">{{ t('mgmt.addEvent') }}</button>
      </form>
    </details>

    <details>
      <summary>{{ t('mgmt.ads') }} ({{ num(ads.length) }})</summary>
      <ul class="list">
        <li v-for="a in ads" :key="a.id" class="stack">
          <span><bdi class="ltr">{{ a.kind }}</bdi> · <bdi>{{ a.description }}</bdi> · {{ stateLabel(a.state) }}</span>
          <div class="row">
            <button type="button" class="btn btn-sm" @click="loadApps(a.id)">{{ t('mgmt.applications') }}</button>
            <button v-if="a.state === 'open'" type="button" class="btn btn-sm" @click="act(() => call.closeAd(a.id))">{{ t('mgmt.close') }}</button>
          </div>
          <ul v-if="apps[a.id]" class="list">
            <li v-for="ap in apps[a.id]" :key="ap.id" class="row">
              <bdi>{{ ap.nickname ?? ap.principalId }}</bdi> · {{ ap.state }}
              <button v-for="action in ['invite_tryout', 'start_review', 'accept', 'reject']" :key="action" type="button" class="btn btn-sm" @click="act(async () => { await call.decideApplication(ap.id, action, ap.version); await loadApps(a.id); })">{{ action }}</button>
            </li>
          </ul>
        </li>
      </ul>
      <form class="stack" novalidate @submit.prevent="act(() => call.createAd(team.id, { kind: ad.kind, gameId: team.gameId, role: ad.role || null, level: ad.level || null, city: ad.city || null, activityHours: ad.activityHours || null, description: ad.description }))">
        <h3>{{ t('mgmt.newAd') }}</h3>
        <div class="grid4">
          <FormField id="ad-kind" :label="t('mgmt.kind')"><template #default="{ id }"><select :id="id" v-model="ad.kind" class="input"><option v-for="k in RecruitmentKinds" :key="k" :value="k">{{ k }}</option></select></template></FormField>
          <FormField id="ad-role" :label="t('teams.role')"><template #default="{ id }"><input :id="id" v-model="ad.role" class="input" dir="auto" /></template></FormField>
          <FormField id="ad-level" :label="t('rec.filterLevel')"><template #default="{ id }"><input :id="id" v-model="ad.level" class="input" dir="auto" /></template></FormField>
          <FormField id="ad-city" :label="t('rec.filterCity')"><template #default="{ id }"><input :id="id" v-model="ad.city" class="input" dir="auto" /></template></FormField>
        </div>
        <FormField id="ad-desc" :label="t('mgmt.description')"><template #default="{ id }"><textarea :id="id" v-model="ad.description" class="input" rows="2" dir="auto" /></template></FormField>
        <button type="submit" class="btn" :disabled="!ad.description.trim()">{{ t('mgmt.newAd') }}</button>
      </form>
    </details>

    <details>
      <summary>{{ t('mgmt.scrims') }} ({{ num(scrims.length) }})</summary>
      <p class="muted">{{ t('rec.friendly') }}</p>
      <ul class="list">
        <li v-for="s in scrims" :key="s.id" class="stack">
          <span><JalaliDate :iso="s.windowStart" /> · {{ stateLabel(s.state) }}</span>
          <div class="row">
            <template v-if="s.state === 'proposed' && s.requester.id === team.id">
              <button type="button" class="btn btn-sm btn-primary" @click="act(() => call.scrimAction(s.id, 'accept'))">{{ t('teams.accept') }}</button>
              <button type="button" class="btn btn-sm" @click="act(() => call.scrimAction(s.id, 'decline'))">{{ t('teams.decline') }}</button>
            </template>
            <button v-if="['open', 'proposed', 'accepted'].includes(s.state) && s.requester.id === team.id" type="button" class="btn btn-sm" @click="act(() => call.scrimAction(s.id, 'cancel'))">{{ t('mgmt.close') }}</button>
          </div>
          <form v-if="s.state === 'accepted'" class="row" novalidate @submit.prevent="act(() => call.scrimResult(s.id, team.id, [{ teamId: team.id, score: res(s.id).mine }, { teamId: opponentOf(s), score: res(s.id).theirs }], s.version))">
            <FormField :id="`sm-${s.id}`" :label="t('mgmt.myScore')"><template #default="{ id }"><input :id="id" v-model.number="res(s.id).mine" type="number" min="0" class="input sm ltr" /></template></FormField>
            <FormField :id="`st-${s.id}`" :label="t('mgmt.theirScore')"><template #default="{ id }"><input :id="id" v-model.number="res(s.id).theirs" type="number" min="0" class="input sm ltr" /></template></FormField>
            <button type="submit" class="btn btn-sm">{{ t('mgmt.result') }}</button>
          </form>
        </li>
      </ul>
      <form class="grid4" novalidate @submit.prevent="act(() => call.createScrim(team.id, { gameId: team.gameId, level: scrim.level || null, windowStart: toIso(scrim.windowStart), windowEnd: toIso(scrim.windowEnd), server: scrim.server || null, conditions: scrim.conditions || null }))">
        <FormField id="s-start" :label="t('mgmt.startsAt')"><template #default="{ id }"><input :id="id" v-model="scrim.windowStart" type="datetime-local" class="input" /></template></FormField>
        <FormField id="s-end" :label="t('mgmt.endsAt')"><template #default="{ id }"><input :id="id" v-model="scrim.windowEnd" type="datetime-local" class="input" /></template></FormField>
        <FormField id="s-level" :label="t('rec.filterLevel')"><template #default="{ id }"><input :id="id" v-model="scrim.level" class="input" dir="auto" /></template></FormField>
        <FormField id="s-server" :label="t('rec.server')"><template #default="{ id }"><input :id="id" v-model="scrim.server" class="input ltr" /></template></FormField>
        <button type="submit" class="btn" :disabled="!scrim.windowStart || !scrim.windowEnd">{{ t('mgmt.newScrim') }}</button>
      </form>
    </details>
  </section>
</template>

<style scoped>
.block { margin-block-start: var(--sp-6); }
.list { margin: 0; padding-inline-start: var(--sp-5); display: grid; gap: var(--sp-2); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
form.row { align-items: flex-end; }
.grid4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--sp-3); align-items: end; }
.sm { max-inline-size: 9rem; }
details { border-block-start: 1px solid var(--border); padding-block: var(--sp-3); }
summary { cursor: pointer; font-weight: 600; }
h3 { margin: var(--sp-3) 0 0; font-size: var(--fs-md); }
.ok { color: var(--accent-strong); }
</style>
