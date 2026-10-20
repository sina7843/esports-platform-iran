<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PublicPost } from '../api/esp06';
import { esp06 as esp06Api } from '../api/esp06';
import { t } from '../i18n';
import { session } from '../session';
import { settings } from '../settings';
import JalaliDate from './JalaliDate.vue';

/**
 * NEWS-001..008 one timeline item: source (official/reporter/automatic), occurrence and publication times, edited
 * marker with reason, withdrawal tombstone, correction notice and a final/provisional result label. Text is always
 * rendered as text. In low-data mode images load only on request.
 */
const props = defineProps<{ post: PublicPost; showActions?: boolean }>();
const esp06: typeof esp06Api = esp06Api;
const showImages = ref(!settings.lowData);
const reacted = ref<Record<string, number> | null>(null);
const shared = ref('');
const url = computed(() => `${location.origin}/news/${encodeURIComponent(props.post.slug)}`);
async function share() {
  try {
    if (navigator.share) await navigator.share({ title: props.post.title, url: url.value });
    else {
      await navigator.clipboard.writeText(url.value);
      shared.value = t('live.copied');
    }
  } catch {
    /* share sheet closed */
  }
}
async function react(e: string) {
  try {
    reacted.value = await esp06.react(props.post.id, e);
  } catch {
    /* not signed in or rate limited: the button stays */
  }
}
</script>

<template>
  <article class="post" :class="{ pinned: post.pinned, highlighted: post.highlighted, withdrawn: !!post.withdrawal }" :aria-labelledby="`p-${post.id}`">
    <header class="row between">
      <span class="badges">
        <span class="badge" :data-src="post.source">{{ t(`live.src.${post.source}` as never) }}</span>
        <span v-if="post.result" class="badge" :data-tone="post.result.final ? 'ok' : 'warn'">{{ post.result.final ? t('live.final') : t('live.provisional') }}</span>
        <span v-if="post.pinned" class="badge">{{ t('live.pinned') }}</span>
        <span v-if="post.edited" class="badge" :title="post.edited.reason ?? ''">{{ t('live.edited') }}</span>
      </span>
      <span class="muted small"><JalaliDate :iso="post.occurredAt" format="time" /><span v-if="post.publishedAt && post.publishedAt.slice(0, 16) !== post.occurredAt.slice(0, 16)"> · {{ t('live.published') }} <JalaliDate :iso="post.publishedAt" format="time" /></span></span>
    </header>
    <h3 :id="`p-${post.id}`" dir="auto"><RouterLink :to="`/news/${encodeURIComponent(post.slug)}`">{{ post.title }}</RouterLink></h3>
    <p v-if="post.withdrawal" class="danger" role="note">{{ t('live.withdrawn') }}: <span dir="auto">{{ post.withdrawal.reason }}</span></p>
    <template v-else>
      <p v-if="post.correction" class="warn" role="note" dir="auto">{{ post.correction.notice }}</p>
      <p v-if="post.body" class="body" dir="auto">{{ post.body }}</p>
      <blockquote v-if="post.quote" dir="auto">«{{ post.quote.text }}» — {{ post.quote.speaker }}</blockquote>
      <p v-if="post.link"><a :href="post.link.url" rel="noopener noreferrer nofollow" target="_blank" dir="auto">{{ post.link.label || post.link.url }}</a></p>
      <template v-if="post.media.length">
        <button v-if="!showImages" type="button" class="btn btn-sm" @click="showImages = true">{{ t('live.showImages', { n: post.media.length }) }}</button>
        <figure v-for="m in showImages ? post.media.filter((x) => x.url) : []" :key="m.fileId" class="figure">
          <img :src="m.url!" :alt="m.caption ?? post.title" loading="lazy" decoding="async" />
          <figcaption class="small muted" dir="auto">{{ m.caption }} · {{ t('live.credit') }}: {{ m.credit }}</figcaption>
        </figure>
      </template>
      <p v-if="post.edited?.reason" class="muted small" dir="auto">{{ t('live.editReason') }}: {{ post.edited.reason }}</p>
    </template>
    <footer v-if="showActions && !post.withdrawal" class="row">
      <button type="button" class="btn btn-sm" @click="share">{{ t('live.share') }}</button>
      <template v-if="session.me">
        <button v-for="e in ['👍', '🔥', '👏']" :key="e" type="button" class="btn btn-sm" :aria-label="t('live.react', { e })" @click="react(e)">{{ e }}<span v-if="reacted?.[e]"> {{ reacted[e] }}</span></button>
      </template>
      <span v-if="shared" role="status" class="small ok">{{ shared }}</span>
    </footer>
  </article>
</template>

<style scoped>
.post { border-block-end: 1px solid var(--border); padding-block: var(--sp-3); display: grid; gap: var(--sp-2); }
.pinned { background: var(--info-soft); padding-inline: var(--sp-3); border-radius: var(--radius, 6px); }
.highlighted { border-inline-start: 4px solid var(--warn); padding-inline-start: var(--sp-3); }
.withdrawn h3 { text-decoration: line-through; }
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.badges { display: flex; gap: var(--sp-1); flex-wrap: wrap; }
.badge { font-size: var(--fs-xs); padding: 0 var(--sp-2); border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); }
.badge[data-src='official'] { background: var(--ok-soft); color: var(--ok); }
.badge[data-src='automatic'] { background: var(--info-soft); color: var(--info); }
.badge[data-tone='ok'] { background: var(--ok-soft); color: var(--ok); }
.badge[data-tone='warn'] { background: var(--warn-soft); color: var(--warn); }
.body { white-space: pre-wrap; margin: 0; }
.figure { margin: 0; }
.figure img { max-inline-size: 100%; block-size: auto; border-radius: var(--radius, 6px); }
blockquote { margin: 0; padding-inline-start: var(--sp-3); border-inline-start: 3px solid var(--border); }
.small { font-size: var(--fs-xs); }
.danger { color: var(--danger); }
.warn { color: var(--warn); }
.ok { color: var(--ok); }
h3, p { margin: 0; }
</style>
