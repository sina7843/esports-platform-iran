<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api } from '../api/esp05';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { honorLabel, t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';

/** END-004 / AWD-004: my certificates (with public verification codes) and my declared achievements (reviewed apart). */
const esp05: typeof esp05Api = esp05Api;
const me = () => session.me?.principal.id ?? '';
const { data, loading, error, load } = useLoad(async () => ({ certs: (await esp05.myCertificates()).items, honors: await esp05.playerHonors(me()) }));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const f = reactive({ title: '', eventName: '', year: '' });
async function declare() {
  failure.value = null;
  try {
    await esp05.declare({ owner: { kind: 'principal', ref: me() }, title: f.title.trim(), eventName: f.eventName.trim(), year: f.year ? Number(f.year) : null, evidenceFileIds: [] });
    notice.value = t('cert.declared');
    f.title = '';
    f.eventName = '';
    f.year = '';
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('cert.title')" :lead="t('cert.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <section class="card stack" aria-labelledby="c-h">
        <h2 id="c-h">{{ t('cert.mine') }}</h2>
        <p v-if="!data.certs.length" class="muted">{{ t('cert.none') }}</p>
        <ul class="list">
          <li v-for="c in data.certs" :key="c.id">{{ t(`cert.kind.${c.kind}` as never) }} — <bdi>{{ c.eventName }}</bdi><span v-if="c.place"> ({{ t('hon.place', { n: c.place }) }})</span> · <JalaliDate :iso="c.issuedAt" format="date" /> <StatusBadge :state="c.state" />
            · <RouterLink :to="`/verify/${c.code}`"><bdi class="ltr">{{ c.code }}</bdi></RouterLink></li>
        </ul>
      </section>
      <section class="card stack block" aria-labelledby="h-h">
        <h2 id="h-h">{{ t('hon.verified') }}</h2>
        <p v-if="!data.honors.verified.length" class="muted">{{ t('hon.none') }}</p>
        <ul class="list"><li v-for="h in data.honors.verified" :key="h.id">{{ honorLabel(h.label) }} — <bdi>{{ h.eventName }}</bdi> <StatusBadge :state="h.state" /> · <a :href="esp05.cardUrl(h.id)" target="_blank" rel="noopener">{{ t('hon.card') }}</a></li></ul>
      </section>
      <section class="card stack block" aria-labelledby="d-h">
        <h2 id="d-h">{{ t('hon.declared') }}</h2>
        <p class="muted small">{{ t('hon.declaredHint') }}</p>
        <ul class="list"><li v-for="d in data.honors.declared" :key="d.id"><bdi>{{ d.title }}</bdi> — <bdi>{{ d.eventName }}</bdi> <span class="muted">({{ t(`hon.${d.label}` as never) }})</span></li></ul>
        <form class="grid" novalidate @submit.prevent="declare">
          <FormField id="dc-t" :label="t('cert.achTitle')"><template #default="{ id: fid }"><input :id="fid" v-model="f.title" class="input" dir="auto" /></template></FormField>
          <FormField id="dc-e" :label="t('cert.achEvent')"><template #default="{ id: fid }"><input :id="fid" v-model="f.eventName" class="input" dir="auto" /></template></FormField>
          <FormField id="dc-y" :label="t('cert.achYear')"><template #default="{ id: fid }"><input :id="fid" v-model="f.year" type="number" min="1990" max="2100" class="input ltr" /></template></FormField>
          <button type="submit" class="btn" :disabled="f.title.trim().length < 3 || f.eventName.trim().length < 3">{{ t('cert.declare') }}</button>
        </form>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.block { margin-block-start: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-3); align-items: end; }
.ok { color: var(--ok); }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
