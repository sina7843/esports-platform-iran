<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QBadge, QButton, QCard, QCaseHeader, QContainer, QDataState, QFacts, QRadioGroup, QSection, QSelect, QTextField, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api, type Outcome } from '../api/esp05';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';
/**
 * REF-002..006: one case page, two projections. Parties see the claim, deadlines, their own requests, the public
 * decision summary and can defend/answer/appeal; officials see evidence, reports and private reasoning and act on
 * the case. Every decision cites a frozen rules clause; the server enforces who may do what.
 */
const esp05: typeof esp05Api = esp05Api;
const route = useRoute();
const id = computed(() => String(route.params['id']));
const { data: c, error, load } = useLoad(() => esp05.getCase(id.value));
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
const f = reactive({ defense: '', answer: {} as Record<string, string>, appeal: '', assignee: '', reqTo: '', reqText: '', report: '' });
const d = reactive({ clauseKey: '', publicSummary: '', reasoning: '', effect: 'none' as 'none' | 'result_change', winnerSide: 0 as 0 | 1 });
const outcome = (): Outcome => ({ kind: 'win', winnerSide: d.winnerSide, scores: null, maps: null });
const decision = () => ({ clauseKey: d.clauseKey.trim(), publicSummary: d.publicSummary.trim(), reasoning: d.reasoning.trim(), effect: d.effect === 'result_change' ? { kind: 'result_change', outcome: outcome() } : { kind: 'none' } });
const canDecide = computed(() => d.clauseKey.trim().length > 0 && d.publicSummary.trim().length >= 10 && d.reasoning.trim().length >= 10);
const official = computed(() => c.value?.role === 'official');
const requests = computed(() => c.value?.requests ?? c.value?.evidenceRequests ?? []);
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 4000 }); });
const effectModel = computed({ get: () => d.effect, set: (v: string | undefined) => { d.effect = v === 'result_change' ? 'result_change' : 'none'; } });
const winner = computed({ get: () => String(d.winnerSide), set: (v: string) => { d.winnerSide = v === '1' ? 1 : 0; } });
const facts = computed(() => (c.value ? [
  { label: t('case.defenseBy'), value: formatJalali(c.value.deadlines.defenseBy) },
  { label: t('case.appealBy'), value: formatJalali(c.value.deadlines.appealBy) },
  { label: t('case.yourRole'), value: official.value ? t('case.roleOfficial') : t('case.roleParty') },
] : []));
const effectOptions = computed(() => [
  { value: 'none', label: t('case.effectNone') },
  ...(c.value?.matchId ? [{ value: 'result_change', label: t('case.effectResult') }] : []),
]);
</script>

