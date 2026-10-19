<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';

/** REC-001..005: recruitment ads, looking-for-team players and scrim requests (friendly results never feed ranking). */
const f = reactive({ gameId: '', city: '', level: '' });
const q = () => ({ gameId: f.gameId || undefined, city: f.city || undefined, level: f.level || undefined });
const ads = useLoad(() => esp02.ads(q()));
const players = useLoad(() => esp02.lftPlayers(q()));
const scrims = useLoad(() => esp02.scrims({ gameId: f.gameId || undefined, level: f.level || undefined }));
const reload = () => Promise.all([ads.load(), players.load(), scrims.load()]);

const failure = ref<ApiClientError | null>(null);
const myTeams = useLoad(() => (session.me ? esp02.myTeams() : Promise.resolve({ items: [] })));
const proposeTeam = ref('');
const proposeAt = reactive<Record<string, string>>({});
const proposed = ref<Set<string>>(new Set());
async function propose(scrimId: string) {
  failure.value = null;
  const local = proposeAt[scrimId];
  if (!proposeTeam.value || !local) return;
  try {
    await esp02.proposeScrim(scrimId, proposeTeam.value, new Date(local).toISOString()); // REC-004: must fall inside the window (server-checked)
    proposed.value = new Set([...proposed.value, scrimId]);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const applied = ref<Set<string>>(new Set());
async function apply(adId: string) {
  failure.value = null;
  try {
    await esp02.apply(adId, null);
    applied.value = new Set([...applied.value, adId]);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('rec.title')" />
  <form class="card filters" role="search" @submit.prevent="reload">
    <FormField id="f-game" :label="t('rec.filterGame')"><template #default="{ id }"><input :id="id" v-model="f.gameId" class="input ltr" /></template></FormField>
    <FormField id="f-city" :label="t('rec.filterCity')"><template #default="{ id }"><input :id="id" v-model="f.city" class="input" dir="auto" /></template></FormField>
    <FormField id="f-level" :label="t('rec.filterLevel')"><template #default="{ id }"><input :id="id" v-model="f.level" class="input" dir="auto" /></template></FormField>
    <button type="submit" class="btn btn-primary">{{ t('nav.search') }}</button>
  </form>
  <ErrorNote :error="failure" />

  <section class="block" aria-labelledby="ads-h">
    <h2 id="ads-h">{{ t('rec.ads') }}</h2>
    <DataState :loading="ads.loading.value" :error="ads.error.value" :empty="!!ads.data.value && ads.data.value.items.length === 0" @retry="ads.load">
      <ul v-if="ads.data.value" class="cards">
        <li v-for="a in ads.data.value.items" :key="a.id" class="card stack">
          <RouterLink :to="`/teams/${a.team.id}`"><bdi>{{ a.team.name }}</bdi> <bdi class="ltr">[{{ a.team.tag }}]</bdi></RouterLink>
          <p class="muted"><bdi class="ltr">{{ a.gameId }}</bdi> · <bdi>{{ [a.role, a.level, a.city, a.activityHours].filter(Boolean).join(' · ') }}</bdi></p>
          <p dir="auto">{{ a.description }}</p>
          <p v-if="applied.has(a.id)" role="status" class="ok">{{ t('rec.applied') }}</p>
          <button v-else-if="session.me && a.state === 'open'" type="button" class="btn btn-sm btn-primary" @click="apply(a.id)">{{ t('rec.apply') }}</button>
        </li>
      </ul>
    </DataState>
  </section>

  <section class="block" aria-labelledby="lft-h">
    <h2 id="lft-h">{{ t('rec.players') }}</h2>
    <DataState :loading="players.loading.value" :error="players.error.value" :empty="!!players.data.value && players.data.value.items.length === 0" @retry="players.load">
      <ul v-if="players.data.value" class="list">
        <li v-for="p in players.data.value.items" :key="p.id">
          <RouterLink :to="`/players/${encodeURIComponent(p.nickname)}`"><bdi>{{ p.nickname }}</bdi></RouterLink>
          <span v-if="p.city" class="muted"> · <bdi>{{ p.city }}</bdi></span>
        </li>
      </ul>
    </DataState>
  </section>

  <section class="block" aria-labelledby="scr-h">
    <h2 id="scr-h">{{ t('rec.scrims') }}</h2>
    <p class="muted">{{ t('rec.friendly') }}</p>
    <DataState :loading="scrims.loading.value" :error="scrims.error.value" :empty="!!scrims.data.value && scrims.data.value.items.length === 0" @retry="scrims.load">
      <ul v-if="scrims.data.value" class="list">
        <li v-for="s in scrims.data.value.items" :key="s.id">
          <RouterLink :to="`/teams/${s.requester.id}`"><bdi>{{ s.requester.name }}</bdi></RouterLink>
          · <bdi class="ltr">{{ s.gameId }}</bdi>
          · {{ t('rec.window') }}: <JalaliDate :iso="s.windowStart" /> – <JalaliDate :iso="s.windowEnd" />
          <span v-if="s.server"> · {{ t('rec.server') }}: <bdi class="ltr">{{ s.server }}</bdi></span>
          <form v-if="session.me && s.state === 'open' && myTeams.data.value && myTeams.data.value.items.length && !proposed.has(s.id)" class="row propose" novalidate @submit.prevent="propose(s.id)">
            <label class="sr-only" :for="`pt-${s.id}`">{{ t('mgmt.proposeAs') }}</label>
            <select :id="`pt-${s.id}`" v-model="proposeTeam" class="input sm"><option value="" disabled>{{ t('mgmt.proposeAs') }}</option><option v-for="m in myTeams.data.value.items" :key="m.teamId" :value="m.teamId">{{ m.name }}</option></select>
            <label class="sr-only" :for="`pa-${s.id}`">{{ t('mgmt.proposedAt') }}</label>
            <input :id="`pa-${s.id}`" v-model="proposeAt[s.id]" type="datetime-local" class="input sm" />
            <button type="submit" class="btn btn-sm">{{ t('mgmt.propose') }}</button>
          </form>
          <span v-if="proposed.has(s.id)" class="ok" role="status"> ✓</span>
        </li>
      </ul>
    </DataState>
  </section>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--sp-3); align-items: end; }
.block { margin-block-start: var(--sp-6); }
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); display: grid; gap: var(--sp-2); }
.ok { color: var(--accent-strong); margin: 0; }
.propose { gap: var(--sp-2); margin-block-start: var(--sp-2); flex-wrap: wrap; }
.sm { max-inline-size: 12rem; }
p { margin: 0; }
</style>
