<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
</script>

<template>
  <PageHeader :title="t('a7.support.title')" :lead="t('a7.support.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <section class="card stack" aria-labelledby="st-new">
    <h2 id="st-new">{{ t('a7.support.new') }}</h2>
    <form class="stack" @submit.prevent="open">
      <div class="grid">
        <FormField id="st-s" :label="t('a7.support.subject')"><template #default="{ id: fid }"><input :id="fid" v-model="f.subject" class="input" dir="auto" maxlength="200" /></template></FormField>
        <FormField id="st-c" :label="t('a7.support.category')"><template #default="{ id: fid }"><select :id="fid" v-model="f.category" class="input"><option v-for="c in CATS" :key="c" :value="c">{{ t(`a7.cat.${c}` as never) }}</option></select></template></FormField>
        <FormField id="st-p" :label="t('a7.priority')" :hint="t('a7.support.prioHint')"><template #default="{ id: fid, describedBy }"><select :id="fid" v-model="f.priority" class="input" :aria-describedby="describedBy"><option v-for="p in ['low', 'normal', 'high']" :key="p" :value="p">{{ t(`a7.prio.${p}` as never) }}</option></select></template></FormField>
      </div>
      <FormField id="st-t" :label="t('a7.support.text')"><template #default="{ id: fid }"><textarea :id="fid" v-model="f.text" class="input" rows="4" dir="auto" maxlength="4000" /></template></FormField>
      <details>
        <summary>{{ t('a7.support.links') }}</summary>
        <div class="grid">
          <FormField id="st-pay" :label="t('a7.support.payment')"><template #default="{ id: fid }"><input :id="fid" v-model="f.paymentId" class="input ltr" /></template></FormField>
          <FormField id="st-m" :label="t('a7.support.match')"><template #default="{ id: fid }"><input :id="fid" v-model="f.matchId" class="input ltr" /></template></FormField>
          <FormField id="st-r" :label="t('a7.support.registration')"><template #default="{ id: fid }"><input :id="fid" v-model="f.registrationId" class="input ltr" /></template></FormField>
        </div>
      </details>
      <button type="submit" class="btn btn-primary" :disabled="f.subject.trim().length < 3 || f.text.trim().length < 5">{{ t('a7.support.send') }}</button>
    </form>
  </section>

  <section class="block" aria-labelledby="st-mine">
    <h2 id="st-mine">{{ t('a7.support.mine') }}</h2>
    <DataState :loading="loading" :error="error" :empty="!!data && data.items.length === 0" @retry="load">
      <ul v-if="data" class="plain stack">
        <li v-for="x in data.items" :key="x._id" class="card row between">
          <button type="button" class="link" @click="show(x._id)"><bdi>{{ x.subject }}</bdi></button>
          <span class="row small"><StatusBadge :state="x.state" /> {{ t(`a7.cat.${x.category}` as never) }} · <JalaliDate :iso="x.updatedAt" /></span>
        </li>
      </ul>
    </DataState>
  </section>

  <section v-if="current" class="card stack block" aria-live="polite" :aria-label="current.subject">
    <div class="row between"><h2><bdi>{{ current.subject }}</bdi></h2><StatusBadge :state="current.state" /></div>
    <p class="small muted">{{ t('a7.support.sla') }}: <JalaliDate :iso="current.slaDueAt" /></p>
    <ol class="plain stack">
      <li v-for="(m, i) in current.messages" :key="i" class="msg"><span class="small muted"><JalaliDate :iso="m.at" /></span><p dir="auto">{{ m.text }}</p></li>
    </ol>
    <form v-if="current.state !== 'closed'" class="row" @submit.prevent="send">
      <textarea v-model="reply" class="input grow" rows="2" dir="auto" :aria-label="t('a7.support.reply')" />
      <button type="submit" class="btn" :disabled="!reply.trim()">{{ t('a7.support.reply') }}</button>
    </form>
  </section>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-2); align-items: end; }
.plain { list-style: none; margin: 0; padding: 0; }
.block { margin-block-start: var(--sp-4); }
.grow { flex: 1 1 16rem; }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; text-decoration: underline; padding: 0; font: inherit; }
.msg { border-inline-start: 3px solid var(--border); padding-inline-start: var(--sp-2); }
.small { font-size: var(--fs-xs); }
.ok { color: var(--ok); }
h2, p { margin: 0; }
</style>
