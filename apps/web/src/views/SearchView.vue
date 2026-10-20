<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp06 as esp06Api } from '../api/esp06';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';

/** UX-001 unified and specialised search; results come from public projections only (privacy-aware). */
const esp06: typeof esp06Api = esp06Api;
const route = useRoute();
const router = useRouter();
const f = reactive({ q: String(route.query['q'] ?? ''), type: String(route.query['type'] ?? ''), gameId: String(route.query['game'] ?? ''), city: String(route.query['city'] ?? '') });
const res = ref<Record<string, Array<Record<string, unknown>>> | null>(null);
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);
async function run() {
  busy.value = true;
  failure.value = null;
  void router.replace({ query: { q: f.q || undefined, type: f.type || undefined, game: f.gameId || undefined, city: f.city || undefined } });
  try {
    res.value = (await esp06.search({ q: f.q, ...(f.type ? { type: f.type } : {}), ...(f.gameId ? { gameId: f.gameId } : {}), ...(f.city ? { city: f.city } : {}), limit: f.type ? 30 : 5 })).results;
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  if (f.q || f.gameId || f.city) void run();
});
const TYPES = ['players', 'teams', 'events', 'news', 'organizers', 'ads'];
const link = (type: string, x: Record<string, unknown>) =>
  type === 'players' ? `/players/${encodeURIComponent(String(x['nickname']))}` : type === 'teams' ? `/teams/${String(x['id'])}` : type === 'events' ? `/events/${String(x['id'])}` : type === 'news' ? `/news/${encodeURIComponent(String(x['slug']))}` : type === 'organizers' ? `/organizers/${String(x['slug'])}` : '/recruitment';
const label = (type: string, x: Record<string, unknown>) => String(type === 'players' ? x['nickname'] : type === 'news' ? x['title'] : type === 'ads' ? `${String(x['role'] ?? x['kind'])} — ${String(x['description'] ?? '')}` : x['name']);
</script>

<template>
  <PageHeader :title="t('nav.search')" :lead="t('srch.lead')" />
  <form class="grid" role="search" @submit.prevent="run">
    <label class="sr-only" for="s-q">{{ t('nav.search') }}</label>
    <input id="s-q" v-model="f.q" type="search" class="input" dir="auto" inputmode="search" :placeholder="t('srch.placeholder')" />
    <label class="sr-only" for="s-t">{{ t('srch.type') }}</label>
    <select id="s-t" v-model="f.type" class="input"><option value="">{{ t('srch.all') }}</option><option v-for="x in TYPES" :key="x" :value="x">{{ t(`srch.t.${x}` as never) }}</option></select>
    <label class="sr-only" for="s-g">{{ t('srch.game') }}</label>
    <input id="s-g" v-model="f.gameId" class="input ltr" :placeholder="t('srch.game')" />
    <label class="sr-only" for="s-c">{{ t('rank.city') }}</label>
    <input id="s-c" v-model="f.city" class="input" dir="auto" :placeholder="t('rank.city')" />
    <button type="submit" class="btn btn-primary" :disabled="busy">{{ t('news.find') }}</button>
  </form>
  <ErrorNote :error="failure" />
  <div v-if="res" class="stack block" aria-live="polite">
    <template v-for="type in TYPES" :key="type">
      <section v-if="res[type]" class="card stack" :aria-labelledby="`s-${type}`">
        <h2 :id="`s-${type}`">{{ t(`srch.t.${type}` as never) }}</h2>
        <p v-if="!res[type]!.length" class="muted">{{ t('srch.none') }}</p>
        <ul class="list"><li v-for="(x, i) in res[type]" :key="String(x['id'] ?? i)"><RouterLink :to="link(type, x)" dir="auto">{{ label(type, x) }}</RouterLink>
          <span v-if="type === 'events'" class="small muted"> · <JalaliDate :iso="(x['startsAt'] as string | null) ?? null" format="date" /></span>
          <span v-if="x['city']" class="small muted"> · <bdi>{{ x['city'] }}</bdi></span></li></ul>
        <button v-if="!f.type && res[type]!.length >= 5" type="button" class="btn btn-sm" @click="f.type = type; run()">{{ t('srch.more') }}</button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 2fr repeat(3, minmax(8rem, 1fr)) auto; gap: var(--sp-2); }
@media (max-width: 44rem) { .grid { grid-template-columns: 1fr 1fr; } }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.block { margin-block-start: var(--sp-3); }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
