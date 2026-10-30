<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { CalendarKinds, RecruitmentKinds, TeamRoles } from '@esp/contracts';
import { QBadge, QButton, QCard, QDateField, QEmptyState, QIcon, QSelect, QStatusBadge, QTabs, QTextField, fa, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp02, type Application, type CalendarEntry, type JoinRequest, type RecruitmentAd, type Scrim, type TeamPage } from '../api/esp02';
import { toClientError } from '../errors';
import { stateLabel, t, type MessageKey } from '../i18n';

/**
 * TEAM-004/005/007, REC-001/003/004/005 management for team staff. Every action is authorized by the server
 * against the caller's grant in this team's scope; this panel only offers the controls.
 */
const props = defineProps<{ team: TeamPage; myRole: string; me: string }>();
const emit = defineEmits<{ changed: [] }>();
/** Template-facing alias (plain object, not a ref). */
const call: typeof esp02 = esp02;
const { push } = useToast();
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
const assignable = TeamRoles.filter((r) => r !== 'owner');
/** QDateField gives Tehran wall time with its offset; the API takes UTC. */
const toIso = (v: string | null) => (v ? new Date(v).toISOString() : '');

async function act(fn: () => Promise<unknown>, ok = t('mg.saved'), reloadTeam = false) {
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
  await act(async () => (apps[adId] = (await esp02.adApplications(adId)).items), '');
}

const roleFor = reactive<Record<string, string>>({});
const transfer = reactive({ to: '', note: '' });
const cal = reactive({ kind: 'practice', title: '', startsAt: null as string | null, endsAt: null as string | null, note: '' });
const ad = reactive({ kind: 'player', role: '', level: '', city: '', activityHours: '', description: '' });
const scrim = reactive({ level: '', windowStart: null as string | null, windowEnd: null as string | null, server: '', conditions: '' });
const result = reactive<Record<string, { mine: string; theirs: string }>>({});
const res = (id: string) => (result[id] ??= { mine: '0', theirs: '0' });
const opponentOf = (s: Scrim) => (s.requester.id === props.team.id ? (s.proposal?.teamId ?? '') : s.requester.id);

const tab = ref('members');
const tabs = computed(() => [
  { key: 'members', label: t('mgmt.roleChange'), icon: 'users' as const, count: props.team.currentMembers.length },
  { key: 'joins', label: t('mgmt.joinRequests'), icon: 'inbox' as const, count: joins.value.length },
  { key: 'calendar', label: t('mgmt.calendar'), icon: 'calendar' as const, count: calendar.value.length },
  { key: 'ads', label: t('mgmt.ads'), icon: 'flag' as const, count: ads.value.filter((a) => a.state === 'open').length },
  { key: 'scrims', label: t('mgmt.scrims'), icon: 'swords' as const, count: scrims.value.filter((s) => s.state === 'proposed').length },
  ...(props.myRole === 'owner' ? [{ key: 'owner', label: t('mgmt.transfer'), icon: 'crown' as const }] : []),
]);
const roleOpts = assignable.map((r) => ({ value: r, label: t(`role.${r}` as MessageKey) }));
const APP_ACTIONS = ['invite_tryout', 'start_review', 'accept', 'reject'] as const;
</script>

