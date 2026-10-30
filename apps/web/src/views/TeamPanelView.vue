<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  QAvatar, QBadge, QButton, QCard, QConfirmDialog, QContainer, QDataState, QDateField, QDialog, QEmptyState, QFacts, QPageHeader, QRosterList,
  QSelect, QStatTile, QStatusBadge, QTextField, fa, formatJalali, useToast, type QRosterListMember, type QRosterListRole,
} from '@esp/ui';
import { esp02 as esp02Api, type CalendarEntry, type JoinRequest, type RecruitmentAd, type Scrim, type TeamPage } from '../api/esp02';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';
import { isOn } from '../features';

/**
 * Team panel (private): identity, members, calendar, join requests, recruitment ad and scrims for one of my teams.
 * OPEN-QUESTION: backlog 8.4 / 8.3 — team registrations and upcoming matches have no endpoint; those blocks show `later`.
 * OPEN-QUESTION: backlog 8.5 — no `GET /teams/:id/me`; my role comes from `/me/teams` and the server still decides.
 */
/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const esp02: typeof esp02Api = esp02Api;
const route = useRoute();
const router = useRouter();
const { push } = useToast();
const mine = useLoad(() => esp02.myTeams());
const teamId = computed(() => {
  const q = route.query['team'];
  return typeof q === 'string' && q ? q : (mine.data.value?.items[0]?.teamId ?? '');
});
const myRole = computed(() => mine.data.value?.items.find((x) => x.teamId === teamId.value)?.role ?? '');
const team = ref<TeamPage | null>(null);
const cal = ref<CalendarEntry[]>([]);
const joins = ref<JoinRequest[]>([]);
const ads = ref<RecruitmentAd[]>([]);
const scrims = ref<Scrim[]>([]);
const loading = ref(false);
const error = ref<ReturnType<typeof toClientError> | null>(null);
async function load() {
  if (!teamId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const opt = <T,>(p: Promise<T>, empty: T) => p.catch(() => empty);
    const [tm, c, j, a, s] = await Promise.all([
      esp02.team(teamId.value), opt(esp02.calendar(teamId.value), { items: [] }), opt(esp02.joinRequests(teamId.value), { items: [] }),
      opt(esp02.teamAds(teamId.value), { items: [] }), opt(esp02.teamScrims(teamId.value), { items: [] }),
    ]);
    team.value = tm;
    cal.value = c.items;
    joins.value = j.items.filter((x) => x.state === 'pending');
    ads.value = a.items;
    scrims.value = s.items;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(teamId, () => void load(), { immediate: true });
async function act(fn: () => Promise<unknown>, ok: string) {
  try {
    await fn();
    push({ tone: 'success', message: ok, duration: 4000 });
    await load();
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
const teamOpts = computed(() => (mine.data.value?.items ?? []).map((x) => ({ value: x.teamId, label: `${x.name} [${x.tag}]` })));
const pickTeam = (v: string) => void router.replace({ query: { team: v } });

const ROLE_SET = new Set<QRosterListRole>(['owner', 'manager', 'captain', 'player', 'substitute', 'coach', 'analyst']);
const members = computed<QRosterListMember[]>(() => (team.value?.currentMembers ?? []).map((m) => ({
  id: m.principalId, name: m.nickname, ...(m.avatarUrl ? { avatarSrc: m.avatarUrl } : {}),
  roles: ROLE_SET.has(m.role as QRosterListRole) ? [m.role as QRosterListRole] : [],
})));
const openAd = computed(() => ads.value.find((a) => a.state === 'open') ?? ads.value[0] ?? null);
const nextCal = computed(() => [...cal.value].filter((c) => Date.parse(c.endsAt) >= Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
/** This week grouped by Tehran day. */
const week = computed(() => {
  const days = new Map<string, CalendarEntry[]>();
  for (const c of nextCal.value.slice(0, 20)) {
    const k = formatJalali(c.startsAt, 'date');
    days.set(k, [...(days.get(k) ?? []), c]);
  }
  return [...days.entries()];
});
const KIND_CLASS: Record<string, string> = { match: 'is-match', practice: 'is-practice', scrim: 'is-scrim' };

// invite
const inviteOpen = ref(false);
const invite = reactive({ nickname: '', role: 'player', error: '' });
async function sendInvite() {
  invite.error = '';
  try {
    const p = await esp02.player(invite.nickname.trim());
    if (team.value?.currentMembers.some((m) => m.principalId === p.id)) { invite.error = t('tp.alreadyMember'); return; }
    await esp02.invite(teamId.value, p.id, invite.role);
    inviteOpen.value = false;
    push({ tone: 'success', message: t('tp.invited', { name: p.nickname }), duration: 4000 });
  } catch (e) {
    const err = toClientError(e);
    invite.error = err.code === 'NOT_FOUND' ? t('tp.noPlayer') : err.message;
  }
}
// calendar entry
const calOpen = ref(false);
const entry = reactive({ kind: 'practice', title: '', startsAt: null as string | null, endsAt: null as string | null, note: '' });
const entryError = computed(() => (entry.startsAt && entry.endsAt && Date.parse(entry.endsAt) <= Date.parse(entry.startsAt) ? t('tp.endAfterStart') : ''));
async function addEntry() {
  if (!entry.startsAt || !entry.endsAt || entryError.value || entry.title.trim().length < 2) return;
  await act(() => esp02.addCalendar(teamId.value, { kind: entry.kind, title: entry.title.trim(), startsAt: new Date(entry.startsAt!).toISOString(), endsAt: new Date(entry.endsAt!).toISOString(), note: entry.note.trim() || null }), t('tp.calAdded'));
  calOpen.value = false;
}
const declining = ref<JoinRequest | null>(null);
const closingAd = ref<RecruitmentAd | null>(null);
const me = computed(() => session.me?.principal.id ?? '');
</script>

<template>
  <QContainer>
    <QDataState v-if="!mine.data.value" :state="mine.error.value ? 'error' : 'loading'" :error="mine.error.value" skeleton="cards" @retry="mine.load" />
    <QEmptyState v-else-if="!teamId" icon="users" :title="t('tp.noTeam')" :description="t('tp.noTeamBody')">
      <template #action><QButton variant="green" href="/teams">{{ t('tp.findTeam') }}</QButton></template>
    </QEmptyState>
    <div v-else class="k-stack p-tp">
      <QPageHeader compact :title="t('tp.title')" :description="t('tp.lead')" :breadcrumb="[{ label: t('tp.myTeams'), href: '/account' }, { label: team?.name ?? '…' }]">
        <template #actions>
          <QButton variant="secondary" icon="external" :href="`/teams/${teamId}`">{{ t('tp.public') }}</QButton>
          <QButton icon="plus" @click="inviteOpen = true; invite.error = ''">{{ t('teams.invite') }}</QButton>
        </template>
      </QPageHeader>
      <QSelect v-if="teamOpts.length > 1" id="tp-team" :model-value="teamId" :label="t('tp.pickTeam')" :options="teamOpts" @update:model-value="pickTeam" />

      <QDataState v-if="!team" :state="error ? 'error' : 'loading'" :error="error" skeleton="cards" @retry="load" />
      <template v-else>
        <QCard>
          <div class="p-tp-id">
            <QAvatar :name="team.name" :size="72" class="q-chamfer-md" />
            <div class="k-stack p-tp-id__text">
              <h2 class="h3 p-tp-p"><bdi>{{ team.name }}</bdi> <span class="q-ltr p-tp-muted">[{{ team.tag }}]</span></h2>
              <p class="p-tp-muted">{{ t('tp.yourRole') }}: <strong>{{ myRole ? t(`tp.role.${myRole}` as never) : '—' }}</strong><template v-if="team.city"> · {{ team.city }}</template> · <span class="q-ltr">{{ team.gameId }}</span></p>
            </div>
            <div class="p-tp-tiles">
              <QStatTile :label="t('tp.members')" :value="fa(team.currentMembers.length)" icon="users" />
              <QStatTile :label="t('tp.joinWaiting')" :value="fa(joins.length)" icon="inbox" />
              <QStatTile :label="t('tp.nextItem')" :value="nextCal[0] ? formatJalali(nextCal[0].startsAt, 'time') : '—'" :caption="nextCal[0]?.title ?? t('tp.nothingPlanned')" icon="calendar" />
            </div>
          </div>
        </QCard>

        <div class="p-tp-cols">
          <div class="k-stack">
            <QCard>
              <div class="k-stack">
                <h2 class="h4 p-tp-p">{{ t('tp.roster') }}</h2>
                <QRosterList :title="false" :members="members" :empty-label="t('tp.rosterEmpty')">
                  <template #row-actions="{ member }">
                    <QButton v-if="member.id !== me" size="sm" variant="ghost" :href="`/players/${member.name}`">{{ t('tp.profile') }}</QButton>
                  </template>
                </QRosterList>
                <p v-if="team.currentMembers.length <= 1" class="p-tp-muted">{{ t('tp.rosterHint') }}</p>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <h2 class="h4 p-tp-p">{{ t('tp.regsMatches') }}</h2>
                <!-- backlog 8.4 / 8.3 -->
                <QDataState v-if="!isOn('8.4')" state="later" />
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <div class="p-tp-head"><h2 class="h4 p-tp-p">{{ t('tp.calendar') }}</h2><QButton size="sm" variant="ghost" icon="plus" @click="calOpen = true">{{ t('tp.addCal') }}</QButton></div>
                <QEmptyState v-if="!week.length" compact icon="calendar" :title="t('tp.calEmpty')" />
                <div v-for="[day, items] in week" :key="day" class="p-tp-day">
                  <span class="p-tp-day__label">{{ day }}</span>
                  <ul class="p-tp-agenda">
                    <li v-for="c in items" :key="c.id" :class="KIND_CLASS[c.kind] ?? ''">
                      <span class="p-tp-time">{{ formatJalali(c.startsAt, 'time') }}</span>
                      <span><strong><bdi>{{ c.title }}</bdi></strong><span v-if="c.note" class="p-tp-muted"><bdi>{{ c.note }}</bdi></span></span>
                      <QButton size="sm" variant="ghost" icon="trash" :aria-label="t('tp.delete')" @click="act(() => esp02.deleteCalendar(teamId, c.id), t('tp.calDeleted'))" />
                    </li>
                  </ul>
                </div>
              </div>
            </QCard>
          </div>

          <aside class="k-stack">
            <QCard>
              <div class="k-stack">
                <div class="p-tp-head"><h2 class="h4 p-tp-p">{{ t('tp.joinRequests') }}</h2><QBadge v-if="joins.length" tone="warning">{{ t('tp.waiting', { n: fa(joins.length) }) }}</QBadge></div>
                <p v-if="!joins.length" class="p-tp-muted">{{ t('tp.noJoins') }}</p>
                <div v-for="j in joins" :key="j.id" class="p-tp-req">
                  <div><code class="q-mono q-ltr">{{ j.principalId }}</code> <span class="p-tp-muted">· {{ t(`tp.role.${j.role}` as never) }} · {{ formatJalali(j.createdAt, 'date') }}</span></div>
                  <p v-if="j.message" class="p-tp-p"><bdi>{{ j.message }}</bdi></p>
                  <div class="k-row">
                    <QButton size="sm" variant="green" @click="act(() => esp02.joinRequestAction(j.id, 'accept'), t('tp.accepted'))">{{ t('tp.accept') }}</QButton>
                    <QButton size="sm" variant="secondary" @click="declining = j">{{ t('tp.decline') }}</QButton>
                  </div>
                </div>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <div class="p-tp-head"><h2 class="h4 p-tp-p">{{ t('tp.ad') }}</h2><QStatusBadge v-if="openAd" :state="openAd.state" /></div>
                <template v-if="openAd">
                  <QFacts variant="list" dense :items="[{ label: t('tp.adRole'), value: openAd.role ?? '—' }, { label: t('tp.adPosted'), value: formatJalali(openAd.createdAt, 'date') }]" />
                  <div class="k-row">
                    <QButton size="sm" variant="secondary" icon="inbox" :href="`/recruitment?ad=${openAd.id}`">{{ t('tp.reviewApps') }}</QButton>
                    <QButton v-if="openAd.state === 'open'" size="sm" variant="danger" icon="alert" @click="closingAd = openAd">{{ t('tp.closeAd') }}</QButton>
                  </div>
                </template>
                <template v-else>
                  <p class="p-tp-muted">{{ t('tp.noAd') }}</p>
                  <div><QButton size="sm" variant="secondary" icon="plus" href="/recruitment">{{ t('tp.newAd') }}</QButton></div>
                </template>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <div class="p-tp-head"><h2 class="h4 p-tp-p">{{ t('tp.scrims') }}</h2><QButton size="sm" variant="ghost" icon="plus" href="/recruitment">{{ t('tp.newScrim') }}</QButton></div>
                <p v-if="!scrims.length" class="p-tp-muted">{{ t('tp.noScrims') }}</p>
                <div v-for="s in scrims" :key="s.id" class="p-tp-req">
                  <div class="p-tp-head"><bdi>{{ s.requester.name }}</bdi><QStatusBadge :state="s.state" /></div>
                  <p class="p-tp-muted">{{ s.proposal ? formatJalali(s.proposal.proposedAt) : `${formatJalali(s.windowStart)} – ${formatJalali(s.windowEnd, 'time')}` }} · {{ t('tp.friendly') }}</p>
                  <div v-if="s.state === 'proposed' && s.requester.id === teamId" class="k-row">
                    <QButton size="sm" variant="green" @click="act(() => esp02.scrimAction(s.id, 'accept'), t('tp.scrimAccepted'))">{{ t('tp.accept') }}</QButton>
                    <QButton size="sm" variant="secondary" @click="act(() => esp02.scrimAction(s.id, 'decline'), t('tp.scrimDeclined'))">{{ t('tp.decline') }}</QButton>
                  </div>
                </div>
              </div>
            </QCard>
          </aside>
        </div>
      </template>
    </div>

    <QDialog :open="inviteOpen" size="sm" :title="t('teams.invite')" @close="inviteOpen = false">
      <form id="tp-invite" class="k-stack" novalidate @submit.prevent="sendInvite">
        <QTextField id="tp-inv-n" v-model="invite.nickname" :label="t('tp.nickname')" required ltr prefix-icon="search" :error="invite.error" />
        <QSelect id="tp-inv-r" v-model="invite.role" :label="t('tp.roleLabel')" :options="['player', 'substitute', 'coach', 'analyst'].map((r) => ({ value: r, label: t(`tp.role.${r}` as never) }))" />
        <p class="p-tp-muted">{{ t('tp.inviteHint') }}</p>
      </form>
      <template #footer>
        <QButton variant="secondary" @click="inviteOpen = false">{{ t('common.cancel') }}</QButton>
        <QButton type="submit" form="tp-invite" :disabled="invite.nickname.trim().length < 2">{{ t('tp.sendInvite') }}</QButton>
      </template>
    </QDialog>

    <QDialog :open="calOpen" size="md" :title="t('tp.addCal')" @close="calOpen = false">
      <form id="tp-cal" class="k-stack" novalidate @submit.prevent="addEntry">
        <QSelect id="tp-c-k" v-model="entry.kind" :label="t('tp.kind')" :options="['practice', 'meeting', 'other'].map((k) => ({ value: k, label: t(`tp.kind.${k}` as never) }))" />
        <QTextField id="tp-c-t" v-model="entry.title" :label="t('tp.calTitle')" required :max-length="80" />
        <div class="p-tp-grid">
          <QDateField id="tp-c-s" v-model="entry.startsAt" :label="t('tp.start')" with-time disable-past required />
          <QDateField id="tp-c-e" v-model="entry.endsAt" :label="t('tp.end')" with-time disable-past required :error="entryError" />
        </div>
        <QTextField id="tp-c-n" v-model="entry.note" :label="t('tp.note')" multiline :rows="2" :max-length="200" />
      </form>
      <template #footer>
        <QButton variant="secondary" @click="calOpen = false">{{ t('common.cancel') }}</QButton>
        <QButton type="submit" form="tp-cal" variant="green" :disabled="!entry.startsAt || !entry.endsAt || !!entryError || entry.title.trim().length < 2">{{ t('tp.save') }}</QButton>
      </template>
    </QDialog>

    <QConfirmDialog
      :open="!!declining" :require-reason="false" :title="t('tp.declineTitle')" :message="declining?.principalId ?? ''" :confirm-label="t('tp.decline')" :cancel-label="t('common.cancel')"
      @close="declining = null" @confirm="() => { const j = declining; declining = null; if (j) act(() => esp02.joinRequestAction(j.id, 'decline'), t('tp.declined')); }"
    />
    <QConfirmDialog
      :open="!!closingAd" :require-reason="false" :title="t('tp.closeAdTitle')" :message="t('tp.closeAdBody')" :confirm-label="t('tp.closeAd')" :cancel-label="t('common.cancel')"
      @close="closingAd = null" @confirm="() => { const a = closingAd; closingAd = null; if (a) act(() => esp02.closeAd(a.id), t('tp.adClosed')); }"
    />
  </QContainer>
</template>

<style scoped>
.p-tp-p { margin: 0; }
.p-tp-muted { display: block; margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-tp-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-tp-id { display: flex; flex-wrap: wrap; gap: var(--space-5); align-items: center; }
.p-tp-id__text { flex: 1 1 220px; gap: var(--space-1); }
.p-tp-tiles { display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: var(--space-3); flex: 2 1 420px; }
@media (max-width: 640px) { .p-tp-tiles { grid-template-columns: 1fr; } }
.p-tp-cols { display: grid; grid-template-columns: 1.75fr 1fr; gap: var(--space-6); align-items: start; }
@media (max-width: 1100px) { .p-tp-cols { grid-template-columns: 1fr; } }
.p-tp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-3); }
.p-tp-day { display: grid; grid-template-columns: 88px 1fr; gap: var(--space-3); padding-block: var(--space-2); border-block-end: 1px solid var(--line); }
.p-tp-day__label { font-weight: 800; font-size: 13px; }
.p-tp-agenda { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.p-tp-agenda li { display: flex; align-items: center; gap: var(--space-3); padding-inline-start: var(--space-3); border-inline-start: 3px solid var(--line); }
.p-tp-agenda li > :nth-child(2) { flex: 1; }
.p-tp-agenda li.is-match { border-inline-start-color: var(--red); }
.p-tp-agenda li.is-practice { border-inline-start-color: var(--green); }
.p-tp-agenda li.is-scrim { border-inline-start-color: var(--info-text); }
.p-tp-time { font-weight: 800; color: var(--green-text); font-size: 13px; }
.p-tp-req { display: grid; gap: var(--space-2); padding-block: var(--space-3); border-block-start: 1px solid var(--line); }
</style>
