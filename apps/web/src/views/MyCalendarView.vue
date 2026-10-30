<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { zonedWallTimeToUtc } from '@esp/contracts';
import { QAlert, QBadge, QButton, QCard, QContainer, QDataState, QDateField, QIcon, QMatchCard, QPageHeader, QSection, QStatusBadge, QTextField, dateTag, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp04 as esp04Api } from '../api/esp04';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/calendar.md — SCH-004/005: my matches with confirmed vs estimated times, .ics export, reschedule requests. */
const esp04: typeof esp04Api = esp04Api;
const { push } = useToast();
const { data, loading, error, load } = useLoad(async () => ({ cal: (await esp04.calendar()).items, reqs: (await esp04.myRescheduleRequests()).items }));
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error, empty: () => !!data.value && !data.value.cal.length });
const failure = ref<ApiClientError | null>(null);
async function act(fn: () => Promise<unknown>, ok: string) {
  failure.value = null;
  try {
    await fn();
    push({ tone: 'success', message: ok, duration: 4000 });
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const req = reactive<Record<string, { at: string | null; reason: string }>>({});
const form = (id: string) => (req[id] ??= { at: null, reason: '' });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });

const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const days = computed(() => {
  const out: { key: string; at: string; items: NonNullable<typeof data.value>['cal'] }[] = [];
  for (const m of [...(data.value?.cal ?? [])].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    const k = dayKey(m.scheduledAt);
    const g = out.find((x) => x.key === k);
    if (g) g.items.push(m); else out.push({ key: k, at: m.scheduledAt, items: [m] });
  }
  return out;
});
const weekday = (iso: string) => new Intl.DateTimeFormat(dateTag(), { timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
const OPEN = ['scheduled', 'awaiting_sides', 'awaiting_readiness'];
</script>

<template>
  <QContainer>
    <div class="k-stack p-cal">
      <QPageHeader compact :title="t('cal.title')" :description="t('cal.lead')">
        <template #actions><QButton variant="secondary" icon="download" :href="esp04.calendarIcsUrl()" download>{{ t('cal.ics') }}</QButton></template>
      </QPageHeader>
      <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" skeleton="rows" icon="calendar" :empty-title="t('cl.empty')" @retry="load" />
      <template v-else>
        <section v-for="d in days" :key="d.key" class="p-cal-day" :aria-labelledby="`cd-${d.key}`">
          <h2 :id="`cd-${d.key}`" class="p-cal-dayh"><QIcon name="calendar" :size="18" />{{ weekday(d.at) }}</h2>
          <QCard v-for="m in d.items" :key="m.matchId" padding="none">
            <QMatchCard :state="m.state as never" :home="{ name: m.sides[0] }" :away="{ name: m.sides[1] }" :time="formatJalali(m.scheduledAt, 'time')" :href="`/matches/${m.matchId}`" />
            <div class="p-cal-foot">
              <QBadge :tone="m.estimated ? 'warning' : 'success'">{{ m.estimated ? t('cal.estimated') : t('cal.confirmed') }}</QBadge>
              <details v-if="OPEN.includes(m.state)" class="p-cal-more">
                <summary>{{ t('cal.requestChange') }}</summary>
                <form class="p-cal-form" novalidate @submit.prevent="act(() => esp04.reschedule(m.matchId, zonedWallTimeToUtc(form(m.matchId).at ?? ''), form(m.matchId).reason), t('cl.sent'))">
                  <QDateField :id="`rq-at-${m.matchId}`" v-model="form(m.matchId).at" :label="t('cal.newTime')" with-time />
                  <QTextField :id="`rq-r-${m.matchId}`" v-model="form(m.matchId).reason" :label="t('evm.reason')" />
                  <QButton type="submit" variant="secondary" size="sm" :disabled="!form(m.matchId).at || form(m.matchId).reason.length < 5">{{ t('cal.send') }}</QButton>
                </form>
              </details>
            </div>
          </QCard>
        </section>
        <QSection v-if="data.reqs.length" id="requests" small :title="t('cal.requests')" :description="t('cal.agreeHint')">
          <QCard>
            <ul class="p-cal-rows">
              <li v-for="r in data.reqs" :key="String(r._id)">
                <span>{{ formatJalali(String(r.proposedAt)) }} — <span dir="auto">{{ r.reason }}</span></span>
                <span class="k-row">
                  <QStatusBadge :state="String(r.state)" />
                  <QButton v-if="r.state === 'open'" variant="green" size="sm" @click="act(() => esp04.agreeReschedule(String(r._id)), t('cl.agreed'))">{{ t('cal.agree') }}</QButton>
                </span>
              </li>
            </ul>
          </QCard>
        </QSection>
      </template>
    </div>
  </QContainer>
</template>

<style scoped>
.p-cal { gap: var(--space-6); }
.p-cal-day { display: flex; flex-direction: column; gap: var(--space-3); }
.p-cal-dayh { margin: 0; display: flex; align-items: center; gap: var(--space-2); font-size: 15px; font-weight: 800; color: var(--green-text); }
.p-cal-foot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-block-start: 1px solid var(--line); }
.p-cal-more { flex: 1 1 100%; }
.p-cal-more summary { cursor: pointer; min-block-size: 44px; display: flex; align-items: center; font-weight: 700; color: var(--green-text); }
.p-cal-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
.p-cal-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-cal-rows li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); font-size: 14px; }
@media (max-width: 720px) { .p-cal-form { grid-template-columns: minmax(0, 1fr); } }
</style>
