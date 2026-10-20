<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp06 as esp06Api } from '../api/esp06';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';

/** COM-005 private threads and team groups: membership, blocks and reports are enforced by the server. */
const esp06: typeof esp06Api = esp06Api;
const route = useRoute();
const router = useRouter();
const { data: rooms, loading, error, load } = useLoad(async () => (await esp06.rooms()).items);
const active = ref<string | null>(typeof route.query['room'] === 'string' ? route.query['room'] : null);
const msgs = ref<Awaited<ReturnType<typeof esp06.roomMessages>>['items']>([]);
const text = ref('');
const failure = ref<ApiClientError | null>(null);
async function open(id: string) {
  active.value = id;
  failure.value = null;
  void router.replace({ query: { room: id } });
  try {
    msgs.value = (await esp06.roomMessages(id)).items.reverse();
  } catch (e) {
    failure.value = toClientError(e);
    msgs.value = [];
  }
}
async function send() {
  if (!active.value) return;
  failure.value = null;
  try {
    await esp06.sendRoom(active.value, text.value);
    text.value = '';
    await open(active.value);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function report(id: string) {
  try {
    await esp06.report('chat', id, 'reported from messages');
  } catch (e) {
    failure.value = toClientError(e);
  }
}
onMounted(async () => {
  const to = route.query['to'];
  if (typeof to === 'string') {
    try {
      const r = await esp06.openDm(to);
      await load();
      await open(r._id);
    } catch (e) {
      failure.value = toClientError(e);
    }
  } else if (active.value) await open(active.value);
});
const me = () => session.me?.principal.id;
</script>

<template>
  <PageHeader :title="t('msg.title')" :lead="t('msg.lead')" />
  <ErrorNote :error="failure" />
  <DataState :loading="loading" :error="error" @retry="load">
    <div v-if="rooms" class="layout">
      <nav class="card" :aria-label="t('msg.rooms')">
        <p v-if="!rooms.length" class="muted">{{ t('msg.none') }}</p>
        <ul class="rooms"><li v-for="r in rooms" :key="r.id"><button type="button" class="room" :aria-current="active === r.id ? 'true' : undefined" @click="open(r.id)">{{ r.kind === 'team' ? '👥' : '💬' }} <bdi>{{ r.title }}</bdi></button></li></ul>
      </nav>
      <section v-if="active" class="card stack" :aria-label="t('msg.thread')">
        <ol class="thread" aria-live="polite">
          <li v-for="m in msgs" :key="m._id" :class="{ mine: m.principalId === me() }">
            <span class="small muted"><bdi>{{ m.nickname ?? '—' }}</bdi> · <JalaliDate :iso="m.createdAt" format="time" /></span>
            <p v-if="m.removed" class="muted">{{ t('live.removed') }}</p>
            <p v-else-if="m.blocked" class="muted">{{ t('msg.blocked') }}</p>
            <p v-else dir="auto">{{ m.text }}</p>
            <button v-if="m.principalId !== me() && !m.removed" type="button" class="btn btn-sm" @click="report(m._id)">{{ t('live.report') }}</button>
          </li>
        </ol>
        <form class="row" novalidate @submit.prevent="send">
          <label class="sr-only" for="msg-t">{{ t('msg.write') }}</label>
          <textarea id="msg-t" v-model="text" class="input grow" rows="2" dir="auto" maxlength="1000" @keydown.enter.exact.prevent="send" />
          <button type="submit" class="btn btn-primary" :disabled="!text.trim()">{{ t('live.send') }}</button>
        </form>
      </section>
    </div>
  </DataState>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: minmax(12rem, 1fr) 3fr; gap: var(--sp-3); }
@media (max-width: 44rem) { .layout { grid-template-columns: 1fr; } }
.rooms { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-1); }
.room { inline-size: 100%; text-align: start; background: none; border: 0; padding: var(--sp-2); border-radius: var(--radius, 6px); color: inherit; cursor: pointer; }
.room[aria-current='true'] { background: var(--surface-2); font-weight: 600; }
.thread { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); max-block-size: 60vh; overflow-y: auto; }
.thread li { padding: var(--sp-2); border-radius: var(--radius, 6px); background: var(--surface-2); max-inline-size: 85%; }
.thread li.mine { margin-inline-start: auto; background: var(--info-soft); }
.row { display: flex; gap: var(--sp-2); align-items: end; }
.grow { flex: 1 1 auto; }
.small { font-size: var(--fs-xs); }
p { margin: 0; white-space: pre-wrap; }
</style>
