<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QButton, QContainer, QDataState, QEmptyState, QFilterBar, QIcon, QNewsCard, QPageHeader, QPagination, QSection, QSwitch, QTabs, fa } from '@esp/ui';
import { esp06, type PublicPost } from '../api/esp06';
import { t, type MessageKey } from '../i18n';
import { can } from '../session';
import { setLowData, settings } from '../settings';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/news.md — EDIT-005 news with category tabs, format filter, search, corrections and low-data mode. */
const route = useRoute();
const router = useRouter();
const PAGE = 20;
const qs = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '');
const cat = ref(qs('category') || 'all');
const query = ref(qs('q'));
const values = ref<Record<string, string>>({ format: qs('format') });
const more = ref<string | null>(null);
const busy = ref(false);

// OPEN-QUESTION(news): categories are free text in the API (backlog: fixed category list); the tabs use the spec's four.
const CATS = ['events', 'report', 'rules', 'notice'] as const;
const catKey: Record<string, MessageKey> = { events: 'nw.catEvents', report: 'nw.catReport', rules: 'nw.catRules', notice: 'nw.catNotice' };
const tabs = computed(() => [{ key: 'all', label: t('nw.all') }, ...CATS.map((k) => ({ key: k, label: t(catKey[k]!) }))]);
const FMTS = ['article', 'report', 'interview', 'gallery', 'live'];
const fmtLabel = (f: string) => t(`news.fmt.${f}` as MessageKey);
const filters = computed(() => [{ key: 'format', label: t('nw.format'), allLabel: t('nw.allFormats'), options: FMTS.map((f) => ({ value: f, label: fmtLabel(f) })) }]);

