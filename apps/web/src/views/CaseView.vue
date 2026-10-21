<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api, type Outcome } from '../api/esp05';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
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
const { data: c, loading, error, load } = useLoad(() => esp05.getCase(id.value));
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
</script>

<template>
  <PageHeader :title="t('case.title')" :lead="t('case.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="c">
      <section class="card stack" aria-labelledby="case-h">
        <div class="row between">
          <h2 id="case-h">{{ t(`case.cat.${c.category}` as never) }}</h2>
          <StatusBadge :state="c.state" />
        </div>
        <p dir="auto" class="claim">{{ c.claim }}</p>
        <dl class="facts">
          <div v-if="c.matchId"><dt>{{ t('case.match') }}</dt><dd><RouterLink :to="`/matches/${c.matchId}`">{{ t('case.openMatch') }}</RouterLink></dd></div>
          <div><dt>{{ t('case.defenseBy') }}</dt><dd><JalaliDate :iso="c.deadlines.defenseBy" /></dd></div>
          <div><dt>{{ t('case.appealBy') }}</dt><dd><JalaliDate :iso="c.deadlines.appealBy" /></dd></div>
          <div><dt>{{ t('case.yourRole') }}</dt><dd>{{ official ? t('case.roleOfficial') : t('case.roleParty') }}</dd></div>
        </dl>
      </section>

      <section class="card stack block" aria-labelledby="dec-h">
        <h2 id="dec-h">{{ t('case.decisions') }}</h2>
        <p v-if="!c.decisions.length" class="muted">{{ t('case.noDecision') }}</p>
        <article v-for="(x, i) in c.decisions" :key="i" class="decision stack">
          <div class="row between"><strong>{{ x.level === 'first' ? t('case.first') : t('case.appealLevel') }}</strong><JalaliDate :iso="x.at" /></div>
          <p dir="auto">{{ x.publicSummary }}</p>
          <p class="muted small">{{ t('case.clause') }}: <bdi class="ltr">{{ x.rulesRef.clauseKey }}</bdi> — <span dir="auto">{{ x.rulesRef.citation }}</span></p>
          <p v-if="x.reasoning" class="private small" dir="auto"><strong>{{ t('case.privateReasoning') }}:</strong> {{ x.reasoning }}</p>
        </article>
      </section>

      <section v-if="c.defense?.length" class="card stack block">
        <h2>{{ t('case.defense') }}</h2>
        <ul class="list"><li v-for="(x, i) in c.defense" :key="i" dir="auto"><JalaliDate :iso="x.at" /> — {{ x.text }}</li></ul>
      </section>

      <!-- party actions -->
      <section v-if="!official" class="card stack block">
        <h2>{{ t('case.actions') }}</h2>
        <form v-if="['filed', 'assigned', 'defense_received', 'under_review'].includes(c.state)" class="stack" novalidate @submit.prevent="act(() => esp05.defend(id, f.defense))">
          <FormField id="cs-def" :label="t('case.defendLabel')" :hint="t('case.minText')"><template #default="{ id: fid, describedBy }"><textarea :id="fid" v-model="f.defense" class="input" rows="3" dir="auto" :aria-describedby="describedBy" /></template></FormField>
          <button type="submit" class="btn" :disabled="f.defense.trim().length < 10">{{ t('case.sendDefense') }}</button>
        </form>
        <div v-for="r in requests.filter((x) => !x.answer)" :key="r.id" class="stack">
          <p dir="auto"><strong>{{ t('case.request') }}:</strong> {{ r.text }}</p>
          <form class="row" novalidate @submit.prevent="act(() => esp05.answer(id, r.id, f.answer[r.id] ?? ''))">
            <label class="sr-only" :for="`ans-${r.id}`">{{ t('case.answer') }}</label>
            <input :id="`ans-${r.id}`" v-model="f.answer[r.id]" class="input grow" dir="auto" :placeholder="t('case.answer')" />
            <button type="submit" class="btn btn-sm" :disabled="(f.answer[r.id] ?? '').trim().length < 10">{{ t('case.send') }}</button>
          </form>
        </div>
        <form v-if="c.state === 'first_decision'" class="stack" novalidate @submit.prevent="act(() => esp05.appeal(id, f.appeal), t('case.appealed'))">
          <FormField id="cs-ap" :label="t('case.appealLabel')" :hint="t('case.appealHint')"><template #default="{ id: fid, describedBy }"><textarea :id="fid" v-model="f.appeal" class="input" rows="3" dir="auto" :aria-describedby="describedBy" /></template></FormField>
          <button type="submit" class="btn" :disabled="f.appeal.trim().length < 10">{{ t('case.appeal') }}</button>
        </form>
      </section>

      <!-- official actions -->
      <section v-else class="card stack block">
        <h2>{{ t('case.officialActions') }}</h2>
        <p class="muted small">{{ t('case.parties') }}: <bdi v-for="p in c.parties ?? []" :key="p" class="ltr chip">{{ p }}</bdi> · {{ t('case.assignee') }}: <bdi class="ltr">{{ c.assignee ?? '—' }}</bdi> · {{ t('case.appealAuthority') }}: <bdi class="ltr">{{ c.appealAuthority ?? '—' }}</bdi></p>
        <form v-if="c.state === 'filed'" class="row" novalidate @submit.prevent="act(() => esp05.assignCase(id, f.assignee.trim()))">
          <label class="sr-only" for="cs-as">{{ t('case.assignTo') }}</label>
          <input id="cs-as" v-model="f.assignee" class="input ltr" :placeholder="t('case.assignTo')" />
          <button type="submit" class="btn btn-sm" :disabled="!f.assignee.trim()">{{ t('case.assign') }}</button>
        </form>
        <form v-if="['assigned', 'defense_received', 'under_review'].includes(c.state)" class="row" novalidate @submit.prevent="act(() => esp05.requestEvidence(id, f.reqTo.trim(), f.reqText))">
          <label class="sr-only" for="cs-rq-to">{{ t('case.requestTo') }}</label>
          <select id="cs-rq-to" v-model="f.reqTo" class="input"><option value="" disabled>{{ t('case.requestTo') }}</option><option v-for="p in c.parties ?? []" :key="p" :value="p">{{ p }}</option></select>
          <label class="sr-only" for="cs-rq-tx">{{ t('case.request') }}</label>
          <input id="cs-rq-tx" v-model="f.reqText" class="input grow" dir="auto" :placeholder="t('case.request')" />
          <button type="submit" class="btn btn-sm" :disabled="!f.reqTo || f.reqText.trim().length < 10">{{ t('case.send') }}</button>
        </form>
        <ul v-if="requests.length" class="list"><li v-for="r in requests" :key="r.id" dir="auto">{{ r.text }} → {{ r.answer ?? t('case.unanswered') }}</li></ul>
        <form class="row" novalidate @submit.prevent="act(() => esp05.report(id, f.report))">
          <label class="sr-only" for="cs-rep">{{ t('case.report') }}</label>
          <input id="cs-rep" v-model="f.report" class="input grow" dir="auto" :placeholder="t('case.report')" />
          <button type="submit" class="btn btn-sm" :disabled="f.report.trim().length < 10">{{ t('case.addReport') }}</button>
        </form>
        <ul v-if="c.reports?.length" class="list"><li v-for="(r, i) in c.reports" :key="i" dir="auto"><JalaliDate :iso="r.at" /> — {{ r.text }}</li></ul>
        <ul v-if="c.evidence?.length" class="list"><li v-for="e in c.evidence" :key="e.fileId"><bdi class="ltr">{{ e.fileId }}</bdi> <span v-if="e.note" dir="auto">({{ e.note }})</span></li></ul>
        <button v-if="['assigned', 'defense_received'].includes(c.state)" type="button" class="btn" @click="act(() => esp05.startReview(id))">{{ t('case.startReview') }}</button>
        <form v-if="['under_review', 'appeal'].includes(c.state)" class="stack" novalidate @submit.prevent="act(() => (c!.state === 'appeal' ? esp05.decideAppeal(id, decision()) : esp05.decide(id, decision())), t('case.decided'))">
          <h3>{{ c.state === 'appeal' ? t('case.decideAppeal') : t('case.decideFirst') }}</h3>
          <FormField id="cs-cl" :label="t('case.clauseKey')" :hint="t('case.clauseHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="d.clauseKey" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
          <FormField id="cs-ps" :label="t('case.publicSummary')" :hint="t('case.publicHint')"><template #default="{ id: fid, describedBy }"><textarea :id="fid" v-model="d.publicSummary" class="input" rows="2" dir="auto" :aria-describedby="describedBy" /></template></FormField>
          <FormField id="cs-rs" :label="t('case.reasoning')" :hint="t('case.reasoningHint')"><template #default="{ id: fid, describedBy }"><textarea :id="fid" v-model="d.reasoning" class="input" rows="3" dir="auto" :aria-describedby="describedBy" /></template></FormField>
          <fieldset class="row">
            <legend>{{ t('case.effect') }}</legend>
            <label><input v-model="d.effect" type="radio" value="none" /> {{ t('case.effectNone') }}</label>
            <label v-if="c.matchId"><input v-model="d.effect" type="radio" value="result_change" /> {{ t('case.effectResult') }}</label>
            <label v-if="d.effect === 'result_change'">{{ t('case.winnerSide') }}
              <select v-model.number="d.winnerSide" class="input"><option :value="0">{{ t('case.side', { n: 1 }) }}</option><option :value="1">{{ t('case.side', { n: 2 }) }}</option></select>
            </label>
          </fieldset>
          <button type="submit" class="btn btn-primary" :disabled="!canDecide">{{ t('case.issue') }}</button>
        </form>
        <button v-if="c.state === 'first_decision'" type="button" class="btn btn-sm" @click="act(() => esp05.closeCase(id))">{{ t('case.close') }}</button>
        <p v-if="c.views?.length" class="muted small">{{ t('case.viewed', { n: c.views.length }) }}</p>
        <p v-if="c.linkedCorrectionId" class="warn small">{{ t('case.linkedCorrection') }}: <bdi class="ltr">{{ c.linkedCorrectionId }}</bdi></p>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.between { justify-content: space-between; flex-wrap: wrap; gap: var(--sp-2); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.block { margin-block-start: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--sp-2); margin: 0; }
.facts dt { color: var(--text-muted); font-size: var(--fs-sm); }
.facts dd { margin: 0; }
.claim { white-space: pre-wrap; margin: 0; }
.decision { border-inline-start: 3px solid var(--border); padding-inline-start: var(--sp-3); }
.private { background: var(--warn-soft); padding: var(--sp-2); border-radius: var(--radius, 6px); }
.chip { margin-inline-end: var(--sp-1); }
.grow { flex: 1 1 14rem; }
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.small { font-size: var(--fs-xs); }
fieldset { border: 0; padding: 0; margin: 0; }
h2, h3, p { margin: 0; }
</style>
