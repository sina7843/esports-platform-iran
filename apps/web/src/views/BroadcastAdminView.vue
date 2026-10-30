<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QCode, QContainer, QDataState, QDateField, QPageHeader, QSection, QSegmentedControl, QSelect, QStatusBadge, QTextField, fa, formatJalali, num, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp06 as esp06Api } from '../api/esp06';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
const nextAt = (id: string, delay: number) => computed({ get: () => nextOf(id, delay).at || null, set: (v: string | null) => { nextOf(id, delay).at = v ?? ''; } });
const nextDelay = (id: string, delay: number) => computed({ get: () => String(nextOf(id, delay).delay), set: (v: string) => { nextOf(id, delay).delay = Number(v) || 0; } });

const msg = reactive({ audience: 'participants', title: '', body: '', requiresAck: true });
const report = ref<Record<string, Record<string, number>>>({});
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
const stDelay = computed({ get: () => String(st.delaySeconds), set: (v: string) => { st.delaySeconds = Number(v) || 0; } });
const ovHours = computed({ get: () => String(ov.hours), set: (v: string) => { ov.hours = Number(v) || 1; } });
const spoiler = computed({ get: () => vid.spoiler, set: (v: boolean | null) => { vid.spoiler = !!v; } });
const reqAck = computed({ get: () => msg.requiresAck, set: (v: boolean | null) => { msg.requiresAck = !!v; } });
const WIDGETS = ['scoreboard', 'lineup', 'bracket', 'veto', 'sponsor', 'logo'];
const toggleWidget = (w: string, on: boolean | null) => { ov.widgets = on ? [...new Set([...ov.widgets, w])] : ov.widgets.filter((x) => x !== w); };
const opts = (keys: string[], prefix: string) => keys.map((k) => ({ value: k, label: t(`${prefix}.${k}` as never) }));
</script>

