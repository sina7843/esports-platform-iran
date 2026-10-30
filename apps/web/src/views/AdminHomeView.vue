<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { QButton, QCard, QDataState, QEmptyState, QFacts, QIcon, QOpsAlert, QPageHeader, QQueueItem, QSection, QServiceHealth, fa, formatJalali, useToast, type IconName } from '@esp/ui';
import { api } from '../api/client';
import { esp02 } from '../api/esp02';
import { esp03 } from '../api/esp03';
import { esp07 } from '../api/esp07';
import { isOn } from '../features';
import { t, type MessageKey } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * Platform admin home: queues waiting for action (counts are only the items each first page returned — never
 * platform totals), what needs attention by SLA, service health and quick links.
 * OPEN-QUESTION: backlog 18.2 — no `GET /admin/audit` yet, so recent audit events show the `later` state.
 * OPEN-QUESTION: backlog 18.1 — `GET /admin/queue-summary` would replace the six requests below.
 * OPEN-QUESTION: alert acknowledgement has no API; «تأیید دریافت» is kept for this session only.
 */
const { push } = useToast();
const reviews = useLoad(() => esp02.accountReviews());
const ids = useLoad(() => esp02.pendingGameIdentities());
const apps = useLoad(() => esp02.organizerApplications());
const affs = useLoad(() => esp03.pendingAffiliations());
const tickets = useLoad(() => esp07.ticketQueue());
const approvals = useLoad(() => api.approvals('site', 'site'));
const dead = useLoad(() => esp07.deliveries('dead'));
const health = useLoad(() => esp07.health());
const loads = [reviews, ids, apps, affs, tickets, approvals, dead, health];
const refreshing = ref(false);
const lastAt = ref(new Date().toISOString());
async function refresh(toast = true) {
  refreshing.value = true;
  await Promise.all(loads.map((l) => l.load()));
  lastAt.value = new Date().toISOString();
  refreshing.value = false;
  if (toast) push({ tone: 'success', message: t('adminHome.refreshed'), duration: 4000 });
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(false); }, 60_000);
});
onBeforeUnmount(() => clearInterval(timer));

const len = <T,>(d: { items: T[] } | null | undefined, f: (x: T) => boolean = () => true) => (d?.items ?? []).filter(f).length;
const openTickets = computed(() => (tickets.data.value?.items ?? []).filter((x) => x.state === 'open' || x.state === 'pending'));
const pendingApprovals = computed(() => (approvals.data.value?.items ?? []).filter((a) => a.state === 'pending'));
const tiles = computed(() => [
  {
    key: 'reviews', href: '/admin/reviews', icon: 'shield' as IconName, label: t('adminHome.tile.reviews'),
    count: len(reviews.data.value, (r) => r.state === 'open') + len(ids.data.value) + len(apps.data.value, (a) => !['approved', 'rejected'].includes(a.state)) + len(affs.data.value),
    lines: [
      t('adminHome.line.accounts', { n: fa(len(reviews.data.value, (r) => r.state === 'open')) }),
      t('adminHome.line.ids', { n: fa(len(ids.data.value)) }),
      t('adminHome.line.apps', { n: fa(len(apps.data.value, (a) => !['approved', 'rejected'].includes(a.state))) }),
    ],
    loading: reviews.loading.value && !reviews.data.value,
  },
  {
    key: 'tickets', href: '/admin/tickets', icon: 'inbox' as IconName, label: t('adminHome.tile.tickets'), count: openTickets.value.length,
    lines: [
      t('adminHome.line.overdue', { n: fa(openTickets.value.filter((x) => x.overdue).length) }),
      t('adminHome.line.unassigned', { n: fa(openTickets.value.filter((x) => !x.assigneeId).length) }),
    ],
    loading: tickets.loading.value && !tickets.data.value,
  },
  {
    key: 'approvals', href: '/finance/approvals', icon: 'check-circle' as IconName, label: t('adminHome.tile.approvals'), count: pendingApprovals.value.length,
    lines: [t('adminHome.line.secondApproval')], loading: approvals.loading.value && !approvals.data.value,
  },
  {
    key: 'webhooks', href: '/admin/integrations', icon: 'link' as IconName, label: t('adminHome.tile.webhooks'), count: len(dead.data.value),
    lines: [t('adminHome.line.deadOutbox', { n: fa(health.data.value?.outbox['dead_letter'] ?? 0) })], loading: dead.loading.value && !dead.data.value,
  },
]);
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const attention = computed(() => [...openTickets.value]
  .sort((a, b) => (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) || a.slaDueAt.localeCompare(b.slaDueAt))
  .slice(0, 4));
const slaMinutes = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 60_000);

