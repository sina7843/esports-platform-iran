<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp06 as esp06Api } from '../api/esp06';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import LivePost from '../components/LivePost.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';

/**
 * EDIT-006 article page: title/description/canonical, Open Graph share image and NewsArticle structured data are
 * set from the API's metadata (JSON-LD is pre-escaped server-side). Comments are separate from the post (AUD-002).
 */
const esp06: typeof esp06Api = esp06Api;
const route = useRoute();
const slug = computed(() => String(route.params['slug']));
const { data, loading, error, load } = useLoad(async () => {
  const [post, meta] = await Promise.all([esp06.article(slug.value), esp06.meta(slug.value)]);
  applyHead(meta);
  return { post, comments: (await esp06.comments(post.id)).items };
});
const added: Element[] = [];
function applyHead(m: { title: string; description: string; canonical: string; image: string; jsonLd: string }) {
  clearHead();
  document.title = m.title;
  const add = (tag: string, attrs: Record<string, string>, text?: string) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    document.head.appendChild(el);
    added.push(el);
  };
  add('meta', { name: 'description', content: m.description });
  add('link', { rel: 'canonical', href: m.canonical });
  add('meta', { property: 'og:title', content: m.title });
  add('meta', { property: 'og:description', content: m.description });
  add('meta', { property: 'og:image', content: m.image });
  add('meta', { property: 'og:type', content: 'article' });
  add('script', { type: 'application/ld+json' }, m.jsonLd);
}
function clearHead() {
  for (const el of added.splice(0)) el.remove();
}
onBeforeUnmount(clearHead);
watch(slug, () => void load());
const text = ref('');
const failure = ref<ApiClientError | null>(null);
async function send() {
  if (!data.value) return;
  failure.value = null;
  try {
    await esp06.comment(data.value.post.id, text.value);
    text.value = '';
    data.value.comments = (await esp06.comments(data.value.post.id)).items;
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function report(id: string) {
  try {
    await esp06.report('comment', id, 'reported by reader');
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <article v-if="data" class="stack">
      <LivePost :post="data.post" show-actions />
      <p class="muted small">{{ t('news.byline') }} <bdi>{{ data.post.author?.nickname ?? t(`live.src.${data.post.source}` as never) }}</bdi> · <JalaliDate :iso="data.post.publishedAt" /></p>
      <img v-if="data.post.seo.shareImageFileId || data.post.result" :src="esp06.cardUrl(data.post.slug)" :alt="t('news.shareImage')" class="card-img" width="600" height="315" loading="lazy" />
      <RouterLink v-if="data.post.eventId" :to="`/events/${data.post.eventId}/live`">{{ t('news.toLive') }}</RouterLink>
      <section class="card stack" aria-labelledby="cm-h">
        <h2 id="cm-h">{{ t('news.comments') }}</h2>
        <p class="muted small">{{ t('news.commentsNote') }}</p>
        <ErrorNote :error="failure" />
        <ul class="list"><li v-for="c in data.comments" :key="c._id"><strong><bdi>{{ c.nickname ?? '—' }}</bdi></strong>: <span v-if="c.removed" class="muted">{{ t('live.removed') }}</span><span v-else dir="auto">{{ c.text }}</span>
          <button v-if="session.me && !c.removed" type="button" class="btn btn-sm" @click="report(c._id)">{{ t('live.report') }}</button></li></ul>
        <form v-if="session.me" class="row" novalidate @submit.prevent="send">
          <label class="sr-only" for="cm-t">{{ t('news.comment') }}</label>
          <input id="cm-t" v-model="text" class="input grow" dir="auto" maxlength="1000" :placeholder="t('news.comment')" />
          <button type="submit" class="btn btn-sm" :disabled="!text.trim()">{{ t('live.send') }}</button>
        </form>
      </section>
    </article>
  </DataState>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.grow { flex: 1 1 14rem; }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.card-img { max-inline-size: 100%; block-size: auto; border-radius: var(--radius, 6px); }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
