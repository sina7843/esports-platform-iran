<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp06 as esp06Api } from '../api/esp06';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * CAST-001..008 and COM-006 for one event: streams (primary/fallback, language, delay, status, next programme),
 * crew appointments, VOD/highlight/interview archive tied to matches, overlay tokens (shown once) and official
 * group messages with separate read/acknowledgement reporting.
 */
const esp06: typeof esp06Api = esp06Api;
const route = useRoute();
const eventId = computed(() => String(route.params['id']));
const { data, loading, error, load } = useLoad(async () => ({
  streams: (await esp06.streams(eventId.value)).items,
  crew: (await esp06.crew(eventId.value)).items,
  overlays: (await esp06.overlays(eventId.value).catch(() => ({ items: [] }))).items,
  messages: (await esp06.officialList(eventId.value).catch(() => ({ items: [] }))).items,
}));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>, ok = t('case.saved')) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const st = reactive({ label: '', language: 'fa', streamKey: '', role: 'primary', delaySeconds: 30 });
const crew = reactive({ principalId: '', role: 'commentator', matchId: '' });
const vid = reactive({ kind: 'highlight', title: '', url: '', matchId: '', spoiler: true });
const ov = reactive({ streamId: '', mode: 'synced', widgets: ['scoreboard'] as string[], label: 'OBS', hours: 12 });
const createdOverlay = ref<{ token: string; url: string } | null>(null);
async function createOverlay() {
  failure.value = null;
  try {
    const r = await esp06.createOverlay(eventId.value, { streamId: ov.mode === 'synced' ? ov.streamId || null : null, mode: ov.mode, widgets: ov.widgets, matchId: null, label: ov.label, hours: ov.hours });
    createdOverlay.value = { token: r.token, url: `${location.origin}/overlay/${r.token}` };
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const next = reactive<Record<string, { title: string; at: string; delay: number }>>({});
const nextOf = (id: string, delay: number) => (next[id] ??= { title: '', at: '', delay });
const msg = reactive({ audience: 'participants', title: '', body: '', requiresAck: true });
const report = ref<Record<string, Record<string, number>>>({});
</script>

<template>
  <PageHeader :title="t('bc.title')" :lead="t('bc.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <section class="card stack" aria-labelledby="bs-h">
        <h2 id="bs-h">{{ t('live.streams') }}</h2>
        <p class="muted small">{{ t('bc.providerNote') }}</p>
        <article v-for="s in data.streams" :key="s._id" class="item stack">
          <div class="row between"><strong><bdi>{{ s.label }}</bdi></strong><span class="row small"><StatusBadge :state="s.status" /> {{ s.language }} · {{ t(`live.role.${s.role}` as never) }} · {{ t('live.delay', { n: num(s.delaySeconds) }) }}</span></div>
          <div class="row">
            <button v-for="x in ['live', 'offline', 'ended']" :key="x" type="button" class="btn btn-sm" :aria-pressed="s.status === x" @click="act(() => esp06.updateStream(s._id, { status: x, expectedVersion: s.version }))">{{ t(`bc.status.${x}` as never) }}</button>
          </div>
          <div class="row">
            <input v-model="nextOf(s._id, s.delaySeconds).title" class="input" dir="auto" :placeholder="t('bc.nextTitle')" :aria-label="t('bc.nextTitle')" />
            <input v-model="nextOf(s._id, s.delaySeconds).at" type="datetime-local" class="input" :aria-label="t('bc.nextAt')" />
            <button type="button" class="btn btn-sm" :disabled="!nextOf(s._id, s.delaySeconds).title || !nextOf(s._id, s.delaySeconds).at" @click="act(() => esp06.updateStream(s._id, { nextProgramme: { title: nextOf(s._id, s.delaySeconds).title, at: zonedWallTimeToUtc(nextOf(s._id, s.delaySeconds).at) }, expectedVersion: s.version }))">{{ t('bc.setNext') }}</button>
            <label class="small">{{ t('bc.delay') }} <input v-model.number="nextOf(s._id, s.delaySeconds).delay" type="number" min="0" max="3600" class="input ltr narrow" /></label>
            <button type="button" class="btn btn-sm" @click="act(() => esp06.updateStream(s._id, { delaySeconds: nextOf(s._id, s.delaySeconds).delay, expectedVersion: s.version }))">{{ t('bc.saveDelay') }}</button>
          </div>
        </article>
        <form class="grid" @submit.prevent="act(() => esp06.addStream(eventId, { ...st }))">
          <FormField id="bs-l" :label="t('bc.label')"><template #default="{ id: fid }"><input :id="fid" v-model="st.label" class="input" dir="auto" /></template></FormField>
          <FormField id="bs-k" :label="t('bc.key')"><template #default="{ id: fid }"><input :id="fid" v-model="st.streamKey" class="input ltr" /></template></FormField>
          <FormField id="bs-lg" :label="t('bc.language')"><template #default="{ id: fid }"><input :id="fid" v-model="st.language" class="input ltr" /></template></FormField>
          <FormField id="bs-r" :label="t('res.roleLabel')"><template #default="{ id: fid }"><select :id="fid" v-model="st.role" class="input"><option value="primary">{{ t('live.role.primary') }}</option><option value="fallback">{{ t('live.role.fallback') }}</option></select></template></FormField>
          <FormField id="bs-d" :label="t('bc.delay')" :hint="t('bc.delayHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model.number="st.delaySeconds" type="number" min="0" max="3600" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
          <button type="submit" class="btn" :disabled="!st.label || !st.streamKey">{{ t('bc.addStream') }}</button>
        </form>
      </section>

      <section class="card stack block" aria-labelledby="cr-h">
        <h2 id="cr-h">{{ t('bc.crew') }}</h2>
        <ul class="list"><li v-for="c in data.crew" :key="c._id"><bdi class="ltr">{{ c.principalId }}</bdi> — {{ t(`bc.crewRole.${c.role}` as never) }}<span v-if="c.matchId"> ({{ c.matchId }})</span> <button type="button" class="btn btn-sm" @click="act(() => esp06.endCrew(c._id))">{{ t('res.remove') }}</button></li></ul>
        <form class="row" @submit.prevent="act(() => esp06.addCrew(eventId, { principalId: crew.principalId, role: crew.role, matchId: crew.matchId || null, streamId: null }))">
          <input v-model="crew.principalId" class="input ltr" :placeholder="t('res.principal')" :aria-label="t('res.principal')" />
          <select v-model="crew.role" class="input" :aria-label="t('res.roleLabel')"><option v-for="r in ['commentator', 'analyst', 'observer', 'producer']" :key="r" :value="r">{{ t(`bc.crewRole.${r}` as never) }}</option></select>
          <input v-model="crew.matchId" class="input ltr" :placeholder="t('case.match')" :aria-label="t('case.match')" />
          <button type="submit" class="btn btn-sm" :disabled="!crew.principalId">{{ t('res.appoint') }}</button>
        </form>
      </section>

      <section class="card stack block" aria-labelledby="vd-h">
        <h2 id="vd-h">{{ t('bc.archive') }}</h2>
        <form class="grid" @submit.prevent="act(() => esp06.addMedia(eventId, { kind: vid.kind, title: vid.title, url: vid.url || null, fileId: null, matchId: vid.matchId || null, streamId: null, offsetSeconds: null, occurredAt: null, spoiler: vid.spoiler }))">
          <FormField id="vd-k" :label="t('nr.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="vid.kind" class="input"><option v-for="k in ['vod', 'highlight', 'interview']" :key="k" :value="k">{{ t(`live.vid.${k}` as never) }}</option></select></template></FormField>
          <FormField id="vd-t" :label="t('nr.title')"><template #default="{ id: fid }"><input :id="fid" v-model="vid.title" class="input" dir="auto" /></template></FormField>
          <FormField id="vd-u" :label="t('bc.url')" :hint="t('bc.urlHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="vid.url" type="url" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
          <FormField id="vd-m" :label="t('case.match')"><template #default="{ id: fid }"><input :id="fid" v-model="vid.matchId" class="input ltr" /></template></FormField>
          <label><input v-model="vid.spoiler" type="checkbox" /> {{ t('nr.spoiler') }}</label>
          <button type="submit" class="btn" :disabled="vid.title.length < 2 || !vid.url">{{ t('bc.addVideo') }}</button>
        </form>
      </section>

      <section class="card stack block" aria-labelledby="ov-h">
        <h2 id="ov-h">{{ t('bc.overlays') }}</h2>
        <p class="muted small">{{ t('bc.overlayNote') }}</p>
        <ul class="list"><li v-for="o in data.overlays" :key="o._id">{{ o.label }} — {{ o.mode === 'latest' ? t('ovl.latest') : t('ovl.syncedShort') }} · {{ o.widgets.join('، ') }} · <JalaliDate :iso="o.expiresAt" /> <StatusBadge v-if="o.revokedAt" state="revoked" />
          <button v-if="!o.revokedAt" type="button" class="btn btn-sm" @click="act(() => esp06.revokeOverlay(o._id))">{{ t('bc.revoke') }}</button></li></ul>
        <form class="grid" @submit.prevent="createOverlay">
          <FormField id="ov-m" :label="t('bc.mode')"><template #default="{ id: fid }"><select :id="fid" v-model="ov.mode" class="input"><option value="synced">{{ t('ovl.syncedShort') }}</option><option value="latest">{{ t('ovl.latest') }}</option></select></template></FormField>
          <FormField v-if="ov.mode === 'synced'" id="ov-s" :label="t('bc.stream')"><template #default="{ id: fid }"><select :id="fid" v-model="ov.streamId" class="input"><option value="" disabled>—</option><option v-for="s in data.streams" :key="s._id" :value="s._id">{{ s.label }}</option></select></template></FormField>
          <fieldset class="row"><legend>{{ t('bc.widgets') }}</legend><label v-for="w in ['scoreboard', 'lineup', 'bracket', 'veto', 'sponsor', 'logo']" :key="w"><input v-model="ov.widgets" type="checkbox" :value="w" /> {{ t(`bc.w.${w}` as never) }}</label></fieldset>
          <FormField id="ov-l" :label="t('bc.label')"><template #default="{ id: fid }"><input :id="fid" v-model="ov.label" class="input" dir="auto" /></template></FormField>
          <FormField id="ov-h2" :label="t('bc.hours')"><template #default="{ id: fid }"><input :id="fid" v-model.number="ov.hours" type="number" min="1" max="168" class="input ltr" /></template></FormField>
          <button type="submit" class="btn" :disabled="!ov.widgets.length || (ov.mode === 'synced' && !ov.streamId)">{{ t('bc.createOverlay') }}</button>
        </form>
        <p v-if="createdOverlay" class="warn" role="status">{{ t('bc.tokenOnce') }} <code class="ltr">{{ createdOverlay.url }}</code></p>
      </section>

      <section class="card stack block" aria-labelledby="om-h">
        <h2 id="om-h">{{ t('bc.official') }}</h2>
        <form class="stack" @submit.prevent="act(() => esp06.sendOfficial(eventId, { ...msg }), t('bc.sent'))">
          <div class="grid">
            <FormField id="om-a" :label="t('bc.audience')"><template #default="{ id: fid }"><select :id="fid" v-model="msg.audience" class="input"><option v-for="a in ['participants', 'captains', 'staff']" :key="a" :value="a">{{ t(`bc.aud.${a}` as never) }}</option></select></template></FormField>
            <FormField id="om-t" :label="t('nr.title')"><template #default="{ id: fid }"><input :id="fid" v-model="msg.title" class="input" dir="auto" /></template></FormField>
          </div>
          <FormField id="om-b" :label="t('nr.body')"><template #default="{ id: fid }"><textarea :id="fid" v-model="msg.body" class="input" rows="3" dir="auto" /></template></FormField>
          <label><input v-model="msg.requiresAck" type="checkbox" /> {{ t('bc.requiresAck') }}</label>
          <button type="submit" class="btn btn-primary" :disabled="msg.title.length < 3 || msg.body.length < 5">{{ t('bc.send') }}</button>
        </form>
        <ul class="list"><li v-for="m in data.messages" :key="m._id">{{ m.title }} — {{ t(`bc.aud.${m.audience}` as never) }} · {{ num(m.recipients) }} · <JalaliDate :iso="m.createdAt" />
          <button type="button" class="btn btn-sm" @click="act(async () => { report[m._id] = (await esp06.officialReport(m._id)).totals; }, '')">{{ t('bc.report') }}</button>
          <span v-if="report[m._id]" class="small"> {{ t('bc.reportLine', { r: num(report[m._id]!['read'] ?? 0), a: num(report[m._id]!['acknowledged'] ?? 0), s: num(report[m._id]!['smsSent'] ?? 0), d: num(report[m._id]!['smsDelivered'] ?? 0) }) }}</span></li></ul>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-2); align-items: end; }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.item { border-block-end: 1px solid var(--border); padding-block: var(--sp-2); }
.block { margin-block-start: var(--sp-4); }
.narrow { inline-size: 6rem; }
fieldset { border: 0; padding: 0; margin: 0; }
code { word-break: break-all; }
.small { font-size: var(--fs-xs); }
.warn { color: var(--warn); }
.ok { color: var(--ok); }
h2, p { margin: 0; }
</style>