<template>
  <QCard as="section" class="p-mg" aria-labelledby="mg-h">
    <div class="k-stack">
      <div class="p-mg-head">
        <h2 id="mg-h" class="h4 p-mg-title"><QIcon name="settings" :size="20" /> {{ t('mg.title') }}</h2>
        <QBadge tone="green" icon="shield">{{ t('mg.yourRole', { role: t(`role.${myRole}` as MessageKey) }) }}</QBadge>
      </div>
      <p class="p-mg-muted">{{ t('mg.note') }}</p>

      <QTabs v-model="tab" variant="line" overflow="wrap" :items="tabs" :aria-label="t('mg.title')">
        <template #panel="{ item }">
          <ul v-if="item.key === 'members'" class="p-mg-rows">
            <li v-for="m in team.currentMembers" :key="m.principalId">
              <span><bdi><strong>{{ m.nickname }}</strong></bdi> <span class="p-mg-muted">{{ t(`role.${m.role}` as MessageKey) }}</span></span>
              <span v-if="m.principalId === me" class="p-mg-muted">{{ t('mg.you') }}</span>
              <span v-else-if="m.role === 'owner'" class="p-mg-muted">{{ t('role.owner') }}</span>
              <span v-else class="p-mg-bar">
                <QSelect :id="`rc-${m.principalId}`" :model-value="roleFor[m.principalId] ?? m.role" :label="t('teams.role')" hide-label :options="roleOpts" @update:model-value="(v?: string) => (roleFor[m.principalId] = v ?? m.role)" />
                <QButton size="sm" variant="secondary" :disabled="!roleFor[m.principalId] || roleFor[m.principalId] === m.role" @click="act(() => call.changeRole(team.id, m.principalId, roleFor[m.principalId]!), t('mg.saved'), true)">{{ t('mgmt.save') }}</QButton>
              </span>
            </li>
          </ul>

          <div v-else-if="item.key === 'joins'">
            <QEmptyState v-if="!joins.length" compact icon="inbox" :title="t('mg.noJoins')" />
            <ul v-else class="p-mg-rows">
              <li v-for="j in joins" :key="j.id">
                <span><code class="q-mono q-ltr">{{ j.principalId }}</code> — {{ t(`role.${j.role}` as MessageKey) }}<span v-if="j.message" class="p-mg-muted"> · <bdi>{{ j.message }}</bdi></span></span>
                <span class="k-row">
                  <QButton size="sm" variant="green" @click="act(() => call.joinRequestAction(j.id, 'accept'), t('mg.saved'), true)">{{ t('teams.accept') }}</QButton>
                  <QButton size="sm" variant="secondary" @click="act(() => call.joinRequestAction(j.id, 'decline'))">{{ t('teams.decline') }}</QButton>
                </span>
              </li>
            </ul>
          </div>

          <div v-else-if="item.key === 'calendar'" class="k-stack">
            <ul v-if="calendar.length" class="p-mg-rows">
              <li v-for="c in calendar" :key="c.id">
                <span><bdi>{{ c.title }}</bdi> · <span class="p-mg-muted">{{ formatJalali(c.startsAt) }}</span></span>
                <QButton size="sm" variant="ghost" icon="trash" @click="act(() => call.deleteCalendar(team.id, c.id))">{{ t('mgmt.delete') }}</QButton>
              </li>
            </ul>
            <form class="p-mg-grid" novalidate @submit.prevent="act(() => call.addCalendar(team.id, { kind: cal.kind, title: cal.title, startsAt: toIso(cal.startsAt), endsAt: toIso(cal.endsAt), note: cal.note || null }))">
              <QSelect id="c-kind" v-model="cal.kind" :label="t('mgmt.kind')" :options="CalendarKinds.map((k) => ({ value: k, label: k }))" />
              <QTextField id="c-title" v-model="cal.title" :label="t('mgmt.title')" />
              <QDateField id="c-start" v-model="cal.startsAt" :label="t('mgmt.startsAt')" with-time disable-past />
              <QDateField id="c-end" v-model="cal.endsAt" :label="t('mgmt.endsAt')" with-time disable-past />
              <div><QButton type="submit" variant="green" icon="plus" :disabled="!cal.title || !cal.startsAt || !cal.endsAt">{{ t('mgmt.addEvent') }}</QButton></div>
            </form>
          </div>

          <div v-else-if="item.key === 'ads'" class="k-stack">
            <div v-for="a in ads" :key="a.id" class="k-stack p-mg-item">
              <div class="p-mg-head"><span><code class="q-mono q-ltr">{{ a.kind }}</code> · <bdi>{{ a.description }}</bdi></span><QStatusBadge :state="a.state" /></div>
              <div class="k-row">
                <QButton size="sm" variant="secondary" icon="inbox" @click="loadApps(a.id)">{{ t('mgmt.applications') }}</QButton>
                <QButton v-if="a.state === 'open'" size="sm" variant="danger" @click="act(() => call.closeAd(a.id))">{{ t('mgmt.close') }}</QButton>
              </div>
              <ul v-if="apps[a.id]" class="p-mg-rows">
                <li v-for="ap in apps[a.id]" :key="ap.id">
                  <span><bdi>{{ ap.nickname ?? ap.principalId }}</bdi> <QStatusBadge :state="ap.state" /></span>
                  <span class="k-row">
                    <QButton v-for="action in APP_ACTIONS" :key="action" size="sm" :variant="action === 'accept' ? 'green' : action === 'reject' ? 'danger' : 'secondary'" @click="act(async () => { await call.decideApplication(ap.id, action, ap.version); await loadApps(a.id); })">{{ t(`mg.app.${action}` as MessageKey) }}</QButton>
                  </span>
                </li>
                <li v-if="!apps[a.id]!.length" class="p-mg-muted">—</li>
              </ul>
            </div>
            <form class="k-stack p-mg-item" novalidate @submit.prevent="act(() => call.createAd(team.id, { kind: ad.kind, gameId: team.gameId, role: ad.role || null, level: ad.level || null, city: ad.city || null, activityHours: ad.activityHours || null, description: ad.description }))">
              <h3 class="p-mg-h3">{{ t('mgmt.newAd') }}</h3>
              <div class="p-mg-grid">
                <QSelect id="ad-kind" v-model="ad.kind" :label="t('mgmt.kind')" :options="RecruitmentKinds.map((k) => ({ value: k, label: k }))" />
                <QTextField id="ad-role" v-model="ad.role" :label="t('teams.role')" />
                <QTextField id="ad-level" v-model="ad.level" :label="t('rec.filterLevel')" />
                <QTextField id="ad-city" v-model="ad.city" :label="t('rec.filterCity')" />
              </div>
              <QTextField id="ad-desc" v-model="ad.description" :label="t('mgmt.description')" multiline :rows="2" />
              <div><QButton type="submit" variant="green" icon="plus" :disabled="!ad.description.trim()">{{ t('mgmt.newAd') }}</QButton></div>
            </form>
          </div>

          <div v-else-if="item.key === 'scrims'" class="k-stack">
            <p class="p-mg-muted">{{ t('rec.friendly') }}</p>
            <div v-for="s in scrims" :key="s.id" class="k-stack p-mg-item">
              <div class="p-mg-head"><span>{{ formatJalali(s.windowStart) }}</span><QBadge tone="neutral">{{ stateLabel(s.state) }}</QBadge></div>
              <div class="k-row">
                <template v-if="s.state === 'proposed' && s.requester.id === team.id">
                  <QButton size="sm" variant="green" @click="act(() => call.scrimAction(s.id, 'accept'))">{{ t('teams.accept') }}</QButton>
                  <QButton size="sm" variant="secondary" @click="act(() => call.scrimAction(s.id, 'decline'))">{{ t('teams.decline') }}</QButton>
                </template>
                <QButton v-if="['open', 'proposed', 'accepted'].includes(s.state) && s.requester.id === team.id" size="sm" variant="ghost" @click="act(() => call.scrimAction(s.id, 'cancel'))">{{ t('mgmt.close') }}</QButton>
              </div>
              <form v-if="s.state === 'accepted'" class="p-mg-grid" novalidate @submit.prevent="act(() => call.scrimResult(s.id, team.id, [{ teamId: team.id, score: Number(res(s.id).mine) }, { teamId: opponentOf(s), score: Number(res(s.id).theirs) }], s.version))">
                <QTextField :id="`sm-${s.id}`" v-model="res(s.id).mine" :label="t('mgmt.myScore')" type="number" ltr />
                <QTextField :id="`st-${s.id}`" v-model="res(s.id).theirs" :label="t('mgmt.theirScore')" type="number" ltr />
                <div><QButton type="submit" size="sm" variant="secondary">{{ t('mgmt.result') }}</QButton></div>
              </form>
            </div>
            <form class="p-mg-grid p-mg-item" novalidate @submit.prevent="act(() => call.createScrim(team.id, { gameId: team.gameId, level: scrim.level || null, windowStart: toIso(scrim.windowStart), windowEnd: toIso(scrim.windowEnd), server: scrim.server || null, conditions: scrim.conditions || null }))">
              <QDateField id="s-start" v-model="scrim.windowStart" :label="t('mgmt.startsAt')" with-time disable-past />
              <QDateField id="s-end" v-model="scrim.windowEnd" :label="t('mgmt.endsAt')" with-time disable-past />
              <QTextField id="s-level" v-model="scrim.level" :label="t('rec.filterLevel')" />
              <QTextField id="s-server" v-model="scrim.server" :label="t('rec.server')" ltr />
              <div><QButton type="submit" variant="green" icon="plus" :disabled="!scrim.windowStart || !scrim.windowEnd">{{ t('mgmt.newScrim') }}</QButton></div>
            </form>
          </div>

          <form v-else class="k-stack" novalidate @submit.prevent="act(() => call.requestTransfer(team.id, transfer.to.trim(), transfer.note.trim() || null), t('mgmt.transferSent'))">
            <div class="p-mg-grid">
              <QTextField id="tr-to" v-model="transfer.to" :label="t('mgmt.transferTo')" ltr />
              <QTextField id="tr-note" v-model="transfer.note" :label="t('mgmt.transferNote')" />
            </div>
            <div><QButton type="submit" variant="danger" icon="crown" :disabled="!transfer.to.trim()">{{ t('mgmt.transfer') }}</QButton></div>
            <p class="p-mg-muted">{{ t('mg.transferHint', { n: fa(team.currentMembers.length) }) }}</p>
          </form>
        </template>
      </QTabs>
    </div>
  </QCard>
</template>

<style scoped>
.p-mg { border: 1px solid var(--green-line); }
.p-mg-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-mg-title { margin: 0; display: inline-flex; align-items: center; gap: var(--space-2); color: var(--green-text); }
.p-mg-h3 { margin: 0; font-size: 15px; font-weight: 800; }
.p-mg-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-mg-rows { margin: 0; padding: 0; list-style: none; }
.p-mg-rows > li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); }
.p-mg-bar { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.p-mg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: var(--space-3); align-items: end; }
.p-mg-item { padding-block-start: var(--space-4); border-block-start: 1px solid var(--line); }
</style>
