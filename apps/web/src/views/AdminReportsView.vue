<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { zonedWallTimeToUtc } from '@esp/contracts';
import { QAlert, QButton, QCard, QContainer, QDataState, QDateField, QFacts, QIcon, QPageHeader, QSection, QSegmentedControl, QSelect, dec, fa, formatJalali, num, toman, type IconName } from '@esp/ui';
import { api, type ApiClientError } from '../api/client';
import { esp07 } from '../api/esp07';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { can } from '../session';

/**
 * Spec docs/redesign/03-specs/admin-reports.md — ADM-011 reports for a Tehran-time date range, open obligations always
 * visible, sponsor export per event (formula-safe CSV from the server).
 */
const tehranDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const today = tehranDay(new Date());
const daysAgo = (n: number) => tehranDay(new Date(Date.now() - n * 86_400_000));
const from = ref<string | null>(daysAgo(30));
const to = ref<string | null>(today);
const quick = ref('30');
const report = ref<Record<string, Record<string, number | null>> | null>(null);
const builtAt = ref('');
const range = ref({ from: '', to: '' });
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);

async function run() {
  if (!from.value || !to.value) return;
  busy.value = true;
  failure.value = null;
  try {
    const f = zonedWallTimeToUtc(`${from.value}T00:00`);
    const end = zonedWallTimeToUtc(`${to.value}T00:00`);
    report.value = (await esp07.report(f, new Date(Date.parse(end) + 86_400_000).toISOString())) as never;
    builtAt.value = new Date().toISOString();
    range.value = { from: f, to: end };
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
function setQuick(v: string | undefined) {
  if (!v) return;
  quick.value = v;
  from.value = daysAgo(Number(v));
  to.value = today;
  void run();
}
onMounted(run);

const GROUPS: { key: string; icon: IconName }[] = [
  { key: 'performance', icon: 'activity' }, { key: 'satisfaction', icon: 'star' }, { key: 'finance', icon: 'wallet' },
  { key: 'media', icon: 'news' }, { key: 'resources', icon: 'server' }, { key: 'support', icon: 'inbox' },
];
function value(k: string, v: number | null): string {
  if (v == null) return '—';
  if (k.endsWith('Rial')) return toman(v);
  if (k === 'average') return t('ar.of5', { n: dec(v, 1) });
  return num(v);
}
const sections = computed(() => GROUPS.map((g) => ({
  ...g,
  items: Object.entries(report.value?.[g.key] ?? {}).map(([k, v]) => ({ label: t(`a7.reports.m.${k}` as MessageKey), value: value(k, v) })),
})));
const obligations = computed(() => report.value?.finance ?? null);

// OPEN-QUESTION(admin-reports): admin listing of private/finished events is a backlog addition; the public list is used.
const events = ref<{ value: string; label: string }[]>([]);
const eventId = ref('');
onMounted(async () => {
  try {
    events.value = (await api.events(undefined, 50)).items.map((e) => ({ value: e.id, label: e.name }));
  } catch {
    /* the export picker stays empty */
  }
});
</script>

<template>
  <QContainer>
    <div class="k-stack p-admin-reports">
      <QPageHeader compact :title="t('a7.reports.title')" :description="t('a7.reports.lead')" :breadcrumb="can('platform.settings') ? [{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('a7.reports.title') }] : undefined" />
      <QCard>
        <form class="p-admin-reports-form" @submit.prevent="run">
          <QDateField id="rp-f" v-model="from" :label="t('a7.reports.from')" :max="to ?? today" />
          <QDateField id="rp-t" v-model="to" :label="t('a7.reports.to')" :max="today" />
          <QButton variant="primary" type="submit" icon="chart" :loading="busy">{{ t('a7.reports.run') }}</QButton>
        </form>
        <div class="p-admin-reports-quick">
          <span class="p-admin-reports-sub">{{ t('ar.quick') }}</span>
          <QSegmentedControl size="sm" :aria-label="t('ar.quick')" :model-value="quick" :options="[{ value: '7', label: t('ar.d7') }, { value: '30', label: t('ar.d30') }, { value: '90', label: t('ar.d90') }]" @update:model-value="setQuick" />
          <span class="p-admin-reports-sub">{{ t('ar.tzNote') }}</span>
        </div>
      </QCard>

      <QAlert v-if="obligations && (obligations.openPrizeObligations ?? 0) > 0" tone="warning" icon="wallet" :title="t('ar.obligations')" :actions="[{ label: t('ar.finance'), href: '/finance' }]">
        {{ t('ar.obligationsBody', { n: fa(obligations.openPrizeObligations ?? 0), amount: toman(obligations.openPrizeObligationsRial ?? 0) }) }}
      </QAlert>

      <QDataState v-if="failure || (busy && !report)" :state="failure ? (failure.code === 'NETWORK' ? 'offline' : failure.code === 'FORBIDDEN' ? 'forbidden' : 'error') : 'loading'" :request-id="failure?.requestId ?? undefined" @retry="run" />
      <QSection v-else-if="report" id="report" small :title="t('ar.heading', { from: formatJalali(range.from, 'date'), to: formatJalali(range.to, 'date') })" :description="builtAt ? formatJalali(builtAt, 'time') : undefined">
        <div class="p-admin-reports-grid">
          <QCard v-for="g in sections" :key="g.key">
            <div class="p-admin-reports-group">
              <div class="p-admin-reports-ghead"><QIcon :name="g.icon" :size="20" /><h3>{{ t(`a7.reports.g.${g.key}` as MessageKey) }}</h3></div>
              <QFacts v-if="g.items.length" variant="list" dense :items="g.items" />
              <p v-else class="p-admin-reports-sub">{{ t('ar.empty') }}</p>
            </div>
          </QCard>
        </div>
        <p class="p-admin-reports-note"><QIcon name="info" :size="16" />{{ t('ar.note') }}</p>
      </QSection>

      <QSection id="sponsor" small :title="t('a7.reports.sponsor')">
        <QCard>
          <div class="k-stack">
            <p class="p-admin-reports-note"><QIcon name="shield" :size="16" />{{ t('ar.exportNote') }}</p>
            <div class="p-admin-reports-export">
              <QSelect v-model="eventId" :label="t('ar.event')" :placeholder="t('ar.chooseEvent')" required :options="events" />
              <QButton variant="secondary" icon="download" :disabled="!eventId" :href="eventId ? esp07.sponsorCsvUrl(eventId) : undefined" download>{{ t('a7.reports.download') }}</QButton>
            </div>
            <div>
              <h3 class="p-admin-reports-sub">{{ t('ar.cols') }}</h3>
              <ul class="p-admin-reports-cols">
                <li>{{ t('ar.c1') }}</li><li>{{ t('ar.c2') }}</li><li>{{ t('ar.c3') }}</li><li>{{ t('ar.c4') }}</li><li>{{ t('ar.c5') }}</li>
              </ul>
            </div>
          </div>
        </QCard>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-admin-reports { gap: var(--space-7); }
.p-admin-reports-form { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; }
.p-admin-reports-quick { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-block-start: var(--space-4); }
.p-admin-reports-sub { margin: 0; font-size: 12px; color: var(--ink-subtle); }
.p-admin-reports-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.p-admin-reports-group { display: flex; flex-direction: column; gap: var(--space-3); }
.p-admin-reports-ghead { display: flex; align-items: center; gap: var(--space-2); }
.p-admin-reports-ghead .q-icon { color: var(--green-text); }
.p-admin-reports-ghead h3 { margin: 0; font-size: 16px; font-weight: 900; }
.p-admin-reports-note { display: flex; align-items: flex-start; gap: var(--space-2); margin: 0; font-size: 13px; line-height: 22px; color: var(--ink-subtle); }
.p-admin-reports-note .q-icon { flex: none; margin-block-start: 3px; }
.p-admin-reports-export { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr) auto; align-items: end; }
.p-admin-reports-cols { margin: 0; padding-inline-start: var(--space-5); font-size: 13px; line-height: 22px; color: var(--ink-muted); columns: 2; }
@media (max-width: 1100px) { .p-admin-reports-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .p-admin-reports-form, .p-admin-reports-export { grid-template-columns: minmax(0, 1fr); } .p-admin-reports-grid { grid-template-columns: minmax(0, 1fr); } .p-admin-reports-cols { columns: 1; } }
</style>