<template>
  <QContainer>
    <QDataState v-if="!c" :state="error ? (error.code === 'FORBIDDEN' ? 'forbidden' : error.code === 'NOT_FOUND' ? 'empty' : 'error') : 'loading'" :request-id="error?.requestId ?? undefined" @retry="load" />
    <div v-else class="k-stack p-case">
      <QCaseHeader
        :case-id="c._id" :title="t('case.title')" :state="c.state as never" :category="t(`case.cat.${c.category}` as never)" :eyebrow="t('case.lead')"
        :deadline="c.deadlines.defenseBy ? { label: t('case.defenseBy'), at: c.deadlines.defenseBy } : undefined" :referee="c.assignee ?? undefined"
        :match="c.matchId ? t('case.openMatch') : undefined" :match-href="c.matchId ? `/matches/${c.matchId}` : undefined"
      />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <div class="p-case-grid">
        <div class="p-case-main">
          <QCard>
            <div class="k-stack">
              <p class="p-case-claim" dir="auto">{{ c.claim }}</p>
              <QFacts :columns="3" dense :items="facts" />
            </div>
          </QCard>
          <QSection id="decisions" small :title="t('case.decisions')">
            <p v-if="!c.decisions.length" class="p-case-muted">{{ t('case.noDecision') }}</p>
            <QCard v-for="(x, i) in c.decisions" :key="i">
              <div class="k-stack">
                <div class="p-case-head"><QBadge :tone="x.level === 'first' ? 'info' : 'warning'">{{ x.level === 'first' ? t('case.first') : t('case.appealLevel') }}</QBadge><span class="p-case-muted">{{ formatJalali(x.at) }}</span></div>
                <p class="p-case-p" dir="auto">{{ x.publicSummary }}</p>
                <p class="p-case-muted">{{ t('case.clause') }}: <bdi class="q-ltr q-mono">{{ x.rulesRef.clauseKey }}</bdi> — <span dir="auto">{{ x.rulesRef.citation }}</span></p>
                <QAlert v-if="x.reasoning" tone="warning" icon="lock" :title="t('case.privateReasoning')">{{ x.reasoning }}</QAlert>
              </div>
            </QCard>
          </QSection>
          <QSection v-if="c.defense?.length" id="defense" small :title="t('case.defense')">
            <QCard><ul class="p-case-log"><li v-for="(x, i) in c.defense" :key="i" dir="auto">{{ formatJalali(x.at) }} — {{ x.text }}</li></ul></QCard>
          </QSection>
        </div>

        <aside class="p-case-side">
          <!-- party actions -->
          <QCard v-if="!official">
            <div class="k-stack">
              <h2 class="h4 p-case-h">{{ t('case.actions') }}</h2>
              <form v-if="['filed', 'assigned', 'defense_received', 'under_review'].includes(c.state)" class="k-stack" novalidate @submit.prevent="act(() => esp05.defend(id, f.defense))">
                <QTextField id="cs-def" v-model="f.defense" :label="t('case.defendLabel')" :hint="t('case.minText')" multiline :rows="3" />
                <div><QButton type="submit" variant="secondary" :disabled="f.defense.trim().length < 10">{{ t('case.sendDefense') }}</QButton></div>
              </form>
              <div v-for="r in requests.filter((x) => !x.answer)" :key="r.id" class="k-stack">
                <p class="p-case-p" dir="auto"><strong>{{ t('case.request') }}:</strong> {{ r.text }}</p>
                <form class="k-stack" novalidate @submit.prevent="act(() => esp05.answer(id, r.id, f.answer[r.id] ?? ''))">
                  <QTextField :id="`ans-${r.id}`" v-model="f.answer[r.id]" :label="t('case.answer')" />
                  <div><QButton type="submit" size="sm" variant="secondary" :disabled="(f.answer[r.id] ?? '').trim().length < 10">{{ t('case.send') }}</QButton></div>
                </form>
              </div>
              <form v-if="c.state === 'first_decision'" class="k-stack" novalidate @submit.prevent="act(() => esp05.appeal(id, f.appeal), t('case.appealed'))">
                <QTextField id="cs-ap" v-model="f.appeal" :label="t('case.appealLabel')" :hint="t('case.appealHint')" multiline :rows="3" />
                <div><QButton type="submit" variant="primary" :disabled="f.appeal.trim().length < 10">{{ t('case.appeal') }}</QButton></div>
              </form>
            </div>
          </QCard>

          <!-- official actions -->
          <QCard v-else>
            <div class="k-stack">
              <h2 class="h4 p-case-h">{{ t('case.officialActions') }}</h2>
              <p class="p-case-muted">
                {{ t('case.parties') }}: <bdi v-for="p in c.parties ?? []" :key="p" class="q-ltr p-case-chip">{{ p }}</bdi> · {{ t('case.assignee') }}: <bdi class="q-ltr">{{ c.assignee ?? '—' }}</bdi> ·
                {{ t('case.appealAuthority') }}: <bdi class="q-ltr">{{ c.appealAuthority ?? '—' }}</bdi>
              </p>
              <form v-if="c.state === 'filed'" class="p-case-inline" novalidate @submit.prevent="act(() => esp05.assignCase(id, f.assignee.trim()))">
                <QTextField id="cs-as" v-model="f.assignee" :label="t('case.assignTo')" ltr />
                <QButton type="submit" size="sm" variant="secondary" :disabled="!f.assignee.trim()">{{ t('case.assign') }}</QButton>
              </form>
              <form v-if="['assigned', 'defense_received', 'under_review'].includes(c.state)" class="k-stack" novalidate @submit.prevent="act(() => esp05.requestEvidence(id, f.reqTo.trim(), f.reqText))">
                <QSelect id="cs-rq-to" v-model="f.reqTo" :label="t('case.requestTo')" :options="(c.parties ?? []).map((p) => ({ value: p, label: p }))" />
                <QTextField id="cs-rq-tx" v-model="f.reqText" :label="t('case.request')" />
                <div><QButton type="submit" size="sm" variant="secondary" :disabled="!f.reqTo || f.reqText.trim().length < 10">{{ t('case.send') }}</QButton></div>
              </form>
              <ul v-if="requests.length" class="p-case-log"><li v-for="r in requests" :key="r.id" dir="auto">{{ r.text }} → {{ r.answer ?? t('case.unanswered') }}</li></ul>
              <form class="p-case-inline" novalidate @submit.prevent="act(() => esp05.report(id, f.report))">
                <QTextField id="cs-rep" v-model="f.report" :label="t('case.report')" />
                <QButton type="submit" size="sm" variant="secondary" :disabled="f.report.trim().length < 10">{{ t('case.addReport') }}</QButton>
              </form>
              <ul v-if="c.reports?.length" class="p-case-log"><li v-for="(r, i) in c.reports" :key="i" dir="auto">{{ formatJalali(r.at) }} — {{ r.text }}</li></ul>
              <ul v-if="c.evidence?.length" class="p-case-log"><li v-for="e in c.evidence" :key="e.fileId"><bdi class="q-ltr q-mono">{{ e.fileId }}</bdi> <span v-if="e.note" dir="auto">({{ e.note }})</span></li></ul>
              <div v-if="['assigned', 'defense_received'].includes(c.state)"><QButton variant="green" @click="act(() => esp05.startReview(id))">{{ t('case.startReview') }}</QButton></div>
              <form v-if="['under_review', 'appeal'].includes(c.state)" class="k-stack" novalidate @submit.prevent="act(() => (c!.state === 'appeal' ? esp05.decideAppeal(id, decision()) : esp05.decide(id, decision())), t('case.decided'))">
                <h3 class="h4 p-case-h">{{ c.state === 'appeal' ? t('case.decideAppeal') : t('case.decideFirst') }}</h3>
                <QTextField id="cs-cl" v-model="d.clauseKey" :label="t('case.clauseKey')" :hint="t('case.clauseHint')" ltr />
                <QTextField id="cs-ps" v-model="d.publicSummary" :label="t('case.publicSummary')" :hint="t('case.publicHint')" multiline :rows="2" />
                <QTextField id="cs-rs" v-model="d.reasoning" :label="t('case.reasoning')" :hint="t('case.reasoningHint')" multiline :rows="3" />
                <QRadioGroup v-model="effectModel" :label="t('case.effect')" :options="effectOptions" />
                <QSelect v-if="d.effect === 'result_change'" id="cs-win" v-model="winner" :label="t('case.winnerSide')" :options="[{ value: '0', label: t('case.side', { n: 1 }) }, { value: '1', label: t('case.side', { n: 2 }) }]" />
                <div><QButton type="submit" variant="primary" icon="gavel" :disabled="!canDecide">{{ t('case.issue') }}</QButton></div>
              </form>
              <div v-if="c.state === 'first_decision'"><QButton size="sm" variant="secondary" @click="act(() => esp05.closeCase(id))">{{ t('case.close') }}</QButton></div>
              <p v-if="c.views?.length" class="p-case-muted">{{ t('case.viewed', { n: c.views.length }) }}</p>
              <QAlert v-if="c.linkedCorrectionId" tone="warning">{{ t('case.linkedCorrection') }}: <bdi class="q-ltr">{{ c.linkedCorrectionId }}</bdi></QAlert>
            </div>
          </QCard>
        </aside>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-case { gap: var(--space-6); }
.p-case-h { margin: 0; }
.p-case-p { margin: 0; font-size: 15px; line-height: 28px; }
.p-case-claim { margin: 0; font-size: 16px; line-height: 30px; white-space: pre-line; }
.p-case-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-case-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-case-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-case-main, .p-case-side { display: flex; flex-direction: column; gap: var(--space-6); min-width: 0; }
.p-case-log { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: 13px; color: var(--ink-muted); }
.p-case-inline { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
.p-case-chip { padding-inline: var(--space-1); }
@media (max-width: 1000px) { .p-case-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
