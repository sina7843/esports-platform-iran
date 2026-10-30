<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Grant, Session } from '@esp/contracts';
import {
  QAvatar, QBadge, QButton, QCard, QConfirmDialog, QContainer, QDataState, QDataTable, QDiscoveryCard, QFacts, QIcon, QPageHeader, QSection,
  fa, formatJalali, useToast, type QDataTableColumn,
} from '@esp/ui';
import { api } from '../api/client';
import { esp02 } from '../api/esp02';
import { esp03 } from '../api/esp03';
import { esp04 } from '../api/esp04';
import { esp06 } from '../api/esp06';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { resetSession, session } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/account.md — identity summary, quick links, sessions and permissions. */
const router = useRouter();
const { push } = useToast();
const me = computed(() => session.me);
const sessions = useLoad(() => api.sessions());
const sds = useDataState({ loading: sessions.loading, error: sessions.error });
const settle = <T,>(p: Promise<T>) => p.then((v) => v, () => null);
const summary = useLoad(async () => {
  const [mfa, teams, regs, cal, ntf] = await Promise.all([
    settle(esp02.mfa()), settle(esp02.myTeams()), settle(esp03.myRegistrations()), settle(esp04.calendar()), settle(esp06.notifications({ unread: true })),
  ]);
  return {
    mfa: mfa?.enabled ?? null,
    team: teams?.items[0] ?? null,
    awaiting: regs?.items.filter((r) => r.state === 'awaiting_payment').length ?? 0,
    next: cal?.items.filter((m) => new Date(m.scheduledAt).getTime() > Date.now()).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]?.scheduledAt ?? null,
    unread: ntf?.unread ?? 0,
  };
});