const params = () => ({
  ...(query.value.trim() ? { q: query.value.trim() } : {}),
  ...(values.value.format ? { format: values.value.format } : {}),
  ...(cat.value !== 'all' ? { category: cat.value } : {}),
  limit: PAGE,
});
const { data, loading, error, load } = useLoad(async () => {
  const r = await esp06.news(params());
  more.value = r.items.length === PAGE ? (r.items.at(-1)?.publishedAt ?? null) : null;
  return r.items;
});
async function older() {
  if (!more.value || !data.value) return;
  busy.value = true;
  try {
    const r = await esp06.news({ ...params(), before: more.value });
    data.value = [...data.value, ...r.items.filter((p) => !data.value!.some((x) => x.id === p.id))];
    more.value = r.items.length === PAGE ? (r.items.at(-1)?.publishedAt ?? null) : null;
  } finally {
    busy.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch([cat, () => values.value.format], () => void reload());
watch(query, () => { clearTimeout(timer); timer = setTimeout(() => void reload(), 300); });
async function reload() {
  void router.replace({ query: { ...(query.value.trim() ? { q: query.value.trim() } : {}), ...(cat.value !== 'all' ? { category: cat.value } : {}), ...(values.value.format ? { format: values.value.format } : {}) } });
  await load();
}
const filtered = computed(() => cat.value !== 'all' || !!values.value.format || !!query.value.trim());
function clearAll() {
  cat.value = 'all';
  query.value = '';
  values.value = { format: '' };
}

const list = computed(() => data.value ?? []);
const ds = useDataState({ loading, error, empty: () => !filtered.value && !!data.value && !data.value.length });
const cover = (p: PublicPost) => (settings.lowData ? undefined : (p.media.find((m) => m.kind === 'image' && m.url)?.url ?? undefined));
const card = (p: PublicPost) => ({
  title: p.title,
  excerpt: p.seo.description ?? p.body.slice(0, 180),
  category: catKey[p.category] ? t(catKey[p.category]!) : p.category,
  format: catKey[p.category] && p.format === p.category ? undefined : fmtLabel(p.format),
  publishedAt: p.publishedAt ?? p.occurredAt,
  coverSrc: cover(p),
  state: (p.withdrawal ? 'retracted' : p.correction ? 'corrected' : 'published') as 'published' | 'corrected' | 'retracted',
  correctionNote: p.correction?.notice,
  retractionReason: p.withdrawal?.reason,
  lowData: settings.lowData,
  href: `/news/${encodeURIComponent(p.slug)}`,
  headingLevel: 3 as const,
});
</script>

<template>
  <QContainer>
    <div class="k-stack p-news">
      <QPageHeader :title="t('nw.title')" :description="t('nw.desc')" :breadcrumb="[{ label: t('nw.home'), href: '/' }, { label: t('nw.title') }]">
        <template v-if="can('news.draft')" #actions><QButton variant="secondary" icon="edit" href="/newsroom">{{ t('nw.newsroom') }}</QButton></template>
      </QPageHeader>
      <div class="p-news-tools">
        <div class="p-news-tabs"><QTabs v-model="cat" overflow="scroll" :items="tabs" :aria-label="t('nw.tabs')" /></div>
        <QFilterBar
          v-model:query="query" v-model:values="values" :aria-label="t('nw.filter')" :search-label="t('nw.search')" :search-placeholder="t('nw.search')"
          :filters="filters" :clear-label="t('nw.clear')" :result-label="ds.state.value === 'content' ? t('nw.count', { n: fa(list.length) }) : undefined"
          @clear="clearAll"
        />
        <div class="p-news-lowdata">
          <p id="lowdata-hint" class="p-news-lowdata__text"><QIcon name="wifi-off" :size="18" />{{ t('nw.lowData') }}</p>
          <QSwitch :label="t('nw.lowDataLabel')" :model-value="settings.lowData" @update:model-value="(v) => setLowData(!!v)" />
        </div>
      </div>
      <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" :empty-title="t('nw.emptyTitle')" :empty-body="t('nw.emptyBody')" @retry="load" />
      <QEmptyState v-else-if="!list.length" icon="search" :title="t('nw.noMatch')" :body="t('nw.noMatchBody')">
        <template #action><QButton variant="secondary" @click="clearAll">{{ t('nw.clear') }}</QButton></template>
      </QEmptyState>
      <template v-else>
        <section aria-labelledby="news-top-h" class="k-stack">
          <h2 id="news-top-h" class="q-sr">{{ t('nw.latest') }}</h2>
          <div class="p-news-top">
            <QNewsCard variant="featured" v-bind="card(list[0]!)" />
            <div v-if="list.length > 1" class="p-news-side">
              <QNewsCard v-for="p in list.slice(1, 4)" :key="p.id" variant="compact" v-bind="card(p)" />
            </div>
          </div>
        </section>
        <QSection v-if="list.length > 4" id="news-all" :title="t('nw.earlier')" small>
          <ul class="p-news-list">
            <li v-for="p in list.slice(4)" :key="p.id"><QNewsCard variant="compact" v-bind="card(p)" /></li>
          </ul>
        </QSection>
        <QPagination
          mode="cursor" :shown="list.length" :has-more="!!more" :loading="busy" :count-label="t('nw.countShort', { n: fa(list.length) })"
          :more-label="t('nw.older')" :done-label="t('nw.done')" @more="older"
        />
      </template>
    </div>
  </QContainer>
</template>

<style scoped>
.p-news { gap: var(--space-7); }
.p-news-tools { display: flex; flex-direction: column; gap: var(--space-4); }
.p-news-lowdata { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-5);
  padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.p-news-lowdata__text { display: flex; align-items: flex-start; gap: var(--space-2); margin: 0; font-size: 13px; line-height: 22px; color: var(--ink-muted); max-width: 72ch; }
.p-news-lowdata__text .q-icon { flex: none; color: var(--green-text); margin-block-start: 1px; }
.p-news-top { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.p-news-side { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.p-news-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.p-news-list > li { min-width: 0; display: flex; }
.p-news-list > li > * { flex: 1; }
.p-news-tabs { overflow-x: auto; }
@media (max-width: 960px) { .p-news-top { grid-template-columns: minmax(0, 1fr); } }
</style>
