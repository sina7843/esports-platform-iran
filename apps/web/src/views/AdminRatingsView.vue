<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { QAlert, QBadge, QButton, QCard, QContainer, QDataState, QPageHeader, QSection, QSelect, QStatusBadge, QTextField, fa, num, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api } from '../api/esp05';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';
/**
 * RANK-001/002/005/006 rating systems: draft → publish (starts a resumable build) → owner approval by someone other
 * than the author. Also the review queue for declared achievements (AWD-004).
 */
const esp05: typeof esp05Api = esp05Api;
const { data, loading, error, load } = useLoad(async () => ({
  systems: (await esp05.systems({ drafts: true })).items,
  queue: (await esp05.declaredQueue().catch(() => ({ items: [] }))).items,
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
const f = reactive({ gameId: '', mode: '', platform: '', subject: 'player', model: 'glicko2', initialRating: 1500, initialRd: 350, vol: 0.06, tau: 0.5, periodDays: 7, placement: '', kill: 1, source: '', inactivityDays: 180, regionBasis: '', eligibility: '', weight: 1 });
const approveRef = reactive<Record<string, string>>({});
const builds = ref<Record<string, Array<Record<string, unknown>>>>({});
const body = () => ({
  gameId: f.gameId.trim(), mode: f.mode.trim(), platform: f.platform.trim() || null, subject: f.subject, model: f.model,
  params: f.model === 'glicko2' ? { initialRating: f.initialRating, initialRd: f.initialRd, initialVolatility: f.vol, tau: f.tau, periodDays: f.periodDays } : { placementPoints: f.placement.split(/[,،\s]+/).filter(Boolean).map(Number), killPoints: f.kill, source: f.source.trim() },
  seasonId: null, carry: { kind: 'reset', factor: null }, inactivityDays: f.inactivityDays, tiebreak: ['games'], regionBasis: f.regionBasis.trim(), eventWeights: { standard: f.weight }, eligibility: f.eligibility.trim(),
});
async function showBuilds(id: string) {
  try {
    builds.value[id] = (await esp05.builds(id)).items;
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
type NumKey = 'initialRating' | 'initialRd' | 'vol' | 'tau' | 'periodDays' | 'kill' | 'inactivityDays' | 'weight';
const nf = (k: NumKey) => computed({ get: () => String(f[k]), set: (v: string) => { f[k] = Number(v) || 0; } });
const N = { initialRating: nf('initialRating'), initialRd: nf('initialRd'), vol: nf('vol'), tau: nf('tau'), periodDays: nf('periodDays'), kill: nf('kill'), inactivityDays: nf('inactivityDays'), weight: nf('weight') };
</script>

<template>
  <QContainer>
    <div class="k-stack p-rsys">
      <QPageHeader compact :title="t('rsys.title')" :description="t('rsys.lead')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('rsys.title') }]" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <QDataState v-if="!data" :state="error ? (error.code === 'FORBIDDEN' ? 'forbidden' : 'error') : 'loading'" skeleton="rows" @retry="load" />
      <template v-else>
        <QSection id="systems" small :title="t('rsys.systems')">
          <p v-if="!data.systems.length" class="p-rsys-muted">{{ t('rsys.none') }}</p>
          <div class="k-stack">
            <QCard v-for="s in data.systems" :key="s.id">
              <div class="k-stack">
                <div class="p-rsys-head">
                  <strong class="q-ltr">{{ s.gameId }} · {{ s.mode }} · {{ s.model === 'glicko2' ? 'Glicko-2' : s.model }} (v{{ fa(s.version) }})</strong>
                  <span class="k-row"><QBadge tone="neutral">{{ t(`rank.subject.${s.subject}` as never) }}</QBadge><QStatusBadge :state="s.state" /></span>
                </div>
                <p class="p-rsys-muted">
                  <QBadge :tone="s.label.official ? 'success' : 'warning'">{{ s.label.official ? t('rank.official') : t('rank.unapproved') }}</QBadge>
                  <span v-if="s.approval" dir="auto"> {{ s.approval.reference }}</span>
                </p>
                <div class="k-row">
                  <QButton v-if="s.state === 'draft'" size="sm" variant="primary" @click="act(() => esp05.publishSystem(s.id))">{{ t('rsys.publish') }}</QButton>
                  <template v-if="s.state === 'published' && !s.approval">
                    <QTextField :id="`ap-${s.id}`" v-model="approveRef[s.id]" :label="t('rsys.reference')" hide-label :placeholder="t('rsys.reference')" />
                    <QButton size="sm" variant="green" :disabled="(approveRef[s.id] ?? '').length < 5" @click="act(() => esp05.approveSystem(s.id, approveRef[s.id] ?? ''))">{{ t('rsys.approve') }}</QButton>
                  </template>
                  <QButton size="sm" variant="ghost" @click="showBuilds(s.id)">{{ t('rsys.builds') }}</QButton>
                </div>
                <ul v-if="builds[s.id]" class="p-rsys-log">
                  <li v-for="b in builds[s.id]" :key="String(b['_id'])"><bdi class="q-ltr q-mono">{{ b['_id'] }}</bdi> <QStatusBadge :state="String(b['state'])" /> {{ num(Number(b['processed'])) }}<span v-if="b['error']" class="p-rsys-err" dir="auto"> {{ b['error'] }}</span></li>
                </ul>
              </div>
            </QCard>
          </div>
        </QSection>

        <QSection id="create" small :title="t('rsys.create')" :description="t('rsys.createHint')">
          <QCard>
            <form class="k-stack" novalidate @submit.prevent="act(() => esp05.createSystem(body()))">
              <div class="p-rsys-form">
                <QTextField id="rs-g" v-model="f.gameId" :label="t('rsys.game')" ltr />
                <QTextField id="rs-m" v-model="f.mode" :label="t('rsys.mode')" ltr />
                <QTextField id="rs-p" v-model="f.platform" :label="t('rsys.platform')" ltr />
                <QSelect id="rs-s" v-model="f.subject" :label="t('rsys.subject')" :options="[{ value: 'player', label: t('rank.subject.player') }, { value: 'team', label: t('rank.subject.team') }]" />
                <QSelect id="rs-mo" v-model="f.model" :label="t('rsys.model')" :options="[{ value: 'glicko2', label: 'Glicko-2' }, { value: 'lobby_points', label: t('rsys.lobbyPoints') }]" />
                <template v-if="f.model === 'glicko2'">
                  <QTextField id="rs-r" v-model="N.initialRating.value" :label="t('rsys.initialRating')" type="number" ltr />
                  <QTextField id="rs-rd" v-model="N.initialRd.value" label="RD" type="number" ltr />
                  <QTextField id="rs-v" v-model="N.vol.value" :label="t('rsys.volatility')" type="number" ltr />
                  <QTextField id="rs-t" v-model="N.tau.value" label="τ" type="number" ltr />
                  <QTextField id="rs-pd" v-model="N.periodDays.value" :label="t('rsys.periodDays')" type="number" ltr />
                </template>
                <template v-else>
                  <QTextField id="rs-pp" v-model="f.placement" :label="t('rsys.placementPoints')" :hint="t('rsys.placementHint')" ltr />
                  <QTextField id="rs-k" v-model="N.kill.value" :label="t('rsys.killPoints')" type="number" ltr />
                  <QTextField id="rs-src" v-model="f.source" :label="t('rsys.source')" />
                </template>
                <QTextField id="rs-in" v-model="N.inactivityDays.value" :label="t('rsys.inactivity')" type="number" ltr />
                <QTextField id="rs-w" v-model="N.weight.value" :label="t('rsys.weight')" type="number" ltr />
                <QTextField id="rs-rb" v-model="f.regionBasis" :label="t('rsys.regionBasis')" />
                <QTextField id="rs-el" v-model="f.eligibility" :label="t('rank.eligibility')" />
              </div>
              <div><QButton type="submit" variant="primary" :disabled="!f.gameId || !f.mode || f.regionBasis.length < 3 || f.eligibility.length < 3">{{ t('rsys.save') }}</QButton></div>
            </form>
          </QCard>
        </QSection>

        <QSection id="declared" small :title="t('rsys.declaredQueue')">
          <QCard>
            <p v-if="!data.queue.length" class="p-rsys-muted">{{ t('rsys.queueEmpty') }}</p>
            <ul v-else class="p-rsys-rows">
              <li v-for="d in data.queue" :key="d._id">
                <span><bdi>{{ d.title }}</bdi> — <bdi>{{ d.eventName }}</bdi> (<bdi class="q-ltr">{{ d.owner.ref }}</bdi>)</span>
                <span class="k-row">
                  <QButton size="sm" variant="green" @click="act(() => esp05.reviewDeclared(d._id, 'verified', null))">{{ t('rsys.verify') }}</QButton>
                  <QButton size="sm" variant="secondary" @click="act(() => esp05.reviewDeclared(d._id, 'rejected', null))">{{ t('rsys.reject') }}</QButton>
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
.p-rsys { gap: var(--space-7); }
.p-rsys-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-rsys-muted { margin: 0; color: var(--ink-muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.p-rsys-log { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: 13px; }
.p-rsys-err { color: var(--danger-text); }
.p-rsys-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); }
.p-rsys-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-rsys-rows li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); font-size: 14px; }
</style>