async function logout() {
  try {
    await api.logout();
    resetSession();
    await router.push('/');
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
const ending = ref<Session | null>(null);
const endingOthers = ref(false);
const busy = ref(false);
async function confirmEnd() {
  if (!ending.value) return;
  busy.value = true;
  try {
    await api.revokeSession(ending.value.id);
    push({ tone: 'success', message: t('ac.ended'), duration: 4000 });
    ending.value = null;
    await sessions.load();
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  } finally {
    busy.value = false;
  }
}
async function confirmOthers() {
  busy.value = true;
  try {
    await esp02.logoutOthers();
    push({ tone: 'success', message: t('ac.othersEnded'), duration: 4000 });
    endingOthers.value = false;
    await sessions.load();
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  } finally {
    busy.value = false;
  }
}

function device(ua: string | null): string {
  if (!ua) return t('ac.unknownDevice');
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [b, o].filter(Boolean).join(' · ') || t('ac.unknownDevice');
}
const deviceIcon = (ua: string | null) => (/Android|iPhone|Mobile/.test(ua ?? '') ? 'smartphone' : /iPad|Tablet/.test(ua ?? '') ? 'tablet' : 'monitor');
const live = computed(() => (sessions.data.value?.items ?? []).filter((s) => !s.revokedAt));
const others = computed(() => live.value.filter((s) => !s.current).length);
const sessionCols = computed<QDataTableColumn<Session>[]>(() => [
  { key: 'device', header: t('ac.device') },
  { key: 'createdAt', header: t('ac.signedIn') },
  { key: 'lastSeenAt', header: t('ac.lastSeen') },
  { key: 'expiresAt', header: t('ac.expires') },
]);
const grants = computed(() => (me.value?.grants ?? []).filter((g) => !g.revokedAt));
const grantCols = computed<QDataTableColumn<Grant>[]>(() => [
  { key: 'role', header: t('ac.role') },
  { key: 'scope', header: t('ac.scope') },
  { key: 'grantedAt', header: t('ac.from') },
  { key: 'expiresAt', header: t('ac.expires') },
]);
const human = (s: string) => s.replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const facts = computed(() => {
  const p = me.value?.principal;
  if (!p) return [];
  return [
    { label: t('ac.displayName'), value: p.displayName },
    { label: t('ac.id'), value: p.id, ltr: true },
    { label: t('ac.localeTz'), value: `${p.locale === 'en' ? 'English' : 'فارسی'} · ${p.timeZone}` },
    { label: t('ac.kind'), value: human(p.kind) },
  ];
});
</script>

<template>
  <QContainer>
    <div class="k-stack p-account">
      <QPageHeader compact :title="t('ac.title')" :description="t('ac.desc')">
        <template #actions><QButton variant="secondary" icon="logout" @click="logout">{{ t('ac.logout') }}</QButton></template>
      </QPageHeader>

      <QCard v-if="me" padding="lg">
        <div class="p-account-id">
          <QAvatar :name="me.principal.displayName" :size="72" />
          <div class="p-account-id__who">
            <h2 class="p-account-id__name"><bdi>{{ me.principal.displayName }}</bdi></h2>
            <div class="p-account-id__badges">
              <QBadge v-if="summary.data.value?.team" tone="neutral" icon="users">{{ t(`role.${summary.data.value.team.role}` as never) }} · <bdi>{{ summary.data.value.team.name }}</bdi></QBadge>
              <QBadge v-if="summary.data.value?.mfa === true" tone="success" icon="lock">{{ t('ac.mfaOn') }}</QBadge>
              <QBadge v-else-if="summary.data.value?.mfa === false" tone="warning" icon="lock">{{ t('ac.mfaOff') }}</QBadge>
            </div>
          </div>
          <div class="p-account-id__actions">
            <QButton variant="secondary" icon="edit" href="/account/profile">{{ t('ac.editProfile') }}</QButton>
            <QButton variant="ghost" icon="lock" href="/account/security">{{ t('ac.security') }}</QButton>
          </div>
        </div>
        <QFacts class="p-account-facts" :columns="4" dense :items="facts" />
      </QCard>

      <nav :aria-label="t('ac.quick')">
        <div class="k-grid--4 p-account-quick">
          <QDiscoveryCard icon="ticket" :title="t('ac.qReg')" :description="t('ac.qRegDesc')" href="/account/registrations" :heading-level="3">
            <template v-if="summary.data.value?.awaiting" #meta><QBadge tone="warning" dot>{{ t('ac.awaitingPay', { n: fa(summary.data.value.awaiting) }) }}</QBadge></template>
          </QDiscoveryCard>
          <QDiscoveryCard icon="users" :title="t('ac.qTeams')" :description="t('ac.qTeamsDesc')" href="/teams" :heading-level="3">
            <template v-if="summary.data.value?.team" #meta><bdi>{{ summary.data.value.team.name }}</bdi> · <bdi class="q-ltr">{{ summary.data.value.team.tag }}</bdi></template>
          </QDiscoveryCard>
          <QDiscoveryCard icon="calendar" :title="t('ac.qCal')" :description="t('ac.qCalDesc')" href="/account/calendar" :heading-level="3">
            <template v-if="summary.data.value?.next" #meta><span class="p-account-next">{{ t('ac.next', { when: formatJalali(summary.data.value.next, 'datetime') }) }}</span></template>
          </QDiscoveryCard>
          <QDiscoveryCard icon="bell" :title="t('ac.qNtf')" :description="t('ac.qNtfDesc')" href="/account/notifications" :heading-level="3">
            <template v-if="summary.data.value?.unread" #meta><QBadge tone="green">{{ t('ac.unread', { n: fa(summary.data.value.unread) }) }}</QBadge></template>
          </QDiscoveryCard>
        </div>
      </nav>

      <QSection id="sessions" small :title="t('ac.sessions')" :description="t('ac.sessionsDesc')">
        <template #action><QButton variant="danger" icon="logout" :disabled="!others" @click="endingOthers = true">{{ t('ac.logoutOthers') }}</QButton></template>
        <QDataState v-if="sds.state.value !== 'content'" v-bind="sds.props.value" skeleton="rows" @retry="sessions.load" />
        <QDataTable v-else :caption="t('ac.sessions')" caption-hidden row-key="id" row-header="device" :columns="sessionCols" :rows="live">
          <template #cell-device="{ row }">
            <span class="p-account-device">
              <span class="p-account-device__name"><QIcon :name="deviceIcon(row.userAgent)" :size="18" />{{ device(row.userAgent) }}<QBadge v-if="row.current" tone="green" dot>{{ t('ac.current') }}</QBadge></span>
              <span v-if="row.userAgent" class="p-account-device__ua q-ltr" :title="row.userAgent">{{ row.userAgent }}</span>
            </span>
          </template>
          <template #cell-createdAt="{ row }"><span class="p-account-when"><span>{{ formatJalali(row.createdAt, 'date') }}</span><span>{{ formatJalali(row.createdAt, 'time') }}</span></span></template>
          <template #cell-lastSeenAt="{ row }">{{ formatJalali(row.lastSeenAt, 'relative') }}</template>
          <template #cell-expiresAt="{ row }"><span class="p-account-nowrap">{{ formatJalali(row.expiresAt, 'date') }}</span></template>
          <template #row-actions="{ row }">
            <span v-if="row.current" class="p-account-muted">{{ t('ac.thisDevice') }}</span>
            <QButton v-else variant="danger" size="sm" @click="ending = row">{{ t('ac.end') }}</QButton>
          </template>
        </QDataTable>
      </QSection>

      <QSection id="perms" small :title="t('ac.perms')" :description="t('ac.permsDesc')">
        <p v-if="!grants.length" class="p-account-note">{{ t('ac.noPerms') }}</p>
        <QDataTable v-else :caption="t('ac.perms')" caption-hidden row-key="id" row-header="role" :columns="grantCols" :rows="grants">
          <template #cell-role="{ row }"><span class="p-account-role"><strong>{{ human(row.role) }}</strong><code class="q-ltr">{{ row.role }}</code></span></template>
          <!-- OPEN-QUESTION(account): scope display labels need backlog 0.2 / account spec addition; the raw scope is shown. -->
          <template #cell-scope="{ row }"><span class="p-account-scope q-ltr">{{ row.scope.type }}:{{ row.scope.id }}</span></template>
          <template #cell-grantedAt="{ row }">{{ formatJalali(row.grantedAt, 'date') }}</template>
          <template #cell-expiresAt="{ row }">
            <span v-if="row.expiresAt" class="p-account-expiring">{{ formatJalali(row.expiresAt, 'date') }}</span>
            <span v-else class="p-account-muted">{{ t('ac.noExpiry') }}</span>
          </template>
        </QDataTable>
      </QSection>
    </div>
    <QConfirmDialog
      :open="!!ending" icon="logout" :title="t('ac.endTitle')" :message="ending ? t('ac.endBody', { device: device(ending.userAgent) }) : ''"
      :confirm-label="t('ac.confirmEnd')" :cancel-label="t('ac.cancel')" :loading="busy" @close="ending = null" @confirm="confirmEnd"
    />
    <QConfirmDialog
      :open="endingOthers" icon="logout" :title="t('ac.othersTitle')" :message="t('ac.othersBody')"
      :confirm-label="t('ac.confirmOthers')" :cancel-label="t('ac.cancel')" :loading="busy" @close="endingOthers = false" @confirm="confirmOthers"
    />
  </QContainer>
</template>

<style scoped>
.p-account { gap: var(--space-7); }
.p-account-id { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-5); align-items: center; }
.p-account-id__who { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.p-account-id__name { margin: 0; font-size: 22px; line-height: 34px; font-weight: 900; }
.p-account-id__badges { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block-start: var(--space-2); }
.p-account-id__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.p-account-facts { margin-block-start: var(--space-5); }
.p-account-quick { display: grid; gap: var(--space-4); }
.p-account-next { color: var(--green-text); }
.p-account-device { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
.p-account-device__name { display: inline-flex; align-items: center; gap: var(--space-2); font-weight: 800; }
.p-account-device__ua { display: block; max-width: 30ch; font-size: 12px; color: var(--ink-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-account-role { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.p-account-role code, .p-account-scope { font-family: var(--font-mono); font-size: 12px; color: var(--ink-subtle); }
.p-account-note { margin: 0; font-size: 13px; color: var(--ink-subtle); }
.p-account-muted { color: var(--ink-subtle); }
.p-account-expiring { color: var(--warning-text); }
.p-account-nowrap { white-space: nowrap; }
.p-account-when { display: inline-flex; flex-direction: column; white-space: nowrap; }
@media (max-width: 720px) {
  .p-account-id { grid-template-columns: auto minmax(0, 1fr); }
  .p-account-id__actions { grid-column: 1 / -1; }
  .p-account-id__actions > * { flex: 1 1 auto; }
}
</style>
