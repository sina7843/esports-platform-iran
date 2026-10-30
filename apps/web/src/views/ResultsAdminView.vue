<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QButton, QCard, QCode, QConfirmDialog, QContainer, QDataState, QDateField, QFacts, QIcon, QMoney, QPageHeader, QSelect, QStatusBadge, QTabs, QTextField, fa, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import { esp04 as esp04Api } from '../api/esp04';
import { esp05 as esp05Api, type Impact } from '../api/esp05';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';
/**
 * Organizer / head referee results desk: officials (REF-001), correction impact tool (RES-006..008), sanctions
 * (REF-004), special awards (END-005) and the finish/close/archive gates (END-001..007).
 */
const esp04: typeof esp04Api = esp04Api;
const esp05: typeof esp05Api = esp05Api;
const route = useRoute();
const eventId = computed(() => String(route.params['id']));
const { data, loading, error, load } = useLoad(async () => {
  const [ev, officials, matches, corrections, blockers] = await Promise.all([
    esp03.manage(eventId.value),
    esp05.officials(eventId.value).catch(() => ({ items: [] })),
    esp04.schedule(eventId.value, { limit: 200 }),
    esp05.corrections(eventId.value).catch(() => ({ items: [] })),
    esp05.blockers(eventId.value),
  ]);
  cls.version = ev.event.version;
  return { ev, officials: officials.items, matches: matches.items, corrections: corrections.items, blockers };
});
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
const ofc = reactive({ principalId: '', role: 'referee', matchId: '', override: '' });
const cor = reactive({ matchId: '', winnerSide: 1 as 0 | 1, reason: '', approvalId: '', impact: null as Impact | null });
const snc = reactive({ subjectKind: 'participation', subjectRef: '', displayName: '', type: 'warning', points: '1', stageId: '', until: null as string | null, clauseKey: '', reason: '' });
const cls = reactive({ version: 0, approvalId: '' });
const report = ref<Record<string, unknown> | null>(null);
const finals = computed(() => (data.value?.matches ?? []).filter((m) => m.state === 'final'));
const outcome = () => ({ kind: 'win' as const, winnerSide: cor.winnerSide, scores: null, maps: null });
async function preview() {
  failure.value = null;
  try {
    cor.impact = await esp05.preview(cor.matchId, outcome());
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function requestApproval(action: 'match.result.correct' | 'event.close') {
  failure.value = null;
  try {
    const a = await esp05.requestApproval(action, action === 'event.close' ? { type: 'event', id: eventId.value } : { type: 'match', id: cor.matchId }, action === 'event.close' ? 'close the event' : cor.reason || 'result correction');
    if (action === 'event.close') cls.approvalId = a.id;
    else cor.approvalId = a.id;
    notice.value = t('res.approvalRequested', { id: a.id });
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const sanctionBody = () => ({
  subject: { kind: snc.subjectKind, ref: snc.subjectRef.trim(), displayName: snc.displayName.trim() || snc.subjectRef.trim() },
  scope: { kind: 'event', id: eventId.value }, type: snc.type, points: snc.type === 'point_penalty' ? Number(snc.points) : null, stageId: snc.type === 'point_penalty' ? snc.stageId.trim() : null,
  until: snc.type === 'suspension_temporary' && snc.until ? new Date(snc.until).toISOString() : null, reason: snc.reason, clauseKey: snc.clauseKey.trim(), caseId: null,
});
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
const tab = ref('officials');
const tabs = computed(() => [
  { key: 'officials', label: t('res.officials'), icon: 'users' as const, count: data.value?.officials.length ?? 0 },
  { key: 'correction', label: t('res.correction'), icon: 'edit' as const },
  { key: 'sanctions', label: t('res.sanctions'), icon: 'alert' as const },
  { key: 'close', label: t('res.close'), icon: 'check-circle' as const },
]);
const ROLES = ['referee', 'head_referee', 'appeal_authority'];
const roleOpts = computed(() => ROLES.map((r) => ({ value: r, label: t(`res.role.${r}` as never) })));
type M = { id: string; sides: Array<{ displayName: string }>; slot?: { key?: string } | null };
const matchLabel = (m: M) => `${m.slot?.key ?? m.id} — ${m.sides.map((s) => s.displayName).join(' / ')}`;
const matchOpts = computed(() => [{ value: '', label: t('res.wholeEvent') }, ...(data.value?.matches ?? []).map((m) => ({ value: m.id, label: matchLabel(m as M) }))]);
const finalOpts = computed(() => finals.value.map((m) => ({ value: m.id, label: matchLabel(m as M) })));
const winner = computed({ get: () => String(cor.winnerSide), set: (v: string) => { cor.winnerSide = v === '0' ? 0 : 1; cor.impact = null; } });
const corMatch = computed({ get: () => cor.matchId, set: (v: string) => { cor.matchId = v; cor.impact = null; } });
const impactFacts = computed(() => {
  const i = cor.impact;
  if (!i) return [];
  return [
    { label: t('res.slots'), value: fa(i.slots.length) }, { label: t('res.reset'), value: fa(i.resetMatches.length) },
    { label: t('res.standings'), value: fa(i.standings.length) }, { label: t('res.ratings'), value: fa(i.ratingEvents) },
    { label: t('res.honors'), value: fa(i.honors.length) }, { label: t('res.prizes'), value: fa(i.prizes.length) },
    { label: t('res.quotas'), value: fa(i.quotas.length) },
  ];
});
const SNC_TYPES = ['warning', 'point_penalty', 'disqualification', 'suspension_temporary', 'suspension_permanent'];
const unassign = ref<string | null>(null);
const clsVersion = computed({ get: () => String(cls.version), set: (v: string) => { cls.version = Number(v) || 0; } });
const checks = computed(() => {
  const b = data.value?.blockers;
  if (!b) return [];
  return [
    { ok: !b.unfinishedStages.length, label: t('res.chkStages'), detail: b.unfinishedStages.length ? t('res.unfinishedStages', { n: fa(b.unfinishedStages.length) }) : '' },
    { ok: !b.openMatches.length, label: t('res.chkMatches'), detail: b.openMatches.length ? t('res.openMatches', { n: fa(b.openMatches.length) }) : '' },
    { ok: !b.openCases.length, label: t('res.chkCases'), detail: '' },
    { ok: !b.corrections.length, label: t('res.chkCorrections'), detail: '' },
    { ok: !b.openObligationsRial, label: t('res.obligations'), detail: '' },
  ];
});
</script>

<template>
  <QContainer>
    <div class="k-stack p-res">
      <QPageHeader compact :title="t('res.title')" :description="t('res.lead')" :breadcrumb="[{ label: t('oa.crumb'), href: '/organizer' }, { label: t('res.title') }]">
        <template #actions><QButton variant="secondary" size="sm" icon="download" :disabled="!data" @click="act(async () => { report = await esp05.eventReport(eventId); }, '')">{{ t('res.report') }}</QButton></template>
      </QPageHeader>
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>

      <QDataState v-if="!data" :state="error ? 'error' : 'loading'" :error="error" skeleton="rows" @retry="load" />
      <QTabs v-else v-model="tab" :items="tabs" :aria-label="t('res.title')">
        <template #panel="{ item }">
          <!-- officials -->
          <div v-if="item.key === 'officials'" class="k-stack">
            <QAlert tone="info">{{ t('res.officialsHint') }}</QAlert>
            <QCard padding="none">
              <ul class="p-res-rows">
                <li v-for="o in data.officials" :key="o._id">
                  <span><code class="q-mono q-ltr">{{ o.principalId }}</code> — <strong>{{ t(`res.role.${o.role}` as never) }}</strong>
                    <span class="p-res-muted"> · {{ o.matchId ? `${t('case.match')} ${o.matchId}` : t('res.wholeEvent') }}</span></span>
                  <QButton size="sm" variant="ghost" @click="unassign = o._id">{{ t('res.remove') }}</QButton>
                </li>
                <li v-if="!data.officials.length" class="p-res-muted">{{ t('res.noOfficials') }}</li>
              </ul>
            </QCard>
            <QCard>
              <form class="p-res-grid" novalidate @submit.prevent="act(() => esp05.assignOfficial(eventId, { principalId: ofc.principalId.trim(), role: ofc.role, matchId: ofc.matchId || null, overrideReason: ofc.override || null }))">
                <QTextField id="ofc-p" v-model="ofc.principalId" :label="t('res.principal')" ltr />
                <QSelect id="ofc-r" v-model="ofc.role" :label="t('res.roleLabel')" :options="roleOpts" />
                <QSelect id="ofc-m" v-model="ofc.matchId" :label="t('case.match')" :options="matchOpts" />
                <QTextField id="ofc-o" v-model="ofc.override" :label="t('res.override')" />
                <div><QButton type="submit" variant="green" icon="plus" :disabled="!ofc.principalId.trim()">{{ t('res.appoint') }}</QButton></div>
              </form>
            </QCard>
          </div>

          <!-- correction -->
          <div v-else-if="item.key === 'correction'" class="k-stack">
            <div class="p-res-cols">
              <QCard>
                <div class="k-stack">
                  <QSelect id="cor-m" v-model="corMatch" :label="t('case.match')" :placeholder="'—'" :options="finalOpts" />
                  <QSelect id="cor-w" v-model="winner" :label="t('case.winnerSide')" :options="[{ value: '0', label: t('case.side', { n: fa(1) }) }, { value: '1', label: t('case.side', { n: fa(2) }) }]" />
                  <QTextField id="cor-r" v-model="cor.reason" :label="t('evm.reason')" multiline :rows="2" />
                  <div class="k-row">
                    <QButton variant="secondary" :disabled="!cor.matchId" @click="preview">{{ t('res.preview') }}</QButton>
                    <QButton variant="ghost" :disabled="cor.reason.length < 5 || !cor.matchId" @click="requestApproval('match.result.correct')">{{ t('res.requestApproval') }}</QButton>
                  </div>
                </div>
              </QCard>
              <QCard>
                <div v-if="cor.impact" class="k-stack">
                  <QAlert v-if="cor.impact.startedDependents.length" tone="danger">{{ t('res.blocked', { n: fa(cor.impact.startedDependents.length) }) }}</QAlert>
                  <QFacts :items="impactFacts" :columns="3" dense />
                  <ul v-if="cor.impact.standings.length" class="p-res-list"><li v-for="s in cor.impact.standings" :key="s.id"><bdi class="q-ltr">{{ s.id }}</bdi>: {{ s.rankBefore != null ? fa(s.rankBefore) : '—' }} ← {{ s.rankAfter != null ? fa(s.rankAfter) : '—' }}</li></ul>
                  <ul v-if="cor.impact.prizes.length" class="p-res-list"><li v-for="p in cor.impact.prizes" :key="p.id">{{ p.title }} — <QMoney :rial="p.amountRial" size="sm" /> <QStatusBadge :state="p.state" /></li></ul>
                  <QTextField id="cor-a" v-model="cor.approvalId" :label="t('res.approvalId')" ltr />
                  <div class="k-row">
                    <QButton :disabled="!cor.approvalId || cor.reason.length < 5" @click="act(() => esp05.correct(cor.matchId, { outcome: outcome(), reason: cor.reason, approvalId: cor.approvalId, caseId: null }))">{{ t('res.apply') }}</QButton>
                    <QButton variant="secondary" :disabled="!cor.approvalId || cor.reason.length < 5" @click="act(() => esp05.reopen(cor.matchId, cor.reason, cor.approvalId))">{{ t('res.reopen') }}</QButton>
                  </div>
                  <p class="p-res-muted">{{ t('res.correctionHint') }}</p>
                </div>
                <p v-else class="p-res-muted">{{ t('res.previewFirst') }}</p>
              </QCard>
            </div>
            <QCard v-if="data.corrections.length" padding="none">
              <ul class="p-res-rows">
                <li v-for="c in data.corrections" :key="c._id">
                  <span><code class="q-mono q-ltr">{{ c._id }}</code> <QStatusBadge :state="c.state" /> <span class="p-res-muted q-ltr">{{ c.steps.join(' → ') }}</span>
                    <span v-if="c.error" class="p-res-err"> {{ c.error }}</span></span>
                  <span class="k-row">
                    <RouterLink v-if="c.caseId" :to="`/cases/${c.caseId}`">{{ t('res.case') }}</RouterLink>
                    <QButton v-if="c.state === 'failed'" size="sm" variant="secondary" icon="refresh" @click="act(() => esp05.resume(c._id))">{{ t('res.resume') }}</QButton>
                  </span>
                </li>
              </ul>
            </QCard>
          </div>

          <!-- sanctions -->
          <div v-else-if="item.key === 'sanctions'" class="k-stack">
            <QAlert tone="info">{{ t('res.sanctionHint') }}</QAlert>
            <QCard>
              <form class="k-stack" novalidate @submit.prevent="act(() => esp05.issueSanction(sanctionBody()))">
                <div class="p-res-grid">
                  <QSelect id="snc-k" v-model="snc.subjectKind" :label="t('res.subjectKind')" :options="[{ value: 'participation', label: t('res.participation') }, { value: 'principal', label: t('res.person') }, { value: 'team', label: t('res.team') }]" />
                  <QTextField id="snc-r" v-model="snc.subjectRef" :label="t('res.subjectRef')" ltr />
                  <QTextField id="snc-n" v-model="snc.displayName" :label="t('res.displayName')" />
                  <QSelect id="snc-t" v-model="snc.type" :label="t('res.sanctionType')" :options="SNC_TYPES.map((x) => ({ value: x, label: t(`snc.type.${x}` as never) }))" />
                  <QTextField v-if="snc.type === 'point_penalty'" id="snc-p" v-model="snc.points" :label="t('res.points')" type="number" ltr />
                  <QTextField v-if="snc.type === 'point_penalty'" id="snc-s" v-model="snc.stageId" :label="t('res.stageId')" ltr />
                  <QDateField v-if="snc.type === 'suspension_temporary'" id="snc-u" v-model="snc.until" :label="t('res.until')" with-time disable-past />
                  <QTextField id="snc-c" v-model="snc.clauseKey" :label="t('case.clauseKey')" :hint="t('case.clauseHint')" ltr />
                </div>
                <QTextField id="snc-re" v-model="snc.reason" :label="t('evm.reason')" multiline :rows="2" />
                <div><QButton type="submit" variant="danger" :disabled="!snc.subjectRef || !snc.clauseKey || snc.reason.length < 5">{{ t('res.issue') }}</QButton></div>
              </form>
            </QCard>
          </div>

          <!-- close-out -->
          <div v-else class="k-stack">
            <QCard padding="none">
              <ul class="p-res-rows">
                <li v-for="c in checks" :key="c.label">
                  <span class="k-row"><QIcon :name="c.ok ? 'check-circle' : 'x'" :class="c.ok ? 'p-res-ok' : 'p-res-err'" /> <span>{{ c.label }}<span v-if="c.detail" class="p-res-muted"> — {{ c.detail }}</span></span></span>
                </li>
                <li v-for="c in data.blockers.openCases" :key="c.id"><RouterLink :to="`/cases/${c.id}`">{{ t('res.openCase') }} — {{ t(`case.cat.${c.category}` as never) }}</RouterLink></li>
                <li v-for="c in data.blockers.corrections" :key="c.id"><span>{{ t('res.openCorrection') }} <code class="q-mono q-ltr">{{ c.id }}</code> <QStatusBadge :state="c.state" /></span></li>
                <li><span>{{ t('res.obligations') }}: <QMoney :rial="data.blockers.openObligationsRial" size="sm" /></span></li>
              </ul>
            </QCard>
            <QCard>
              <div class="k-stack">
                <div class="p-res-grid">
                  <QTextField id="cl-v" v-model="clsVersion" :label="t('res.version')" type="number" ltr />
                  <QTextField id="cl-a" v-model="cls.approvalId" :label="t('res.approvalId')" ltr />
                </div>
                <div class="k-row">
                  <QButton variant="green" :disabled="!data.blockers.canFinish" @click="act(() => esp05.finish(eventId, cls.version))">{{ t('res.finish') }}</QButton>
                  <QButton variant="secondary" @click="requestApproval('event.close')">{{ t('res.requestCloseApproval') }}</QButton>
                  <QButton :disabled="!data.blockers.canClose" @click="act(() => esp05.close(eventId, cls.version, cls.approvalId || null), t('res.closed'))">{{ t('res.closeEvent') }}</QButton>
                  <QButton variant="ghost" @click="act(() => esp05.archive(eventId, cls.version))">{{ t('res.archive') }}</QButton>
                </div>
                <p class="p-res-muted">{{ t('res.closeHint') }}</p>
              </div>
            </QCard>
          </div>
        </template>
      </QTabs>
      <QCode v-if="report" block copy class="p-res-report">{{ JSON.stringify(report, null, 2) }}</QCode>
    </div>
    <QConfirmDialog
      :open="!!unassign" :require-reason="false" :title="t('res.remove')" :message="t('res.removeBody')" :confirm-label="t('res.remove')" :cancel-label="t('common.cancel')"
      @close="unassign = null" @confirm="() => { const id = unassign; unassign = null; if (id) act(() => esp05.unassignOfficial(id)); }"
    />
  </QContainer>
</template>

<style scoped>
.p-res-rows { margin: 0; padding: 0; list-style: none; }
.p-res-rows > li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
.p-res-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); align-items: end; }
.p-res-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: var(--space-4); align-items: start; }
.p-res-list { margin: 0; padding-inline-start: var(--space-5); }
.p-res-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-res-err { color: var(--danger-text); }
.p-res-ok { color: var(--green-text); }
.p-res-report { max-block-size: 20rem; overflow: auto; }
</style>
