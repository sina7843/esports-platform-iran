<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api } from '../api/esp05';
import { toClientError } from '../errors';
import { honorLabel, t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';
import ErrorNote from './ErrorNote.vue';
import JalaliDate from './JalaliDate.vue';
import StatusBadge from './StatusBadge.vue';

/** Public event results: honors with share cards (AWD-003), public case decisions (REF-006), participant feedback and case filing. */
const props = defineProps<{ eventId: string; token?: string | undefined; state: string }>();
const esp05: typeof esp05Api = esp05Api;
const { data, load } = useLoad(async () => ({ honors: (await esp05.eventHonors(props.eventId, props.token)).items ?? [], decisions: (await esp05.decisions(props.eventId, props.token)).items ?? [] }));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const fb = reactive({ score: 5, comment: '' });
const kase = reactive({ category: 'conduct', claim: '' });
async function act(fn: () => Promise<unknown>, ok: string) {
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
</script>

<template>
  <section class="card stack" aria-labelledby="er-h">
    <h2 id="er-h">{{ t('hon.eventTitle') }}</h2>
    <ErrorNote :error="failure" />
    <p v-if="notice" role="status" class="ok">{{ notice }}</p>
    <p v-if="data && !data.honors.length" class="muted">{{ t('hon.noneYet') }}</p>
    <ul v-if="data && data.honors.length" class="honors">
      <li v-for="h in data.honors" :key="h.id" class="honor" :class="{ revoked: h.state === 'revoked' }">
        <strong>{{ honorLabel(h.label) }}</strong>
        <bdi>{{ h.team?.nameAtTime ?? h.recipients.map((r) => r.displayName).join('، ') }}</bdi>
        <StatusBadge v-if="h.state !== 'active'" :state="h.state" />
        <a :href="esp05.cardUrl(h.id)" target="_blank" rel="noopener">{{ t('hon.card') }}</a>
        <RouterLink :to="`/verify/${h.verifyCode}`" class="small"><bdi class="ltr">{{ h.verifyCode }}</bdi></RouterLink>
      </li>
    </ul>
    <template v-if="data && data.decisions.length">
      <h3>{{ t('case.publicDecisions') }}</h3>
      <ul class="list">
        <li v-for="d in data.decisions" :key="d.caseId">
          {{ t(`case.cat.${d.category}` as never) }} — <StatusBadge :state="d.state" />
          <ul class="list"><li v-for="(x, i) in d.decisions" :key="i"><JalaliDate :iso="x.at" format="date" /> · <span dir="auto">{{ x.summary }}</span> <span class="muted small">(<bdi class="ltr">{{ x.clause }}</bdi>)</span></li></ul>
        </li>
      </ul>
    </template>
    <template v-if="session.me">
      <details v-if="['active', 'paused', 'finished'].includes(state)">
        <summary>{{ t('case.fileTitle') }}</summary>
        <form class="stack" novalidate @submit.prevent="act(() => esp05.fileCase(eventId, { matchId: null, category: kase.category, claim: kase.claim, evidenceFileIds: [] }), t('case.filed'))">
          <label for="er-cat">{{ t('case.category') }}</label>
          <select id="er-cat" v-model="kase.category" class="input"><option v-for="c in ['eligibility', 'conduct', 'cheating', 'schedule', 'other']" :key="c" :value="c">{{ t(`case.cat.${c}` as never) }}</option></select>
          <label for="er-cl">{{ t('case.claim') }}</label>
          <textarea id="er-cl" v-model="kase.claim" class="input" rows="3" dir="auto" />
          <button type="submit" class="btn btn-sm" :disabled="kase.claim.trim().length < 10">{{ t('case.file') }}</button>
        </form>
      </details>
      <form v-if="['finished', 'closed', 'archived'].includes(state)" class="row" novalidate @submit.prevent="act(() => esp05.feedback(eventId, fb.score, fb.comment || null), t('hon.thanks'))">
        <label for="er-sc">{{ t('hon.feedback') }}</label>
        <select id="er-sc" v-model.number="fb.score" class="input"><option v-for="n in [5, 4, 3, 2, 1]" :key="n" :value="n">{{ n }}</option></select>
        <label class="sr-only" for="er-cm">{{ t('hon.comment') }}</label>
        <input id="er-cm" v-model="fb.comment" class="input grow" dir="auto" :placeholder="t('hon.comment')" />
        <button type="submit" class="btn btn-sm">{{ t('hon.send') }}</button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.honors { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--sp-2); }
.honor { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.revoked { text-decoration: line-through; opacity: 0.7; }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.grow { flex: 1 1 12rem; }
.ok { color: var(--ok); }
.small { font-size: var(--fs-xs); }
h2, h3, p { margin: 0; }
</style>
