<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QButton, QCard, QContainer, QDataState, QPageHeader, QSection, QSelect, QStatusBadge, QTextField, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** ADM-008 requester side: open a ticket (optionally linked to my payment/match/registration), follow replies. */
const esp07: typeof esp07Api = esp07Api;
const { data, loading, error, load } = useLoad(() => esp07.myTickets());
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const f = reactive({ subject: '', text: '', category: 'other', priority: 'normal', paymentId: '', matchId: '', registrationId: '' });
async function open() {
  failure.value = null;
  notice.value = '';
  try {
    const links = { paymentId: f.paymentId || null, matchId: f.matchId || null, registrationId: f.registrationId || null };
    await esp07.openTicket({ subject: f.subject, text: f.text, category: f.category, priority: f.priority, links });
    Object.assign(f, { subject: '', text: '', paymentId: '', matchId: '', registrationId: '' });
    notice.value = t('a7.support.opened');
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const current = ref<Awaited<ReturnType<typeof esp07.ticket>> | null>(null);
const reply = ref('');
async function show(id: string) {
  failure.value = null;
  try {
    current.value = await esp07.ticket(id);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function send() {
  if (!current.value) return;
  failure.value = null;
  try {
    await esp07.reply(current.value._id, reply.value, false);
    reply.value = '';
    await show(current.value._id);
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const CATS = ['account', 'payment', 'registration', 'match', 'result', 'content', 'technical', 'other'];
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 4000 }); });
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error, empty: () => !!data.value && !data.value.items.length });
// a broken-link report from the not-found page arrives as ?topic=broken-link&path=…
const route = useRoute();
if (route.query['topic'] === 'broken-link') {
  f.category = 'technical';
  f.subject = t('su.broken');
  f.text = `${t('su.brokenPath')} ${String(route.query['path'] ?? '')}${route.query['ref'] ? `\n${t('su.brokenRef')} ${String(route.query['ref'])}` : ''}`;
}
</script>

<template>
  <QContainer>
    <div class="k-stack p-sup">
      <QPageHeader compact :title="t('a7.support.title')" :description="t('a7.support.lead')" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <div class="p-sup-grid">
        <div class="k-stack p-sup-col">
          <QSection id="mine" small :title="t('a7.support.mine')">
            <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" skeleton="rows" icon="inbox" :empty-title="t('su.none')" @retry="load" />
            <QCard v-else padding="none">
              <ul class="p-sup-list">
                <li v-for="x in data.items" :key="x._id">
                  <button type="button" class="p-sup-item" :aria-current="current?._id === x._id ? 'true' : undefined" @click="show(x._id)">
                    <strong><bdi>{{ x.subject }}</bdi></strong>
                    <span class="p-sup-meta"><QStatusBadge :state="x.state" machine="ticket" /> {{ t(`a7.cat.${x.category}` as never) }} · {{ formatJalali(x.updatedAt) }}</span>
                  </button>
                </li>
              </ul>
            </QCard>
          </QSection>
          <QCard v-if="current" aria-live="polite">
            <div class="k-stack">
              <div class="p-sup-head"><h2 class="h4 p-sup-h"><bdi>{{ current.subject }}</bdi></h2><QStatusBadge :state="current.state" machine="ticket" /></div>
              <p class="p-sup-meta">{{ t('a7.support.sla') }}: {{ formatJalali(current.slaDueAt) }}</p>
              <ol class="p-sup-thread">
                <li v-for="(m, i) in current.messages" :key="i"><span class="p-sup-meta">{{ formatJalali(m.at) }}</span><p dir="auto">{{ m.text }}</p></li>
              </ol>
              <form v-if="current.state !== 'closed'" class="p-sup-reply" novalidate @submit.prevent="send">
                <QTextField v-model="reply" :label="t('a7.support.reply')" hide-label multiline :rows="2" />
                <QButton type="submit" variant="green" icon="send" :disabled="!reply.trim()">{{ t('a7.support.reply') }}</QButton>
              </form>
            </div>
          </QCard>
        </div>
        <QSection id="new" small :title="t('a7.support.new')">
          <QCard>
            <form class="k-stack" novalidate @submit.prevent="open">
              <QTextField id="st-s" v-model="f.subject" :label="t('a7.support.subject')" :max-length="200" required />
              <QSelect id="st-c" v-model="f.category" :label="t('a7.support.category')" :options="CATS.map((c) => ({ value: c, label: t(`a7.cat.${c}` as never) }))" />
              <QSelect id="st-p" v-model="f.priority" :label="t('a7.priority')" :hint="t('a7.support.prioHint')" :options="['low', 'normal', 'high'].map((p) => ({ value: p, label: t(`a7.prio.${p}` as never) }))" />
              <QTextField id="st-t" v-model="f.text" :label="t('a7.support.text')" multiline :rows="4" :max-length="4000" required />
              <details class="p-sup-more">
                <summary>{{ t('a7.support.links') }}</summary>
                <div class="k-stack">
                  <QTextField id="st-pay" v-model="f.paymentId" :label="t('a7.support.payment')" ltr />
                  <QTextField id="st-m" v-model="f.matchId" :label="t('a7.support.match')" ltr />
                  <QTextField id="st-r" v-model="f.registrationId" :label="t('a7.support.registration')" ltr />
                </div>
              </details>
              <div><QButton type="submit" variant="primary" icon="send" :disabled="f.subject.trim().length < 3 || f.text.trim().length < 5">{{ t('a7.support.send') }}</QButton></div>
            </form>
          </QCard>
        </QSection>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-sup { gap: var(--space-6); }
.p-sup-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-sup-col { gap: var(--space-6); }
.p-sup-list { margin: 0; padding: 0; list-style: none; }
.p-sup-item { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); inline-size: 100%; padding: var(--space-3) var(--space-4); border: 0; border-block-end: 1px solid var(--line); background: transparent; color: var(--ink); font: inherit; text-align: start; cursor: pointer; min-block-size: 56px; }
.p-sup-item:hover { background: var(--surface-hover); }
.p-sup-item[aria-current='true'] { background: var(--green-soft); }
.p-sup-meta { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; font-size: 13px; color: var(--ink-subtle); }
.p-sup-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-sup-h { margin: 0; }
.p-sup-thread { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-3); }
.p-sup-thread li { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-sunken); }
.p-sup-thread p { margin: var(--space-1) 0 0; white-space: pre-wrap; }
.p-sup-reply { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
.p-sup-more summary { cursor: pointer; min-block-size: 44px; display: flex; align-items: center; font-weight: 700; color: var(--green-text); }
@media (max-width: 1000px) { .p-sup-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
