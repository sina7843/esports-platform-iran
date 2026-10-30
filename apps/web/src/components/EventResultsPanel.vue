<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { QButton, QCard, QSelect, QStatusBadge, QTextField, fa, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api } from '../api/esp05';
import { toClientError } from '../errors';
import { honorLabel, t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';

/** Public event results: honors with share cards (AWD-003), public case decisions (REF-006), participant feedback and case filing. */
const props = defineProps<{ eventId: string; token?: string | undefined; state: string }>();
const esp05: typeof esp05Api = esp05Api;
const { data, load } = useLoad(async () => ({ honors: (await esp05.eventHonors(props.eventId, props.token)).items ?? [], decisions: (await esp05.decisions(props.eventId, props.token)).items ?? [] }));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const fb = reactive({ score: '5', comment: '' });
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
const CATS = ['eligibility', 'conduct', 'cheating', 'schedule', 'other'];
</script>

<template>
  <QCard as="section" aria-labelledby="er-h">
    <div class="k-stack">
      <h2 id="er-h" class="h4 p-er-p">{{ t('hon.eventTitle') }}</h2>
      <p v-if="data && !data.honors.length" class="p-er-muted">{{ t('hon.noneYet') }}</p>
      <ul v-if="data && data.honors.length" class="p-er-honors">
        <li v-for="h in data.honors" :key="h.id" :class="{ 'is-revoked': h.state === 'revoked' }">
          <strong>{{ honorLabel(h.label) }}</strong>
          <bdi>{{ h.team?.nameAtTime ?? h.recipients.map((r) => r.displayName).join('، ') }}</bdi>
          <QStatusBadge v-if="h.state !== 'active'" :state="h.state" />
          <a :href="esp05.cardUrl(h.id)" target="_blank" rel="noopener" class="p-er-link">{{ t('hon.card') }}</a>
          <RouterLink :to="`/verify/${h.verifyCode}`" class="p-er-link"><code class="q-mono q-ltr">{{ h.verifyCode }}</code></RouterLink>
        </li>
      </ul>
      <template v-if="data && data.decisions.length">
        <h3 class="p-er-h3">{{ t('case.publicDecisions') }}</h3>
        <ul class="p-er-list">
          <li v-for="d in data.decisions" :key="d.caseId">
            {{ t(`case.cat.${d.category}` as never) }} — <QStatusBadge :state="d.state" />
            <ul class="p-er-list"><li v-for="(x, i) in d.decisions" :key="i">{{ formatJalali(x.at, 'date') }} · <bdi>{{ x.summary }}</bdi> <span class="p-er-muted">(<bdi class="q-ltr">{{ x.clause }}</bdi>)</span></li></ul>
          </li>
        </ul>
      </template>
      <template v-if="session.me">
        <details v-if="['active', 'paused', 'finished'].includes(state)" class="p-er-more">
          <summary>{{ t('case.fileTitle') }}</summary>
          <form class="k-stack" novalidate @submit.prevent="act(() => esp05.fileCase(eventId, { matchId: null, category: kase.category, claim: kase.claim, evidenceFileIds: [] }), t('case.filed'))">
            <QSelect id="er-cat" v-model="kase.category" :label="t('case.category')" :options="CATS.map((c) => ({ value: c, label: t(`case.cat.${c}` as never) }))" />
            <QTextField id="er-cl" v-model="kase.claim" :label="t('case.claim')" multiline :rows="3" />
            <div><QButton type="submit" size="sm" variant="secondary" icon="gavel" :disabled="kase.claim.trim().length < 10">{{ t('case.file') }}</QButton></div>
          </form>
        </details>
        <form v-if="['finished', 'closed', 'archived'].includes(state)" class="p-er-bar" novalidate @submit.prevent="act(() => esp05.feedback(eventId, Number(fb.score), fb.comment || null), t('hon.thanks'))">
          <QSelect id="er-sc" v-model="fb.score" :label="t('hon.feedback')" :options="['5', '4', '3', '2', '1'].map((n) => ({ value: n, label: fa(Number(n)) }))" />
          <QTextField id="er-cm" v-model="fb.comment" :label="t('hon.comment')" />
          <QButton type="submit" size="sm" variant="secondary">{{ t('hon.send') }}</QButton>
        </form>
      </template>
    </div>
  </QCard>
</template>

<style scoped>
.p-er-p { margin: 0; }
.p-er-h3 { margin: 0; font-size: 15px; font-weight: 800; }
.p-er-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-er-honors { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-2); }
.p-er-honors > li { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.p-er-honors > li.is-revoked { text-decoration: line-through; color: var(--ink-muted); }
.p-er-list { margin: 0; padding-inline-start: var(--space-5); display: grid; gap: var(--space-1); }
.p-er-link { color: var(--green-text); font-weight: 700; font-size: 13px; }
.p-er-bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
.p-er-more > summary { cursor: pointer; font-weight: 800; }
.p-er-more[open] > summary { margin-block-end: var(--space-3); }
</style>
