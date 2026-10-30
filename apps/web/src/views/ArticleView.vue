<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QBadge, QBreadcrumb, QButton, QCard, QContainer, QDataState, QIcon, QSection, QTextField, formatJalali, isRtl } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp06 as esp06Api } from '../api/esp06';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { session } from '../session';
import { settings } from '../settings';
import { useDataState } from '../useDataState';
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
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error });
const sent = ref('');
watch(failure, (f) => { sent.value = f ? f.message : ''; });
const images = computed(() => (data.value?.post.media ?? []).filter((m) => m.kind === 'image' && m.url));
const fmtLabel = (f: string) => t(`news.fmt.${f}` as MessageKey);
async function report(id: string) {
  try {
    await esp06.report('comment', id, 'reported by reader');
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" @retry="load" />
    <article v-else class="p-article">
      <QBreadcrumb :items="[{ label: t('shell.home'), href: '/' }, { label: t('shell.news'), href: '/news' }, { label: data.post.title }]" />
      <header class="p-article-head">
        <div class="p-article-tags">
          <QBadge tone="green">{{ fmtLabel(data.post.format) }}</QBadge>
          <QBadge v-if="data.post.category" tone="neutral">{{ data.post.category }}</QBadge>
          <QBadge v-if="data.post.source === 'official'" tone="success" icon="shield">{{ t('live.src.official') }}</QBadge>
        </div>
        <h1 class="p-article-title" dir="auto">{{ data.post.title }}</h1>
        <p class="p-article-meta">
          <span><QIcon name="user" :size="16" />{{ t('news.byline') }} <bdi>{{ data.post.author?.nickname ?? t(`live.src.${data.post.source}` as MessageKey) }}</bdi></span>
          <span><QIcon name="calendar" :size="16" />{{ formatJalali(data.post.publishedAt ?? data.post.occurredAt) }}</span>
          <span v-if="data.post.edited"><QIcon name="edit" :size="16" />{{ t('live.edited') }} · {{ formatJalali(data.post.edited.at) }}</span>
        </p>
      </header>
      <QAlert v-if="data.post.withdrawal" tone="danger" icon="x-circle" :title="t('live.withdrawn')">{{ data.post.withdrawal.reason }}</QAlert>
      <QAlert v-else-if="data.post.correction" tone="warning" icon="alert">{{ data.post.correction.notice }}</QAlert>
      <figure v-if="images.length && !settings.lowData" class="p-article-figure">
        <img :src="images[0]!.url!" :alt="images[0]!.caption ?? ''" loading="lazy" />
        <figcaption v-if="images[0]!.caption || images[0]!.credit" dir="auto">{{ images[0]!.caption }} <span v-if="images[0]!.credit">· {{ images[0]!.credit }}</span></figcaption>
      </figure>
      <div v-if="!data.post.withdrawal" class="p-article-body" dir="auto">{{ data.post.body }}</div>
      <blockquote v-if="data.post.quote" class="p-article-quote" dir="auto">
        <p>{{ data.post.quote.text }}</p>
        <cite>— <bdi>{{ data.post.quote.speaker }}</bdi></cite>
      </blockquote>
      <p v-if="data.post.link"><a :href="data.post.link.url" rel="noopener noreferrer nofollow" target="_blank" dir="auto">{{ data.post.link.label }} <QIcon name="external" :size="14" /></a></p>
      <div class="p-article-actions">
        <QButton v-if="data.post.eventId" variant="secondary" icon="broadcast" :href="`/events/${data.post.eventId}/live`">{{ t('news.toLive') }}</QButton>
        <QButton variant="ghost" :icon="isRtl() ? 'arrow-right' : 'arrow-left'" href="/news">{{ t('shell.news') }}</QButton>
      </div>

      <QSection id="comments" small :title="t('news.comments')" :description="t('news.commentsNote')">
        <QCard>
          <div class="k-stack">
            <QAlert v-if="sent" tone="danger">{{ sent }}</QAlert>
            <ul v-if="data.comments.length" class="p-article-comments">
              <li v-for="c in data.comments" :key="c._id">
                <strong><bdi>{{ c.nickname ?? '—' }}</bdi></strong>
                <span v-if="c.removed" class="p-article-muted">{{ t('live.removed') }}</span><span v-else dir="auto">{{ c.text }}</span>
                <QButton v-if="session.me && !c.removed" variant="ghost" size="sm" icon="flag" @click="report(c._id)">{{ t('live.report') }}</QButton>
              </li>
            </ul>
            <form v-if="session.me" class="p-article-form" novalidate @submit.prevent="send">
              <QTextField id="cm-t" v-model="text" :label="t('news.comment')" hide-label :placeholder="t('news.comment')" :max-length="1000" />
              <QButton type="submit" variant="green" icon="send" :disabled="!text.trim()">{{ t('live.send') }}</QButton>
            </form>
          </div>
        </QCard>
      </QSection>
    </article>
  </QContainer>
</template>

<style scoped>
.p-article { display: flex; flex-direction: column; gap: var(--space-6); max-inline-size: 760px; margin-inline: auto; }
.p-article-head { display: flex; flex-direction: column; gap: var(--space-4); }
.p-article-tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.p-article-title { margin: 0; font-size: 40px; line-height: 56px; font-weight: 900; text-wrap: balance; }
.p-article-meta { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); margin: 0; font-size: 14px; color: var(--ink-muted); }
.p-article-meta span { display: inline-flex; align-items: center; gap: var(--space-2); }
.p-article-figure { margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.p-article-figure img { inline-size: 100%; border-radius: var(--radius-sm); border: 1px solid var(--line); }
.p-article-figure figcaption { font-size: 13px; color: var(--ink-subtle); }
.p-article-body { font-size: 17px; line-height: 32px; white-space: pre-line; overflow-wrap: anywhere; }
.p-article-quote { margin: 0; padding: var(--space-4) var(--space-5); border-inline-start: 3px solid var(--green); background: var(--surface); border-radius: var(--radius-sm); }
.p-article-quote p { margin: 0 0 var(--space-2); font-size: 18px; line-height: 32px; font-weight: 700; }
.p-article-quote cite { font-style: normal; color: var(--ink-muted); font-size: 14px; }
.p-article-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.p-article-comments { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-3); }
.p-article-comments li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font-size: 14px; }
.p-article-muted { color: var(--ink-subtle); }
.p-article-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
@media (max-width: 640px) { .p-article-title { font-size: 30px; line-height: 44px; } }
</style>
