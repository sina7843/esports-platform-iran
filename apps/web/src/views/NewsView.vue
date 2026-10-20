<script setup lang="ts">
import { reactive, ref } from 'vue';
import { esp06 as esp06Api, type PublicPost } from '../api/esp06';
import DataState from '../components/DataState.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

/** EDIT-005 news, articles, reports, interviews and galleries with category, format and search. */
const esp06: typeof esp06Api = esp06Api;
const f = reactive({ q: '', format: '', category: '' });
const more = ref<string | null>(null);
const { data, loading, error, load } = useLoad(async () => {
  const r = await esp06.news({ ...(f.q ? { q: f.q } : {}), ...(f.format ? { format: f.format } : {}), ...(f.category ? { category: f.category } : {}), limit: 20 });
  more.value = r.items.length === 20 ? (r.items.at(-1)?.publishedAt ?? null) : null;
  return r.items;
});
async function older() {
  if (!more.value || !data.value) return;
  const r = await esp06.news({ ...(f.q ? { q: f.q } : {}), ...(f.format ? { format: f.format } : {}), before: more.value, limit: 20 });
  data.value = [...data.value, ...r.items.filter((p: PublicPost) => !data.value!.some((x) => x.id === p.id))];
  more.value = r.items.length === 20 ? (r.items.at(-1)?.publishedAt ?? null) : null;
}
</script>

<template>
  <PageHeader :title="t('nav.news')" :lead="t('news.lead')" />
  <form class="row" role="search" @submit.prevent="load">
    <label class="sr-only" for="nw-q">{{ t('news.search') }}</label>
    <input id="nw-q" v-model="f.q" type="search" class="input grow" dir="auto" :placeholder="t('news.search')" />
    <label class="sr-only" for="nw-f">{{ t('news.format') }}</label>
    <select id="nw-f" v-model="f.format" class="input"><option value="">{{ t('news.allFormats') }}</option><option v-for="x in ['article', 'report', 'interview', 'gallery', 'live']" :key="x" :value="x">{{ t(`news.fmt.${x}` as never) }}</option></select>
    <button type="submit" class="btn btn-sm">{{ t('news.find') }}</button>
  </form>
  <DataState :loading="loading" :error="error" :empty="!!data && !data.length" @retry="load">
    <ul v-if="data" class="cards">
      <li v-for="p in data" :key="p.id" class="card stack">
        <span class="muted small">{{ t(`news.fmt.${p.format}` as never) }} · <JalaliDate :iso="p.publishedAt" format="date" /><span v-if="p.result"> · {{ p.result.final ? t('live.final') : t('live.provisional') }}</span></span>
        <h2><RouterLink :to="`/news/${encodeURIComponent(p.slug)}`" dir="auto">{{ p.title }}</RouterLink></h2>
        <p v-if="p.withdrawal" class="danger small">{{ t('live.withdrawn') }}</p>
        <p v-else-if="p.correction" class="warn small" dir="auto">{{ p.correction.notice }}</p>
        <p v-else class="clamp" dir="auto">{{ p.seo.description ?? p.body.slice(0, 180) }}</p>
      </li>
    </ul>
    <button v-if="more" type="button" class="btn block" @click="older">{{ t('live.older') }}</button>
  </DataState>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; margin-block-end: var(--sp-3); }
.grow { flex: 1 1 14rem; }
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: var(--sp-3); }
.clamp { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.block { margin-block-start: var(--sp-3); }
.small { font-size: var(--fs-xs); }
.warn { color: var(--warn); }
.danger { color: var(--danger); }
h2, p { margin: 0; }
h2 { font-size: var(--fs-lg, 1.1rem); }
</style>
