<script setup lang="ts">
import CareerPanel from '../components/CareerPanel.vue';
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp02, type PublicPlayer } from '../api/esp02';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { isForbidden, toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { session } from '../session';

/** USR-003..008, USR-011: public profile — the server already removed fields the viewer may not see. */
const route = useRoute();
const router = useRouter();
const data = ref<PublicPlayer | null>(null);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const actionError = ref<ApiClientError | null>(null);
const following = ref(false);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await esp02.player(String(route.params['nickname']));
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(() => route.params['nickname'], () => void load(), { immediate: true });

async function act(fn: () => Promise<unknown>) {
  actionError.value = null;
  try {
    await fn();
  } catch (e) {
    actionError.value = toClientError(e);
  }
}
const toggleFollow = () => act(async () => {
  if (!data.value) return;
  if (following.value) await esp02.unfollow('player', data.value.id);
  else await esp02.follow('player', data.value.id);
  following.value = !following.value;
});
const block = () => act(async () => { if (data.value) { await esp02.block(data.value.id); await router.replace('/'); } });
</script>

<template>
  <DataState :loading="loading" :error="error" :forbidden="isForbidden(error)" @retry="load">
    <template v-if="data">
      <PageHeader :title="t('player.title')">
        <template #title><bdi>{{ data.nickname }}</bdi></template>
        <template v-if="session.me && session.me.principal.id !== data.id" #actions>
          <button type="button" class="btn" @click="toggleFollow">{{ following ? t('player.unfollow') : t('player.follow') }}</button>
          <button type="button" class="btn btn-danger" @click="block">{{ t('player.block') }}</button>
        </template>
      </PageHeader>
      <ErrorNote :error="actionError" />
      <section class="card stack">
        <p v-if="data.realName"><bdi>{{ data.realName }}</bdi></p>
        <p v-if="data.city || data.province" class="muted"><bdi>{{ [data.city, data.province].filter(Boolean).join('، ') }}</bdi></p>
        <p v-if="data.bio" dir="auto">{{ data.bio }}</p>
        <p v-if="data.lookingForTeam.active" class="tag">{{ t('player.lft') }}</p>
        <ul v-if="data.links.length" class="list"><li v-for="l in data.links" :key="l.url"><a :href="l.url" rel="noopener noreferrer nofollow" target="_blank" dir="auto">{{ l.label }}</a></li></ul>
      </section>

      <section v-if="data.badges.length" class="card stack block" aria-labelledby="b-h">
        <h2 id="b-h">{{ t('player.badges') }}</h2>
        <ul class="list"><li v-for="(b, i) in data.badges" :key="i">{{ t(`badge.${b.kind}` as MessageKey) }} — <JalaliDate :iso="b.issuedAt" /></li></ul>
      </section>

      <section v-if="data.games.length || data.gameIdentities.length" class="card stack block" aria-labelledby="g-h">
        <h2 id="g-h">{{ t('profile.games') }}</h2>
        <ul class="list">
          <li v-for="g in data.games" :key="g.gameId">
            <bdi class="ltr">{{ g.gameId }}</bdi> — {{ t('profile.declaredLevel') }}: <bdi>{{ g.declaredLevel ?? '—' }}</bdi>
            <span v-if="g.verifiedLevel"> · {{ t('profile.verifiedLevel') }}: <bdi>{{ g.verifiedLevel.value }}</bdi></span>
          </li>
          <li v-for="gi in data.gameIdentities" :key="gi.gameId + gi.platform"><bdi class="ltr">{{ gi.gameId }} · {{ gi.platform }} · {{ gi.value }}</bdi><span v-if="gi.verified"> ✓</span></li>
        </ul>
      </section>

      <CareerPanel class="block" kind="player" :id="data.id" />
    </template>
  </DataState>
</template>

<style scoped>
.block { margin-block-start: var(--sp-6); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.tag { display: inline-block; padding: var(--sp-1) var(--sp-3); border-radius: 999px; background: var(--accent-soft, var(--warn-soft)); margin: 0; }
</style>
