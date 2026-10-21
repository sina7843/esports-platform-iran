<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api, type Obj } from '../api/esp07';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * ADM-012 for the account holder: accept the current terms/privacy text, withdraw optional consents, export my data
 * (immediate), request correction or deletion (deletion waits while a legal hold or open case applies), and appeal a
 * moderation decision about my content (ADM-009).
 */
const esp07: typeof esp07Api = esp07Api;
const pending = useLoad(() => esp07.legalPending());
const consents = useLoad(() => esp07.consents());
const requests = useLoad(() => esp07.myRequests());
const marketing = useLoad(() => esp07.legal('consent_marketing'));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>, reload: Array<() => Promise<void>>, ok = t('a7.saved')) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    for (const r of reload) await r();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const detail = reactive({ correction: '', deletion: '' });
const confirmDelete = ref(false);
function download(data: Obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-data.json';
  a.click();
  URL.revokeObjectURL(url);
}
const exportNow = () =>
  act(async () => {
    const r = await esp07.createRequest('export', '');
    if (r.export) download(r.export);
  }, [requests.load], t('a7.me.exported'));
const appealId = ref('');
const appealText = ref('');
const activeMarketing = () => consents.data.value?.items.some((c) => c.kind === 'consent_marketing' && !c.withdrawnAt) ?? false;
</script>

<template>
  <PageHeader :title="t('a7.me.title')" :lead="t('a7.me.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>

  <section class="card stack" aria-labelledby="pd-h">
    <h2 id="pd-h">{{ t('a7.me.pending') }}</h2>
    <DataState :loading="pending.loading.value" :error="pending.error.value" :empty="!!pending.data.value && pending.data.value.items.length === 0" @retry="pending.load">
      <ul v-if="pending.data.value" class="plain stack"><li v-for="d in pending.data.value.items" :key="d.kind" class="row between"><span><RouterLink :to="`/legal/${d.kind}`"><bdi>{{ d.title }}</bdi></RouterLink> <span class="muted small">v{{ d.version }}</span></span><button type="button" class="btn btn-sm btn-primary" @click="act(() => esp07.accept(d.kind, d.version), [pending.load, consents.load])">{{ t('a7.me.accept') }}</button></li></ul>
    </DataState>
  </section>

  <section class="card stack block" aria-labelledby="mk-h">
    <h2 id="mk-h">{{ t('a7.me.marketing') }}</h2>
    <p class="muted small">{{ t('a7.me.marketingLead') }}</p>
    <div v-if="marketing.data.value" class="row">
      <button v-if="!activeMarketing()" type="button" class="btn btn-sm" @click="act(() => esp07.accept('consent_marketing', marketing.data.value!.version), [consents.load])">{{ t('a7.me.optIn') }}</button>
      <button v-else type="button" class="btn btn-sm" @click="act(() => esp07.withdraw('consent_marketing'), [consents.load])">{{ t('a7.me.withdraw') }}</button>
    </div>
    <p v-else class="muted small">{{ t('a7.me.noMarketingText') }}</p>
    <ul v-if="consents.data.value?.items.length" class="plain small"><li v-for="c in consents.data.value.items" :key="c._id"><bdi class="ltr">{{ c.kind }} v{{ c.version }}</bdi> — <JalaliDate :iso="c.acceptedAt" /> <span v-if="c.withdrawnAt">· {{ t('a7.me.withdrawn') }} <JalaliDate :iso="c.withdrawnAt" /></span></li></ul>
  </section>

  <section class="card stack block" aria-labelledby="ex-h">
    <h2 id="ex-h">{{ t('a7.me.dataRights') }}</h2>
    <div class="row"><button type="button" class="btn" @click="exportNow">{{ t('a7.me.export') }}</button><span class="muted small">{{ t('a7.me.exportHint') }}</span></div>
    <form class="row" @submit.prevent="act(async () => { await esp07.createRequest('correction', detail.correction); detail.correction = ''; }, [requests.load], t('a7.me.requested'))">
      <input v-model="detail.correction" class="input grow" dir="auto" :placeholder="t('a7.me.correctionPlaceholder')" :aria-label="t('a7.me.correction')" />
      <button type="submit" class="btn" :disabled="detail.correction.trim().length < 5">{{ t('a7.me.correction') }}</button>
    </form>
    <form class="stack" @submit.prevent="act(async () => { await esp07.createRequest('deletion', detail.deletion); detail.deletion = ''; confirmDelete = false; }, [requests.load], t('a7.me.requested'))">
      <p class="warn small">{{ t('a7.me.deletionWarning') }}</p>
      <input v-model="detail.deletion" class="input" dir="auto" :placeholder="t('a7.me.deletionReason')" :aria-label="t('a7.me.deletionReason')" />
      <label><input v-model="confirmDelete" type="checkbox" /> {{ t('a7.me.deletionConfirm') }}</label>
      <div><button type="submit" class="btn" :disabled="!confirmDelete">{{ t('a7.me.deletion') }}</button></div>
    </form>
    <DataState :loading="requests.loading.value" :error="requests.error.value" :empty="!!requests.data.value && requests.data.value.items.length === 0" @retry="requests.load">
      <ul v-if="requests.data.value" class="plain small"><li v-for="r in requests.data.value.items" :key="r._id">{{ t(`a7.req.${r.kind}` as never) }} <StatusBadge :state="r.state" /> <JalaliDate :iso="r.createdAt" /><span v-if="r.decisionNote"> — {{ r.decisionNote }}</span></li></ul>
    </DataState>
  </section>

  <section class="card stack block" aria-labelledby="ap-h">
    <h2 id="ap-h">{{ t('a7.me.appeal') }}</h2>
    <p class="muted small">{{ t('a7.me.appealLead') }}</p>
    <form class="stack" @submit.prevent="act(async () => { await esp07.appeal(appealId, appealText); appealId = ''; appealText = ''; }, [], t('a7.me.appealed'))">
      <input v-model="appealId" class="input ltr" :placeholder="t('a7.me.decisionId')" :aria-label="t('a7.me.decisionId')" />
      <textarea v-model="appealText" class="input" rows="3" dir="auto" :aria-label="t('a7.me.appealText')" />
      <div><button type="submit" class="btn" :disabled="!appealId || appealText.trim().length < 10">{{ t('a7.me.appealSend') }}</button></div>
    </form>
  </section>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.plain { list-style: none; margin: 0; padding: 0; }
.block { margin-block-start: var(--sp-4); }
.grow { flex: 1 1 16rem; }
.small { font-size: var(--fs-xs); }
.warn { color: var(--warn); }
.ok { color: var(--ok); }
h2, p { margin: 0; }
</style>
