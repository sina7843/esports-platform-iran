<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * ADM-008 support queue (priority, category, assignee, SLA, links to match/payment, history, internal notes) and
 * ADM-009 moderation appeals (a different moderator decides).
 */
const esp07: typeof esp07Api = esp07Api;
const filter = reactive({ state: '', category: '' });
const queue = useLoad(() => esp07.ticketQueue({ ...(filter.state ? { state: filter.state } : {}), ...(filter.category ? { category: filter.category } : {}) }));
const appeals = useLoad(() => esp07.appeals().catch(() => ({ items: [] })));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>, reload: Array<() => Promise<void>>) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = t('a7.saved');
    for (const r of reload) await r();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const open = ref<Awaited<ReturnType<typeof esp07.ticket>> | null>(null);
const text = ref('');
const internal = ref(false);
const assignee = ref('');
async function show(id: string) {
  failure.value = null;
  try {
    open.value = await esp07.ticket(id);
    assignee.value = open.value.assigneeId ?? '';
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const STATES = ['open', 'pending', 'resolved', 'closed'];
</script>

<template>
  <PageHeader :title="t('a7.tickets.title')" :lead="t('a7.tickets.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <div class="row">
    <label>{{ t('a7.users.status') }} <select v-model="filter.state" class="input" @change="queue.load"><option value="">{{ t('a7.tickets.openOnly') }}</option><option v-for="s in STATES" :key="s" :value="s">{{ t(`a7.tstate.${s}` as never) }}</option></select></label>
    <label>{{ t('a7.support.category') }} <select v-model="filter.category" class="input" @change="queue.load"><option value="">{{ t('a7.all') }}</option><option v-for="c in ['account', 'payment', 'registration', 'match', 'result', 'content', 'technical', 'other']" :key="c" :value="c">{{ t(`a7.cat.${c}` as never) }}</option></select></label>
  </div>
  <DataState :loading="queue.loading.value" :error="queue.error.value" :empty="!!queue.data.value && queue.data.value.items.length === 0" @retry="queue.load">
    <ul v-if="queue.data.value" class="plain stack block">
      <li v-for="x in queue.data.value.items" :key="x._id" class="card row between" :class="{ late: x.overdue }">
        <button type="button" class="link" @click="show(x._id)"><bdi>{{ x.subject }}</bdi></button>
        <span class="row small"><StatusBadge :state="x.state" /> {{ t(`a7.prio.${x.priority}` as never) }} · {{ t(`a7.cat.${x.category}` as never) }} · <strong v-if="x.overdue" class="bad">{{ t('a7.tickets.overdue') }}</strong><JalaliDate v-else :iso="x.slaDueAt" /></span>
      </li>
    </ul>
  </DataState>

  <section v-if="open" class="card stack block" :aria-label="open.subject">
    <div class="row between"><h2><bdi>{{ open.subject }}</bdi></h2><StatusBadge :state="open.state" /></div>
    <p class="small">{{ t('a7.tickets.links') }}: <bdi class="ltr">{{ JSON.stringify(open.links) }}</bdi></p>
    <ol class="plain stack">
      <li v-for="(m, i) in open.messages" :key="i" class="msg" :class="{ note: m.internal }"><span class="small muted"><JalaliDate :iso="m.at" /> · <bdi class="ltr">{{ m.by }}</bdi><strong v-if="m.internal"> · {{ t('a7.tickets.internal') }}</strong></span><p dir="auto">{{ m.text }}</p></li>
    </ol>
    <form class="stack" @submit.prevent="act(async () => { await esp07.reply(open!._id, text, internal); text = ''; await show(open!._id); }, [queue.load])">
      <textarea v-model="text" class="input" rows="3" dir="auto" :aria-label="t('a7.support.reply')" />
      <label><input v-model="internal" type="checkbox" /> {{ t('a7.tickets.internalNote') }}</label>
      <button type="submit" class="btn btn-primary" :disabled="!text.trim()">{{ t('a7.support.reply') }}</button>
    </form>
    <div class="row">
      <button v-for="s in STATES.filter((x) => x !== open!.state)" :key="s" type="button" class="btn btn-sm" @click="act(async () => { await esp07.manageTicket(open!._id, { state: s }); await show(open!._id); }, [queue.load])">{{ t(`a7.tstate.${s}` as never) }}</button>
      <select class="input" :aria-label="t('a7.priority')" :value="open.priority" @change="act(async () => { await esp07.manageTicket(open!._id, { priority: ($event.target as HTMLSelectElement).value }); await show(open!._id); }, [queue.load])"><option v-for="p in ['low', 'normal', 'high', 'urgent']" :key="p" :value="p">{{ t(`a7.prio.${p}` as never) }}</option></select>
      <input v-model="assignee" class="input ltr" :placeholder="t('a7.tickets.assignee')" :aria-label="t('a7.tickets.assignee')" />
      <button type="button" class="btn btn-sm" @click="act(async () => { await esp07.manageTicket(open!._id, { assigneeId: assignee || null }); await show(open!._id); }, [queue.load])">{{ t('a7.tickets.assign') }}</button>
    </div>
    <details><summary>{{ t('a7.tickets.history') }}</summary><ul class="small"><li v-for="(h, i) in open.history" :key="i"><JalaliDate :iso="h.at" /> — {{ h.action }} (<bdi class="ltr">{{ h.by }}</bdi>)</li></ul></details>
  </section>

  <section class="block" aria-labelledby="ap-h">
    <h2 id="ap-h">{{ t('a7.appeals.title') }}</h2>
    <p class="muted small">{{ t('a7.appeals.lead') }}</p>
    <DataState :loading="appeals.loading.value" :error="appeals.error.value" :empty="!!appeals.data.value && appeals.data.value.items.length === 0" @retry="appeals.load">
      <ul v-if="appeals.data.value" class="plain stack">
        <li v-for="a in appeals.data.value.items" :key="a._id" class="card stack">
          <p><strong>{{ a.targetType }}</strong> — <span dir="auto">{{ a.reason }}</span></p>
          <p dir="auto">{{ a.appeal.text }}</p>
          <div class="row">
            <button type="button" class="btn btn-sm" @click="act(() => esp07.decideAppeal(a._id, 'upheld'), [appeals.load])">{{ t('a7.appeals.uphold') }}</button>
            <button type="button" class="btn btn-sm btn-primary" @click="act(() => esp07.decideAppeal(a._id, 'reversed'), [appeals.load])">{{ t('a7.appeals.reverse') }}</button>
          </div>
        </li>
      </ul>
    </DataState>
  </section>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.plain { list-style: none; margin: 0; padding: 0; }
.block { margin-block-start: var(--sp-4); }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; text-decoration: underline; padding: 0; font: inherit; }
.msg { border-inline-start: 3px solid var(--border); padding-inline-start: var(--sp-2); }
.note { border-inline-start-color: var(--warn); background: var(--surface-2, transparent); }
.late { border-inline-start: 4px solid var(--danger, #b00020); }
.bad { color: var(--danger, #b00020); }
.small { font-size: var(--fs-xs); }
.ok { color: var(--ok); }
h2, p { margin: 0; }
</style>
