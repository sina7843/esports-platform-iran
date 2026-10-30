<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QContainer, QDataState, QPageHeader, QSection, QSelect, QStatusBadge, QTextField, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
const CATS = ['account', 'payment', 'registration', 'match', 'result', 'content', 'technical', 'other'];
const PRIOS = ['low', 'normal', 'high', 'urgent'];
const fState = computed({ get: () => filter.state, set: (v: string) => { filter.state = v; void queue.load(); } });
const fCat = computed({ get: () => filter.category, set: (v: string) => { filter.category = v; void queue.load(); } });
const internalModel = computed({ get: () => internal.value, set: (v: boolean | null) => { internal.value = !!v; } });
const prioModel = computed({
  get: () => open.value?.priority ?? 'normal',
  set: (v: string) => { if (open.value) void act(async () => { await esp07.manageTicket(open.value!._id, { priority: v }); await show(open.value!._id); }, [queue.load]); },
});
const prioTone = (p: string) => (p === 'urgent' ? 'danger' : p === 'high' ? 'warning' : 'neutral');
const sendReply = () => act(async () => { await esp07.reply(open.value!._id, text.value, internal.value); text.value = ''; await show(open.value!._id); }, [queue.load]);
const setState = (s: string) => act(async () => { await esp07.manageTicket(open.value!._id, { state: s }); await show(open.value!._id); }, [queue.load]);
const assign = () => act(async () => { await esp07.manageTicket(open.value!._id, { assigneeId: assignee.value || null }); await show(open.value!._id); }, [queue.load]);
</script>

