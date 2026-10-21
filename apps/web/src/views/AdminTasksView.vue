<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
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
const f = reactive({ title: '', description: '', ownerId: '', dueAt: '', priority: 'normal' });
const create = () =>
  act(async () => {
    await esp07.createTask({ scope: scope.value, title: f.title, description: f.description, ownerId: f.ownerId || null, dueAt: f.dueAt ? zonedWallTimeToUtc(f.dueAt) : null, priority: f.priority });
    Object.assign(f, { title: '', description: '', ownerId: '', dueAt: '' });
  });
const note = reactive<Record<string, string>>({});
const to = reactive<Record<string, { id: string; note: string }>>({});
const handTo = (id: string) => (to[id] ??= { id: '', note: '' });
const STATES = ['open', 'in_progress', 'done', 'cancelled'];
</script>

<template>
  <PageHeader :title="t('a7.tasks.title')" :lead="eventId ? t('a7.tasks.leadEvent', { id: eventId }) : t('a7.tasks.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <section class="card stack" aria-labelledby="tk-new">
    <h2 id="tk-new">{{ t('a7.tasks.new') }}</h2>
    <form class="grid" @submit.prevent="create">
      <FormField id="tk-t" :label="t('a7.tasks.name')"><template #default="{ id: fid }"><input :id="fid" v-model="f.title" class="input" dir="auto" /></template></FormField>
      <FormField id="tk-o" :label="t('a7.tasks.owner')"><template #default="{ id: fid }"><input :id="fid" v-model="f.ownerId" class="input ltr" /></template></FormField>
      <FormField id="tk-d" :label="t('a7.tasks.due')"><template #default="{ id: fid }"><input :id="fid" v-model="f.dueAt" type="datetime-local" class="input" /></template></FormField>
      <FormField id="tk-p" :label="t('a7.priority')"><template #default="{ id: fid }"><select :id="fid" v-model="f.priority" class="input"><option v-for="p in ['low', 'normal', 'high', 'urgent']" :key="p" :value="p">{{ t(`a7.prio.${p}` as never) }}</option></select></template></FormField>
      <FormField id="tk-x" :label="t('a7.tasks.desc')"><template #default="{ id: fid }"><textarea :id="fid" v-model="f.description" class="input" rows="2" dir="auto" /></template></FormField>
      <button type="submit" class="btn btn-primary" :disabled="f.title.trim().length < 3">{{ t('a7.create') }}</button>
    </form>
  </section>
  <div class="row block">
    <label><input v-model="mine" type="checkbox" @change="load" /> {{ t('a7.tasks.mine') }}</label>
    <label>{{ t('a7.users.status') }} <select v-model="stateFilter" class="input" @change="load"><option value="">{{ t('a7.tasks.active') }}</option><option v-for="s in STATES" :key="s" :value="s">{{ t(`a7.tstate.${s}` as never) }}</option></select></label>
  </div>
  <DataState :loading="loading" :error="error" :empty="!!data && data.items.length === 0" @retry="load">
    <ul v-if="data" class="plain stack">
      <li v-for="k in data.items" :key="k._id" class="card stack">
        <div class="row between"><strong><bdi>{{ k.title }}</bdi></strong><span class="row small"><StatusBadge :state="k.state" /> {{ t(`a7.prio.${k.priority}` as never) }} · <span v-if="k.dueAt">{{ t('a7.tasks.due') }}: <JalaliDate :iso="k.dueAt" /></span></span></div>
        <p v-if="k.description" class="muted" dir="auto">{{ k.description }}</p>
        <p class="small">{{ t('a7.tasks.owner') }}: <bdi class="ltr">{{ k.ownerId ?? '—' }}</bdi></p>
        <ul v-if="k.notes.length || k.handovers.length" class="small stack plain">
          <li v-for="(n, i) in k.notes" :key="`n${i}`"><JalaliDate :iso="n.at" /> — <bdi class="ltr">{{ n.by }}</bdi>: <span dir="auto">{{ n.text }}</span></li>
          <li v-for="(h, i) in k.handovers" :key="`h${i}`"><JalaliDate :iso="h.at" /> — {{ t('a7.tasks.handedOver') }} <bdi class="ltr">{{ h.from }}</bdi> → <bdi class="ltr">{{ h.to }}</bdi>: <span dir="auto">{{ h.note }}</span></li>
        </ul>
        <div class="row">
          <button v-for="s in STATES.filter((x) => x !== k.state)" :key="s" type="button" class="btn btn-sm" @click="act(() => esp07.updateTask(k._id, { state: s, expectedVersion: k.version }))">{{ t(`a7.tstate.${s}` as never) }}</button>
        </div>
        <div class="row">
          <input v-model="note[k._id]" class="input" dir="auto" :placeholder="t('a7.tasks.note')" :aria-label="t('a7.tasks.note')" />
          <button type="button" class="btn btn-sm" :disabled="!(note[k._id] ?? '').trim()" @click="act(async () => { await esp07.updateTask(k._id, { note: note[k._id], expectedVersion: k.version }); note[k._id] = ''; })">{{ t('a7.tasks.addNote') }}</button>
        </div>
        <div class="row">
          <input v-model="handTo(k._id).id" class="input ltr" :placeholder="t('a7.tasks.to')" :aria-label="t('a7.tasks.to')" />
          <input v-model="handTo(k._id).note" class="input" dir="auto" :placeholder="t('a7.tasks.handNote')" :aria-label="t('a7.tasks.handNote')" />
          <button type="button" class="btn btn-sm" :disabled="!handTo(k._id).id || handTo(k._id).note.trim().length < 5" @click="act(() => esp07.handover(k._id, handTo(k._id).id, handTo(k._id).note))">{{ t('a7.tasks.handover') }}</button>
        </div>
      </li>
    </ul>
  </DataState>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-2); align-items: end; }
.plain { list-style: none; margin: 0; padding: 0; }
.block { margin-block: var(--sp-4); }
.small { font-size: var(--fs-xs); }
.ok { color: var(--ok); }
h2, p { margin: 0; }
</style>
