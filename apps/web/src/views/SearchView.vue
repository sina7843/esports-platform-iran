<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QButton, QCard, QContainer, QDataState, QEmptyState, QIcon, QPageHeader, QSearchField, QSection, QTabs, QTextField, fa, formatJalali, type IconName } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp06 } from '../api/esp06';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';

/** Spec docs/redesign/03-specs/search.md — UX-001 unified and specialised search over public projections only (privacy-aware). */
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
const TYPES = ['players', 'teams', 'events', 'news', 'organizers', 'ads'] as const;
const ICON: Record<string, IconName> = { players: 'user', teams: 'users', events: 'trophy', news: 'news', organizers: 'flag', ads: 'send' };
const tabs = computed(() => [{ key: '', label: t('srch.all') }, ...TYPES.map((x) => ({ key: x, label: t(`srch.t.${x}` as MessageKey), icon: ICON[x] }))]);
const typeTab = computed({ get: () => f.type, set: (v: string) => { f.type = v; void run(); } });
const link = (type: string, x: Record<string, unknown>) =>
  type === 'players' ? `/players/${encodeURIComponent(String(x['nickname']))}` : type === 'teams' ? `/teams/${String(x['id'])}` : type === 'events' ? `/events/${String(x['id'])}` : type === 'news' ? `/news/${encodeURIComponent(String(x['slug']))}` : type === 'organizers' ? `/organizers/${String(x['slug'])}` : '/recruitment';
const label = (type: string, x: Record<string, unknown>) => String(type === 'players' ? x['nickname'] : type === 'news' ? x['title'] : type === 'ads' ? `${String(x['role'] ?? x['kind'])} — ${String(x['description'] ?? '')}` : x['name']);
const total = computed(() => Object.values(res.value ?? {}).reduce((n, l) => n + l.length, 0));
</script>

<template>
  <QContainer>
    <div class="k-stack p-search">
      <QPageHeader :title="t('nav.search')" :description="t('srch.lead')" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('nav.search') }]" />
      <QCard>
        <form class="p-search-form" role="search" novalidate @submit.prevent="run">
          <QSearchField id="s-q" v-model="f.q" :label="t('nav.search')" :placeholder="t('srch.placeholder')" :submit-label="t('news.find')" @submit="run" />
          <div class="p-search-more">
            <QTextField id="s-g" v-model="f.gameId" :label="t('srch.game')" ltr />
            <QTextField id="s-c" v-model="f.city" :label="t('rank.city')" />
            <QButton type="submit" variant="secondary" icon="filter" :loading="busy">{{ t('news.find') }}</QButton>
          </div>
        </form>
      </QCard>
      <QTabs v-model="typeTab" :items="tabs" :aria-label="t('srch.type')" overflow="scroll" />
      <QDataState v-if="failure" :state="failure.code === 'NETWORK' ? 'offline' : 'error'" :request-id="failure.requestId ?? undefined" @retry="run" />
      <QDataState v-else-if="busy && !res" state="loading" skeleton="rows" />
      <QEmptyState v-else-if="!res" compact icon="search" :title="t('sr.start')" />
      <QEmptyState v-else-if="!total" icon="search" :title="t('srch.none')" :body="t('sr.noneBody')" />
      <div v-else class="p-search-results" aria-live="polite">
        <template v-for="type in TYPES" :key="type">
          <QSection v-if="res[type]?.length" :id="`s-${type}`" small :title="t(`srch.t.${type}` as MessageKey)" :description="t('sr.count', { n: fa(res[type]!.length) })">
            <template v-if="!f.type && res[type]!.length >= 5" #action><QButton variant="ghost" size="sm" @click="typeTab = type">{{ t('srch.more') }}</QButton></template>
            <QCard padding="none">
              <ul class="p-search-list">
                <li v-for="(x, i) in res[type]" :key="String(x['id'] ?? i)">
                  <span class="p-search-icon" aria-hidden="true"><QIcon :name="ICON[type] ?? 'search'" :size="18" /></span>
                  <RouterLink :to="link(type, x)" class="p-search-link" dir="auto">{{ label(type, x) }}</RouterLink>
                  <span class="p-search-meta">
                    <template v-if="type === 'events' && x['startsAt']">{{ formatJalali(x['startsAt'] as string, 'date') }}</template>
                    <bdi v-if="x['city']"> · {{ x['city'] }}</bdi>
                  </span>
                </li>
              </ul>
            </QCard>
          </QSection>
        </template>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-search { gap: var(--space-6); }
.p-search-form { display: flex; flex-direction: column; gap: var(--space-4); }
.p-search-more { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)) auto; gap: var(--space-3); align-items: end; }
.p-search-results { display: flex; flex-direction: column; gap: var(--space-7); }
.p-search-list { margin: 0; padding: 0; list-style: none; }
.p-search-list li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
.p-search-list li:last-child { border-block-end: 0; }
.p-search-icon { display: grid; place-items: center; inline-size: 36px; block-size: 36px; border-radius: var(--radius-sm); background: var(--surface-sunken); color: var(--green-text); }
.p-search-link { color: var(--ink); font-weight: 700; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-search-link:hover { color: var(--green-text); }
.p-search-meta { font-size: 13px; color: var(--ink-subtle); }
@media (max-width: 640px) { .p-search-more { grid-template-columns: minmax(0, 1fr); } }
</style>