<template>
  <QContainer>
    <div class="k-stack p-tk">
      <QPageHeader compact :title="t('a7.tickets.title')" :description="t('a7.tickets.lead')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('a7.tickets.title') }]" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <div class="p-tk-bar">
        <QSelect id="tk-st" v-model="fState" :label="t('a7.users.status')" :options="[{ value: '', label: t('a7.tickets.openOnly') }, ...STATES.map((s) => ({ value: s, label: t(`a7.tstate.${s}` as never) }))]" />
        <QSelect id="tk-cat" v-model="fCat" :label="t('a7.support.category')" :options="[{ value: '', label: t('a7.all') }, ...CATS.map((c) => ({ value: c, label: t(`a7.cat.${c}` as never) }))]" />
      </div>
      <div class="p-tk-grid">
        <QDataState v-if="!queue.data.value || !queue.data.value.items.length" :state="queue.error.value ? 'error' : queue.loading.value ? 'loading' : 'empty'" skeleton="rows" icon="inbox" @retry="queue.load" />
        <QCard v-else padding="none">
          <ul class="p-tk-list">
            <li v-for="x in queue.data.value.items" :key="x._id">
              <button type="button" :class="['p-tk-item', { 'p-tk-item--late': x.overdue }]" :aria-current="open?._id === x._id ? 'true' : undefined" @click="show(x._id)">
                <strong><bdi>{{ x.subject }}</bdi></strong>
                <span class="p-tk-meta">
                  <QStatusBadge :state="x.state" machine="ticket" />
                  <QBadge :tone="prioTone(x.priority)">{{ t(`a7.prio.${x.priority}` as never) }}</QBadge>
                  {{ t(`a7.cat.${x.category}` as never) }} ·
                  <QBadge v-if="x.overdue" tone="danger" icon="clock">{{ t('a7.tickets.overdue') }}</QBadge>
                  <span v-else>{{ formatJalali(x.slaDueAt) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </QCard>
        <QCard v-if="open" :aria-label="open.subject">
          <div class="k-stack">
            <div class="p-tk-head"><h2 class="h4 p-tk-h"><bdi>{{ open.subject }}</bdi></h2><QStatusBadge :state="open.state" machine="ticket" /></div>
            <p class="p-tk-meta">{{ t('a7.tickets.links') }}: <bdi class="q-ltr q-mono">{{ JSON.stringify(open.links) }}</bdi></p>
            <ol class="p-tk-thread">
              <li v-for="(m, i) in open.messages" :key="i" :class="{ 'p-tk-note': m.internal }">
                <span class="p-tk-meta">{{ formatJalali(m.at) }} · <bdi class="q-ltr">{{ m.by }}</bdi><QBadge v-if="m.internal" tone="warning">{{ t('a7.tickets.internal') }}</QBadge></span>
                <p dir="auto">{{ m.text }}</p>
              </li>
            </ol>
            <form class="k-stack" novalidate @submit.prevent="sendReply">
              <QTextField v-model="text" :label="t('a7.support.reply')" multiline :rows="3" />
              <QCheckbox v-model="internalModel" :label="t('a7.tickets.internalNote')" />
              <div><QButton type="submit" variant="primary" icon="send" :disabled="!text.trim()">{{ t('a7.support.reply') }}</QButton></div>
            </form>
            <div class="k-row">
              <QButton v-for="s in STATES.filter((x) => x !== open!.state)" :key="s" size="sm" variant="secondary" @click="setState(s)">{{ t(`a7.tstate.${s}` as never) }}</QButton>
            </div>
            <div class="p-tk-assign">
              <QSelect id="tk-prio" v-model="prioModel" :label="t('a7.priority')" :options="PRIOS.map((p) => ({ value: p, label: t(`a7.prio.${p}` as never) }))" />
              <QTextField id="tk-as" v-model="assignee" :label="t('a7.tickets.assignee')" ltr />
              <QButton size="sm" variant="secondary" @click="assign">{{ t('a7.tickets.assign') }}</QButton>
            </div>
            <details class="p-tk-more"><summary>{{ t('a7.tickets.history') }}</summary><ul class="p-tk-log"><li v-for="(h, i) in open.history" :key="i">{{ formatJalali(h.at) }} — {{ h.action }} (<bdi class="q-ltr">{{ h.by }}</bdi>)</li></ul></details>
          </div>
        </QCard>
      </div>

      <QSection id="appeals" small :title="t('a7.appeals.title')" :description="t('a7.appeals.lead')">
        <p v-if="!appeals.data.value?.items.length" class="p-tk-meta">—</p>
        <div v-else class="k-stack">
          <QCard v-for="a in appeals.data.value.items" :key="a._id">
            <div class="k-stack">
              <p class="p-tk-p"><QBadge tone="neutral">{{ a.targetType }}</QBadge> <span dir="auto">{{ a.reason }}</span></p>
              <p class="p-tk-p" dir="auto">{{ a.appeal.text }}</p>
              <div class="k-row">
                <QButton size="sm" variant="secondary" @click="act(() => esp07.decideAppeal(a._id, 'upheld'), [appeals.load])">{{ t('a7.appeals.uphold') }}</QButton>
                <QButton size="sm" variant="green" @click="act(() => esp07.decideAppeal(a._id, 'reversed'), [appeals.load])">{{ t('a7.appeals.reverse') }}</QButton>
              </div>
            </div>
          </QCard>
        </div>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-tk { gap: var(--space-6); }
.p-tk-bar { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.p-tk-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--space-6); align-items: start; }
.p-tk-list { margin: 0; padding: 0; list-style: none; }
.p-tk-item { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); inline-size: 100%; min-block-size: 56px; padding: var(--space-3) var(--space-4); border: 0; border-block-end: 1px solid var(--line); background: transparent; color: var(--ink); font: inherit; text-align: start; cursor: pointer; }
.p-tk-item:hover { background: var(--surface-hover); }
.p-tk-item[aria-current='true'] { background: var(--green-soft); }
.p-tk-item--late { border-inline-start: 3px solid var(--danger-line); }
.p-tk-meta { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; font-size: 13px; color: var(--ink-subtle); }
.p-tk-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-tk-h { margin: 0; }
.p-tk-p { margin: 0; font-size: 14px; }
.p-tk-thread { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-3); }
.p-tk-thread li { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-sunken); }
.p-tk-thread li.p-tk-note { border-color: var(--warning-line, var(--line-strong)); background: var(--warning-soft); }
.p-tk-thread p { margin: var(--space-1) 0 0; white-space: pre-wrap; }
.p-tk-assign { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
.p-tk-more summary { cursor: pointer; min-block-size: 44px; display: flex; align-items: center; font-weight: 700; color: var(--green-text); }
.p-tk-log { margin: 0; padding-inline-start: var(--space-5); font-size: 13px; color: var(--ink-muted); }
@media (max-width: 1000px) { .p-tk-grid, .p-tk-assign { grid-template-columns: minmax(0, 1fr); } }
</style>
