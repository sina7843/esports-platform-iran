<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
import { QAlert, QBadge, QButton, QCard, QContainer, QDataState, QDateField, QPageHeader, QSection, QSelect, QStatusBadge, QSwitch, QTextField, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** ADM-007 tasks with owner, deadline, internal notes and shift handover; platform-wide or for one event (?event=ID). */
const esp07: typeof esp07Api = esp07Api;
const route = useRoute();
const eventId = computed(() => (typeof route.query['event'] === 'string' ? route.query['event'] : ''));
const scope = computed(() => (eventId.value ? ({ type: 'event', id: eventId.value } as const) : ({ type: 'site', id: 'site' } as const)));
const mine = ref(false);
const stateFilter = ref('');
const { data, loading, error, load } = useLoad(() => esp07.tasks(scope.value.type, scope.value.id, { mine: mine.value, ...(stateFilter.value ? { state: stateFilter.value } : {}) }));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = t('a7.saved');
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const f = reactive({ title: '', description: '', ownerId: '', dueAt: '' as string | null, priority: 'normal' });

const create = () =>
  act(async () => {
    await esp07.createTask({ scope: scope.value, title: f.title, description: f.description, ownerId: f.ownerId || null, dueAt: f.dueAt ? zonedWallTimeToUtc(f.dueAt) : null, priority: f.priority });
    Object.assign(f, { title: '', description: '', ownerId: '', dueAt: '' });
  });
const note = reactive<Record<string, string>>({});
const to = reactive<Record<string, { id: string; note: string }>>({});
const handTo = (id: string) => (to[id] ??= { id: '', note: '' });
const STATES = ['open', 'in_progress', 'done', 'cancelled'];
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error, empty: () => !!data.value && !data.value.items.length });
const mineModel = computed({ get: () => mine.value, set: (v: boolean | null) => { mine.value = !!v; void load(); } });
const stateModel = computed({ get: () => stateFilter.value, set: (v: string) => { stateFilter.value = v; void load(); } });
const PRIOS = ['low', 'normal', 'high', 'urgent'];
const prioTone = (p: string) => (p === 'urgent' ? 'danger' : p === 'high' ? 'warning' : 'neutral');
</script>

<template>
  <QContainer>
    <div class="k-stack p-tasks">
      <QPageHeader compact :title="t('a7.tasks.title')" :description="eventId ? t('a7.tasks.leadEvent', { id: eventId }) : t('a7.tasks.lead')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('a7.tasks.title') }]" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <QSection id="new" small :title="t('a7.tasks.new')">
        <QCard>
          <form class="p-tasks-form" novalidate @submit.prevent="create">
            <QTextField id="tk-t" v-model="f.title" :label="t('a7.tasks.name')" required />
            <QTextField id="tk-o" v-model="f.ownerId" :label="t('a7.tasks.owner')" ltr />
            <QDateField id="tk-d" v-model="f.dueAt" :label="t('a7.tasks.due')" with-time />
            <QSelect id="tk-p" v-model="f.priority" :label="t('a7.priority')" :options="PRIOS.map((p) => ({ value: p, label: t(`a7.prio.${p}` as never) }))" />
            <div class="p-tasks-span"><QTextField id="tk-x" v-model="f.description" :label="t('a7.tasks.desc')" multiline :rows="2" /></div>
            <div class="p-tasks-span"><QButton type="submit" variant="primary" icon="plus" :disabled="f.title.trim().length < 3">{{ t('a7.create') }}</QButton></div>
          </form>
        </QCard>
      </QSection>
      <div class="p-tasks-bar">
        <QSwitch v-model="mineModel" :label="t('a7.tasks.mine')" />
        <QSelect id="tk-s" v-model="stateModel" :label="t('a7.users.status')" :options="[{ value: '', label: t('a7.tasks.active') }, ...STATES.map((s) => ({ value: s, label: t(`a7.tstate.${s}` as never) }))]" />
      </div>
      <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" skeleton="rows" icon="list" @retry="load" />
      <div v-else class="k-stack">
        <QCard v-for="k in data.items" :key="k._id">
          <div class="k-stack">
            <div class="p-tasks-head">
              <strong class="h4 p-tasks-h"><bdi>{{ k.title }}</bdi></strong>
              <span class="k-row">
                <QStatusBadge :state="k.state" />
                <QBadge :tone="prioTone(k.priority)">{{ t(`a7.prio.${k.priority}` as never) }}</QBadge>
                <span v-if="k.dueAt" class="p-tasks-muted">{{ t('a7.tasks.due') }}: {{ formatJalali(k.dueAt) }}</span>
              </span>
            </div>
            <p v-if="k.description" class="p-tasks-muted" dir="auto">{{ k.description }}</p>
            <p class="p-tasks-muted">{{ t('a7.tasks.owner') }}: <bdi class="q-ltr">{{ k.ownerId ?? '—' }}</bdi></p>
            <ul v-if="k.notes.length || k.handovers.length" class="p-tasks-log">
              <li v-for="(n, i) in k.notes" :key="`n${i}`">{{ formatJalali(n.at) }} — <bdi class="q-ltr">{{ n.by }}</bdi>: <span dir="auto">{{ n.text }}</span></li>
              <li v-for="(h, i) in k.handovers" :key="`h${i}`">{{ formatJalali(h.at) }} — {{ t('a7.tasks.handedOver') }} <bdi class="q-ltr">{{ h.from }}</bdi> → <bdi class="q-ltr">{{ h.to }}</bdi>: <span dir="auto">{{ h.note }}</span></li>
            </ul>
            <div class="k-row">
              <QButton v-for="s in STATES.filter((x) => x !== k.state)" :key="s" size="sm" variant="secondary" @click="act(() => esp07.updateTask(k._id, { state: s, expectedVersion: k.version }))">{{ t(`a7.tstate.${s}` as never) }}</QButton>
            </div>
            <div class="p-tasks-inline">
              <QTextField v-model="note[k._id]" :label="t('a7.tasks.note')" hide-label :placeholder="t('a7.tasks.note')" />
              <QButton size="sm" variant="secondary" :disabled="!(note[k._id] ?? '').trim()" @click="act(async () => { await esp07.updateTask(k._id, { note: note[k._id], expectedVersion: k.version }); note[k._id] = ''; })">{{ t('a7.tasks.addNote') }}</QButton>
            </div>
            <div class="p-tasks-inline p-tasks-inline--3">
              <QTextField v-model="handTo(k._id).id" :label="t('a7.tasks.to')" hide-label :placeholder="t('a7.tasks.to')" ltr />
              <QTextField v-model="handTo(k._id).note" :label="t('a7.tasks.handNote')" hide-label :placeholder="t('a7.tasks.handNote')" />
              <QButton size="sm" variant="green" :disabled="!handTo(k._id).id || handTo(k._id).note.trim().length < 5" @click="act(() => esp07.handover(k._id, handTo(k._id).id, handTo(k._id).note))">{{ t('a7.tasks.handover') }}</QButton>
            </div>
          </div>
        </QCard>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-tasks { gap: var(--space-6); }
.p-tasks-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); }
.p-tasks-span { grid-column: 1 / -1; }
.p-tasks-bar { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-4); }
.p-tasks-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-tasks-h { margin: 0; }
.p-tasks-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-tasks-log { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: 13px; color: var(--ink-muted); }
.p-tasks-inline { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; }
.p-tasks-inline--3 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
@media (max-width: 640px) { .p-tasks-inline, .p-tasks-inline--3 { grid-template-columns: minmax(0, 1fr); } }
</style>