<template>
  <QContainer>
    <div class="k-stack p-bc">
      <QPageHeader compact :title="t('bc.title')" :description="t('bc.lead')" :breadcrumb="[{ label: t('shell.organizer'), href: '/organizer' }, { label: t('shell.events'), href: `/organizer/events/${eventId}` }, { label: t('bc.title') }]" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <QDataState v-if="!data" :state="error ? (error.code === 'FORBIDDEN' ? 'forbidden' : 'error') : 'loading'" skeleton="cards" @retry="load" />
      <template v-else>
        <QSection id="streams" small :title="t('live.streams')" :description="t('bc.providerNote')">
          <div class="k-stack">
            <QCard v-for="s in data.streams" :key="s._id">
              <div class="k-stack">
                <div class="p-bc-head">
                  <strong><bdi>{{ s.label }}</bdi></strong>
                  <span class="p-bc-meta"><QStatusBadge :state="s.status" /> {{ s.language }} · {{ t(`live.role.${s.role}` as never) }} · {{ t('live.delay', { n: fa(s.delaySeconds) }) }}</span>
                </div>
                <QSegmentedControl
                  size="sm" :aria-label="t('bc.label')" :model-value="s.status" :options="opts(['live', 'offline', 'ended'], 'bc.status')"
                  @update:model-value="(x) => x && x !== s.status && act(() => esp06.updateStream(s._id, { status: x, expectedVersion: s.version }))"
                />
                <div class="p-bc-form">
                  <QTextField v-model="nextOf(s._id, s.delaySeconds).title" :label="t('bc.nextTitle')" />
                  <QDateField v-model="nextAt(s._id, s.delaySeconds).value" :label="t('bc.nextAt')" with-time />
                  <QButton size="sm" variant="secondary" :disabled="!nextOf(s._id, s.delaySeconds).title || !nextOf(s._id, s.delaySeconds).at" @click="act(() => esp06.updateStream(s._id, { nextProgramme: { title: nextOf(s._id, s.delaySeconds).title, at: zonedWallTimeToUtc(nextOf(s._id, s.delaySeconds).at) }, expectedVersion: s.version }))">{{ t('bc.setNext') }}</QButton>
                </div>
                <div class="p-bc-form">
                  <QTextField v-model="nextDelay(s._id, s.delaySeconds).value" :label="t('bc.delay')" type="number" ltr />
                  <QButton size="sm" variant="secondary" @click="act(() => esp06.updateStream(s._id, { delaySeconds: nextOf(s._id, s.delaySeconds).delay, expectedVersion: s.version }))">{{ t('bc.saveDelay') }}</QButton>
                </div>
              </div>
            </QCard>
            <QCard>
              <form class="p-bc-grid" novalidate @submit.prevent="act(() => esp06.addStream(eventId, { ...st }))">
                <QTextField id="bs-l" v-model="st.label" :label="t('bc.label')" />
                <QTextField id="bs-k" v-model="st.streamKey" :label="t('bc.key')" ltr />
                <QTextField id="bs-lg" v-model="st.language" :label="t('bc.language')" ltr />
                <QSelect id="bs-r" v-model="st.role" :label="t('res.roleLabel')" :options="[{ value: 'primary', label: t('live.role.primary') }, { value: 'fallback', label: t('live.role.fallback') }]" />
                <QTextField id="bs-d" v-model="stDelay" :label="t('bc.delay')" :hint="t('bc.delayHint')" type="number" ltr />
                <div class="p-bc-end"><QButton type="submit" variant="green" icon="plus" :disabled="!st.label || !st.streamKey">{{ t('bc.addStream') }}</QButton></div>
              </form>
            </QCard>
          </div>
        </QSection>

        <QSection id="crew" small :title="t('bc.crew')">
          <QCard>
            <div class="k-stack">
              <ul v-if="data.crew.length" class="p-bc-rows">
                <li v-for="c in data.crew" :key="c._id"><span><bdi class="q-ltr">{{ c.principalId }}</bdi> — {{ t(`bc.crewRole.${c.role}` as never) }}<span v-if="c.matchId" class="q-ltr"> ({{ c.matchId }})</span></span><QButton size="sm" variant="secondary" @click="act(() => esp06.endCrew(c._id))">{{ t('res.remove') }}</QButton></li>
              </ul>
              <form class="p-bc-grid" novalidate @submit.prevent="act(() => esp06.addCrew(eventId, { principalId: crew.principalId, role: crew.role, matchId: crew.matchId || null, streamId: null }))">
                <QTextField v-model="crew.principalId" :label="t('res.principal')" ltr />
                <QSelect v-model="crew.role" :label="t('res.roleLabel')" :options="opts(['commentator', 'analyst', 'observer', 'producer'], 'bc.crewRole')" />
                <QTextField v-model="crew.matchId" :label="t('case.match')" ltr />
                <div class="p-bc-end"><QButton type="submit" size="sm" variant="secondary" :disabled="!crew.principalId">{{ t('res.appoint') }}</QButton></div>
              </form>
            </div>
          </QCard>
        </QSection>

        <QSection id="archive" small :title="t('bc.archive')">
          <QCard>
            <form class="p-bc-grid" novalidate @submit.prevent="act(() => esp06.addMedia(eventId, { kind: vid.kind, title: vid.title, url: vid.url || null, fileId: null, matchId: vid.matchId || null, streamId: null, offsetSeconds: null, occurredAt: null, spoiler: vid.spoiler }))">
              <QSelect id="vd-k" v-model="vid.kind" :label="t('nr.kind')" :options="opts(['vod', 'highlight', 'interview'], 'live.vid')" />
              <QTextField id="vd-t" v-model="vid.title" :label="t('nr.title')" />
              <QTextField id="vd-u" v-model="vid.url" :label="t('bc.url')" :hint="t('bc.urlHint')" type="url" ltr />
              <QTextField id="vd-m" v-model="vid.matchId" :label="t('case.match')" ltr />
              <QCheckbox v-model="spoiler" :label="t('nr.spoiler')" />
              <div class="p-bc-end"><QButton type="submit" variant="secondary" :disabled="vid.title.length < 2 || !vid.url">{{ t('bc.addVideo') }}</QButton></div>
            </form>
          </QCard>
        </QSection>

        <QSection id="overlays" small :title="t('bc.overlays')" :description="t('bc.overlayNote')">
          <QCard>
            <div class="k-stack">
              <ul v-if="data.overlays.length" class="p-bc-rows">
                <li v-for="o in data.overlays" :key="o._id">
                  <span>{{ o.label }} — {{ o.mode === 'latest' ? t('ovl.latest') : t('ovl.syncedShort') }} · {{ o.widgets.join('، ') }} · {{ formatJalali(o.expiresAt) }}</span>
                  <QBadge v-if="o.revokedAt" tone="neutral">{{ t('bc.revoke') }}</QBadge>
                  <QButton v-else size="sm" variant="danger" @click="act(() => esp06.revokeOverlay(o._id))">{{ t('bc.revoke') }}</QButton>
                </li>
              </ul>
              <form class="k-stack" novalidate @submit.prevent="createOverlay">
                <div class="p-bc-grid">
                  <QSelect id="ov-m" v-model="ov.mode" :label="t('bc.mode')" :options="[{ value: 'synced', label: t('ovl.syncedShort') }, { value: 'latest', label: t('ovl.latest') }]" />
                  <QSelect v-if="ov.mode === 'synced'" id="ov-s" v-model="ov.streamId" :label="t('bc.stream')" :options="data.streams.map((s) => ({ value: s._id, label: s.label }))" />
                  <QTextField id="ov-l" v-model="ov.label" :label="t('bc.label')" />
                  <QTextField id="ov-h2" v-model="ovHours" :label="t('bc.hours')" type="number" ltr />
                </div>
                <fieldset class="p-bc-set">
                  <legend>{{ t('bc.widgets') }}</legend>
                  <QCheckbox v-for="w in WIDGETS" :key="w" :model-value="ov.widgets.includes(w)" :label="t(`bc.w.${w}` as never)" @update:model-value="(v) => toggleWidget(w, v)" />
                </fieldset>
                <div><QButton type="submit" variant="green" icon="plus" :disabled="!ov.widgets.length || (ov.mode === 'synced' && !ov.streamId)">{{ t('bc.createOverlay') }}</QButton></div>
              </form>
              <QAlert v-if="createdOverlay" tone="warning" :title="t('bc.tokenOnce')"><QCode copy :label="t('bc.overlays')">{{ createdOverlay.url }}</QCode></QAlert>
            </div>
          </QCard>
        </QSection>

        <QSection id="official" small :title="t('bc.official')">
          <QCard>
            <div class="k-stack">
              <form class="k-stack" novalidate @submit.prevent="act(() => esp06.sendOfficial(eventId, { ...msg }), t('bc.sent'))">
                <div class="p-bc-grid">
                  <QSelect id="om-a" v-model="msg.audience" :label="t('bc.audience')" :options="opts(['participants', 'captains', 'staff'], 'bc.aud')" />
                  <QTextField id="om-t" v-model="msg.title" :label="t('nr.title')" />
                </div>
                <QTextField id="om-b" v-model="msg.body" :label="t('nr.body')" multiline :rows="3" />
                <QCheckbox v-model="reqAck" :label="t('bc.requiresAck')" />
                <div><QButton type="submit" variant="primary" icon="send" :disabled="msg.title.length < 3 || msg.body.length < 5">{{ t('bc.send') }}</QButton></div>
              </form>
              <ul v-if="data.messages.length" class="p-bc-rows">
                <li v-for="m in data.messages" :key="m._id">
                  <span>{{ m.title }} — {{ t(`bc.aud.${m.audience}` as never) }} · {{ num(m.recipients) }} · {{ formatJalali(m.createdAt) }}</span>
                  <span class="k-row">
                    <QButton size="sm" variant="ghost" @click="act(async () => { report[m._id] = (await esp06.officialReport(m._id)).totals; }, '')">{{ t('bc.report') }}</QButton>
                    <span v-if="report[m._id]" class="p-bc-meta">{{ t('bc.reportLine', { r: num(report[m._id]!['read'] ?? 0), a: num(report[m._id]!['acknowledged'] ?? 0), s: num(report[m._id]!['smsSent'] ?? 0), d: num(report[m._id]!['smsDelivered'] ?? 0) }) }}</span>
                  </span>
                </li>
              </ul>
            </div>
          </QCard>
        </QSection>
      </template>
    </div>
  </QContainer>
</template>

<style scoped>
.p-bc { gap: var(--space-7); }
.p-bc-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-bc-meta { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font-size: 13px; color: var(--ink-subtle); }
.p-bc-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-3); align-items: end; }
.p-bc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); align-items: end; }
.p-bc-end { align-self: end; }
.p-bc-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-bc-rows li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); font-size: 14px; }
.p-bc-set { margin: 0; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); }
.p-bc-set legend { padding-inline: var(--space-2); font-weight: 800; }
</style>