const statusOf = (s: string) => (['healthy', 'ok', 'up'].includes(s) ? 'ok' : ['degraded', 'slow'].includes(s) ? 'degraded' : ['down', 'failed', 'unhealthy'].includes(s) ? 'down' : 'unconfigured') as 'ok' | 'degraded' | 'down' | 'unconfigured';
const ORDER = { down: 0, degraded: 1, unconfigured: 2, ok: 3 };
const providers = computed(() => [...(health.data.value?.providers ?? [])].sort((a, b) => ORDER[statusOf(a.status)] - ORDER[statusOf(b.status)]).slice(0, 5));
const acked = ref(new Set<string>());
const healthFacts = computed(() => {
  const h = health.data.value;
  if (!h) return [];
  return [
    { label: t('adminHome.outboxLag'), value: t('adminHome.seconds', { n: fa(h.outboxLagSeconds) }) },
    { label: t('adminHome.lastBackup'), value: h.lastBackup ? formatJalali(h.lastBackup.at) : '—' },
    { label: t('adminHome.disk'), value: h.disk ? `${fa(h.disk.usedPct)}٪` : '—' },
  ];
});
const LINKS: Array<{ href: string; icon: IconName; title: MessageKey; line: MessageKey }> = [
  { href: '/admin/users', icon: 'users', title: 'adminHome.ql.users', line: 'adminHome.ql.usersLine' },
  { href: '/admin/reviews', icon: 'shield', title: 'adminHome.ql.reviews', line: 'adminHome.ql.reviewsLine' },
  { href: '/admin/tickets', icon: 'inbox', title: 'adminHome.ql.tickets', line: 'adminHome.ql.ticketsLine' },
  { href: '/admin/tasks', icon: 'list', title: 'adminHome.ql.tasks', line: 'adminHome.ql.tasksLine' },
  { href: '/admin/ops', icon: 'activity', title: 'adminHome.ql.ops', line: 'adminHome.ql.opsLine' },
  { href: '/admin/settings', icon: 'settings', title: 'adminHome.ql.settings', line: 'adminHome.ql.settingsLine' },
  { href: '/admin/privacy', icon: 'lock', title: 'adminHome.ql.privacy', line: 'adminHome.ql.privacyLine' },
  { href: '/admin/integrations', icon: 'link', title: 'adminHome.ql.integrations', line: 'adminHome.ql.integrationsLine' },
  { href: '/admin/reports', icon: 'chart', title: 'adminHome.ql.reports', line: 'adminHome.ql.reportsLine' },
];
</script>

