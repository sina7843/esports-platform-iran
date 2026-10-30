<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QAlert, QAvatar, QButton, QCard, QContainer, QDataState, QEmptyState, QIcon, QPageHeader, QTextField, formatJalali } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp06 as esp06Api } from '../api/esp06';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';
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
const ds = useDataState({ loading: computed(() => loading.value && !rooms.value), error });
const activeRoom = computed(() => rooms.value?.find((r) => r.id === active.value) ?? null);
</script>

<template>
  <QContainer>
    <div class="k-stack p-msg">
      <QPageHeader compact :title="t('msg.title')" :description="t('msg.lead')" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <QDataState v-if="ds.state.value !== 'content' || !rooms" v-bind="ds.props.value" skeleton="rows" @retry="load" />
      <div v-else class="p-msg-layout">
        <QCard padding="none">
          <nav :aria-label="t('msg.rooms')">
            <p v-if="!rooms.length" class="p-msg-empty">{{ t('msg.none') }}</p>
            <ul class="p-msg-rooms">
              <li v-for="r in rooms" :key="r.id">
                <button type="button" class="p-msg-room" :aria-current="active === r.id ? 'true' : undefined" @click="open(r.id)">
                  <QAvatar :name="r.title" :size="32" :shape="r.kind === 'team' ? 'chamfer' : 'circle'" />
                  <span class="p-msg-room__t"><bdi>{{ r.title }}</bdi></span>
                  <QIcon :name="r.kind === 'team' ? 'users' : 'message'" :size="16" />
                </button>
              </li>
            </ul>
          </nav>
        </QCard>
        <QCard v-if="active" padding="none">
          <section class="p-msg-thread" :aria-label="t('msg.thread')">
            <header class="p-msg-head"><strong><bdi>{{ activeRoom?.title ?? '' }}</bdi></strong></header>
            <ol class="p-msg-list" aria-live="polite">
              <li v-for="m in msgs" :key="m._id" :class="['p-msg-item', { 'p-msg-item--mine': m.principalId === me() }]">
                <span class="p-msg-meta"><bdi>{{ m.nickname ?? '—' }}</bdi> · {{ formatJalali(m.createdAt, 'time') }}</span>
                <p v-if="m.removed" class="p-msg-muted">{{ t('live.removed') }}</p>
                <p v-else-if="m.blocked" class="p-msg-muted">{{ t('msg.blocked') }}</p>
                <p v-else class="p-msg-bubble" dir="auto">{{ m.text }}</p>
                <QButton v-if="m.principalId !== me() && !m.removed" variant="ghost" size="sm" icon="flag" @click="report(m._id)">{{ t('live.report') }}</QButton>
              </li>
            </ol>
            <form class="p-msg-form" novalidate @submit.prevent="send">
              <QTextField id="msg-t" v-model="text" :label="t('msg.write')" hide-label multiline :rows="2" :max-length="1000" @keydown.enter.exact.prevent="send" />
              <QButton type="submit" variant="primary" icon="send" :disabled="!text.trim()">{{ t('live.send') }}</QButton>
            </form>
          </section>
        </QCard>
        <QEmptyState v-else compact icon="message" :title="t('ms.pick')" />
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-msg { gap: var(--space-6); }
.p-msg-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.p-msg-empty { margin: 0; padding: var(--space-5); color: var(--ink-muted); font-size: 14px; }
.p-msg-rooms { margin: 0; padding: 0; list-style: none; }
.p-msg-room { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); inline-size: 100%; min-block-size: 56px; padding: var(--space-2) var(--space-4); border: 0; border-block-end: 1px solid var(--line); background: transparent; color: var(--ink); font: inherit; text-align: start; cursor: pointer; }
.p-msg-room:hover { background: var(--surface-hover); }
.p-msg-room[aria-current='true'] { background: var(--green-soft); border-inline-start: 3px solid var(--green); }
.p-msg-room__t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.p-msg-thread { display: flex; flex-direction: column; min-block-size: 480px; }
.p-msg-head { padding: var(--space-4) var(--space-5); border-block-end: 1px solid var(--line); }
.p-msg-list { flex: 1; margin: 0; padding: var(--space-4) var(--space-5); list-style: none; display: flex; flex-direction: column; gap: var(--space-3); max-block-size: 60vh; overflow-y: auto; }
.p-msg-item { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); max-inline-size: 80%; }
.p-msg-item--mine { align-self: flex-end; align-items: flex-end; }
.p-msg-meta { font-size: 12px; color: var(--ink-subtle); }
.p-msg-bubble { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); background: var(--surface-sunken); border: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; }
.p-msg-item--mine .p-msg-bubble { background: var(--green-soft); border-color: var(--green-line); }
.p-msg-muted { margin: 0; color: var(--ink-subtle); font-size: 13px; }
.p-msg-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; padding: var(--space-4) var(--space-5); border-block-start: 1px solid var(--line); }
@media (max-width: 900px) { .p-msg-layout { grid-template-columns: minmax(0, 1fr); } }
</style>
