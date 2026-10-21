<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import MoneyLabel from '../components/MoneyLabel.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';

/**
 * ADM-011 performance, satisfaction, finance, media, resource and support reports for a date range, with open
 * financial obligations always visible; sponsor export per event (facts the platform recorded, formula-safe CSV).
 */
const esp07: typeof esp07Api = esp07Api;
const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const from = ref(monthAgo);
const to = ref(today);
const report = ref<Record<string, Record<string, number | null>> | null>(null);
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);
const eventId = ref('');
async function run() {
  busy.value = true;
  failure.value = null;
  try {
    report.value = (await esp07.report(`${from.value}T00:00:00.000Z`, `${new Date(Date.parse(`${to.value}T00:00:00.000Z`) + 86_400_000).toISOString()}`)) as never;
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
const groups = ['performance', 'satisfaction', 'finance', 'media', 'resources', 'support'] as const;
const sections = computed(() => groups.map((g) => ({ g, rows: Object.entries(report.value?.[g] ?? {}) })));
const MONEY = new Set(['collectedRial', 'refundedRial', 'openPrizeObligationsRial']);
</script>

<template>
  <PageHeader :title="t('a7.reports.title')" :lead="t('a7.reports.lead')" />
  <ErrorNote :error="failure" />
  <form class="card row" @submit.prevent="run">
    <FormField id="rp-f" :label="t('a7.reports.from')"><template #default="{ id: fid }"><input :id="fid" v-model="from" type="date" class="input ltr" /></template></FormField>
    <FormField id="rp-t" :label="t('a7.reports.to')"><template #default="{ id: fid }"><input :id="fid" v-model="to" type="date" class="input ltr" /></template></FormField>
    <button type="submit" class="btn btn-primary" :disabled="busy || !from || !to">{{ t('a7.reports.run') }}</button>
  </form>
  <div v-if="report" class="grid block" role="region" :aria-label="t('a7.reports.title')">
    <section v-for="s in sections" :key="s.g" class="card stack">
      <h2>{{ t(`a7.reports.g.${s.g}` as never) }}</h2>
      <dl class="kv">
        <template v-for="[k, v] in s.rows" :key="k">
          <dt>{{ t(`a7.reports.m.${k}` as never) }}</dt>
          <dd><MoneyLabel v-if="MONEY.has(k) && typeof v === 'number'" :rial="v" /><template v-else>{{ v === null ? '—' : num(v) }}</template></dd>
        </template>
      </dl>
    </section>
  </div>
  <section class="card stack block" aria-labelledby="sp-h">
    <h2 id="sp-h">{{ t('a7.reports.sponsor') }}</h2>
    <p class="muted small">{{ t('a7.reports.sponsorLead') }}</p>
    <div class="row">
      <FormField id="sp-e" :label="t('a7.reports.event')"><template #default="{ id: fid }"><input :id="fid" v-model="eventId" class="input ltr" /></template></FormField>
      <a class="btn" :href="eventId ? esp07.sponsorCsvUrl(eventId) : undefined" :aria-disabled="!eventId" download>{{ t('a7.reports.download') }}</a>
    </div>
  </section>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: end; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: var(--sp-3); align-items: start; }
.kv { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-1) var(--sp-3); margin: 0; }
.kv dd { margin: 0; font-variant-numeric: tabular-nums; }
.block { margin-block-start: var(--sp-4); }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