<template>
  <div class="k-container">
    <div class="k-stack p-ah">
      <QPageHeader compact :title="t('nav.admin')" :description="t('adminHome.lead')">
        <template #meta>{{ t('adminHome.updated', { at: formatJalali(lastAt, 'time') }) }}</template>
        <template #actions><QButton variant="secondary" size="sm" icon="refresh" :loading="refreshing" @click="refresh()">{{ t('a7.refresh') }}</QButton></template>
      </QPageHeader>

      <QSection id="queues" :title="t('adminHome.queues')" :description="t('adminHome.queuesNote')">
        <div class="p-ah-tiles">
          <RouterLink v-for="tile in tiles" :key="tile.key" :to="tile.href" class="p-ah-tile">
            <span class="p-ah-tile__head"><span class="p-ah-tile__label">{{ tile.label }}</span><span class="p-ah-tile__icon"><QIcon :name="tile.icon" :size="20" /></span></span>
            <span class="p-ah-tile__count">{{ tile.loading ? '…' : fa(tile.count) }}</span>
            <span v-if="!tile.loading && !tile.count" class="p-ah-muted">{{ t('adminHome.noQueue') }}</span>
            <ul v-else class="p-ah-tile__lines"><li v-for="l in tile.lines" :key="l">{{ l }}</li></ul>
            <span class="p-ah-tile__go">{{ t('adminHome.go') }} <QIcon name="arrow-left" :size="16" /></span>
          </RouterLink>
        </div>
      </QSection>

      <div class="p-ah-cols">
        <QCard>
          <div class="k-stack">
            <div class="p-ah-head"><h2 class="h4 p-ah-p">{{ t('adminHome.attention') }}</h2><QButton variant="ghost" size="sm" href="/admin/tickets">{{ t('adminHome.allQueues') }}</QButton></div>
            <QDataState v-if="tickets.error.value || (!tickets.data.value && tickets.loading.value)" :state="tickets.error.value ? 'error' : 'loading'" :error="tickets.error.value" skeleton="rows" @retry="tickets.load" />
            <QEmptyState v-else-if="!attention.length" compact icon="check-circle" :title="t('adminHome.attentionEmpty')" :description="t('adminHome.attentionEmptyBody')" />
            <ul v-else class="p-ah-queue">
              <li v-for="x in attention" :key="x._id">
                <QQueueItem
                  :subject="x.subject" :category="t(`a7.cat.${x.category}` as never)" :priority="x.priority as never" :priority-label="t(`a7.prio.${x.priority}` as never)"
                  :sla-minutes="slaMinutes(x.slaDueAt)" :assignee="x.assigneeId ? { name: x.assigneeId } : null" :reference="x._id" :href="`/admin/tickets?id=${x._id}`"
                />
              </li>
            </ul>
          </div>
        </QCard>
        <QCard>
          <div class="k-stack">
            <div class="p-ah-head"><h2 class="h4 p-ah-p">{{ t('a7.health.title') }}</h2><QButton variant="ghost" size="sm" href="/admin/ops">{{ t('adminHome.details') }}</QButton></div>
            <QDataState v-if="!health.data.value" :state="health.error.value ? 'error' : 'loading'" :error="health.error.value" skeleton="rows" @retry="health.load" />
            <template v-else>
              <QOpsAlert
                v-for="a in health.data.value.alerts" :key="a.kind" :severity="a.level === 'critical' ? 'critical' : 'warning'"
                :severity-label="a.level === 'critical' ? t('a7.ops.critical') : t('a7.ops.warn')" :title="a.kind" :detail="a.detail"
                :acknowledged="acked.has(a.kind)" @ack="acked = new Set([...acked, a.kind])"
              />
              <QServiceHealth v-for="p in providers" :key="p.kind" :name="p.kind" :kind="p.adapter" :status="statusOf(p.status)" :detail="p.detail" />
              <QFacts variant="list" dense :items="healthFacts" />
            </template>
          </div>
        </QCard>
      </div>

      <QSection id="audit" :title="t('adminHome.audit')" :description="t('adminHome.auditNote')">
        <template #action><QButton variant="ghost" size="sm" icon="shield" href="/admin/ops">{{ t('adminHome.verifyChain') }}</QButton></template>
        <!-- backlog 18.2: GET /admin/audit does not exist yet -->
        <QDataState v-if="!isOn('18.2')" state="later" />
      </QSection>

      <QSection id="links" :title="t('adminHome.quickLinks')">
        <nav class="p-ah-links" :aria-label="t('adminHome.quickLinks')">
          <RouterLink v-for="l in LINKS" :key="l.href" :to="l.href" class="p-ah-link">
            <span class="p-ah-tile__icon"><QIcon :name="l.icon" :size="20" /></span>
            <span><strong>{{ t(l.title) }}</strong><span class="p-ah-muted">{{ t(l.line) }}</span></span>
          </RouterLink>
        </nav>
      </QSection>
    </div>
  </div>
</template>

<style scoped>
.p-ah { gap: var(--space-7); }
.p-ah-p { margin: 0; }
.p-ah-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-ah-muted { display: block; margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-ah-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-4); }
@media (max-width: 1180px) { .p-ah-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .p-ah-tiles { grid-template-columns: 1fr; } }
.p-ah-tile { display: flex; flex-direction: column; gap: var(--space-2); min-block-size: 196px; padding: var(--space-5); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); color: var(--ink); text-decoration: none; box-shadow: var(--shadow-raised); transition: border-color 0.15s, box-shadow 0.15s; }
.p-ah-tile:hover { border-color: var(--green); box-shadow: var(--shadow-overlay); }
.p-ah-tile:focus-visible, .p-ah-link:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
.p-ah-tile__head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
.p-ah-tile__label { font-weight: 800; font-size: 14px; }
.p-ah-tile__icon { display: inline-grid; place-items: center; inline-size: 36px; block-size: 36px; flex: none; border-radius: var(--radius-md); background: var(--green-soft); color: var(--green-text); }
.p-ah-tile__count { font-size: 38px; font-weight: 900; line-height: 1.1; }
@media (max-width: 560px) { .p-ah-tile__count { font-size: 30px; } }
.p-ah-tile__lines { margin: 0; padding: 0; list-style: none; color: var(--ink-muted); font-size: 13px; display: grid; gap: var(--space-1); }
.p-ah-tile__go { margin-block-start: auto; display: inline-flex; align-items: center; gap: var(--space-1); color: var(--green-text); font-weight: 800; font-size: 13px; }
.p-ah-cols { display: grid; grid-template-columns: 1.6fr 1fr; gap: var(--space-5); align-items: start; }
@media (max-width: 960px) { .p-ah-cols { grid-template-columns: 1fr; } }
.p-ah-queue { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-3); }
.p-ah-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
@media (max-width: 960px) { .p-ah-links { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .p-ah-links { grid-template-columns: 1fr; } }
.p-ah-link { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); color: var(--ink); text-decoration: none; }
.p-ah-link:hover { background: var(--surface-sunken); }
</style>
