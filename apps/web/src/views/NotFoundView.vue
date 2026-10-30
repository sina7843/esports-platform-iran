<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QButton, QContainer, QDiscoveryCard, QLogo, QSearchField, QSection, QTricolor, fa, isRtl } from '@esp/ui';
import { t } from '../i18n';

/** Spec docs/redesign/03-specs/not-found.md — unknown route. Blocked and missing entities render the same page (never reveal a block). */
const route = useRoute();
const router = useRouter();
const query = ref('');
const path = computed(() => route.fullPath);
// OPEN-QUESTION(not-found): pre-fill the search with words from the failed slug?
function search(q: string) {
  void router.push({ path: '/search', query: q.trim() ? { q: q.trim() } : {} });
}
function back() {
  if (window.history.length > 1) router.back();
  else void router.push('/');
}
const reportHref = computed(() => {
  const ref = document.referrer && new URL(document.referrer, location.href).origin === location.origin ? document.referrer : '';
  const q = new URLSearchParams({ topic: 'broken-link', path: path.value, ...(ref ? { ref } : {}) });
  return `/support?${q.toString()}`;
});
const links = [
  { icon: 'trophy', key: 'events', href: '/events' },
  { icon: 'chart', key: 'rankings', href: '/rankings' },
  { icon: 'users', key: 'recruitment', href: '/recruitment' },
  { icon: 'gamepad', key: 'games', href: '/games' },
] as const;
</script>

<template>
  <QContainer>
    <div class="k-stack nf">
      <div class="p-not-found-wrap">
        <div class="p-not-found-copy">
          <span class="p-not-found-code"><QTricolor />{{ t('nf.code', { code: fa('404') }) }}</span>
          <h1 class="p-not-found-title">{{ t('nf.title') }}</h1>
          <p class="p-not-found-body">{{ t('nf.body') }}</p>
          <span class="p-not-found-path">{{ t('nf.path') }} <bdi class="q-ltr">{{ path }}</bdi></span>
          <QSearchField id="nf-search" v-model="query" :label="t('nf.searchLabel')" :placeholder="t('nf.searchPlaceholder')" :submit-label="t('nf.search')" @submit="search" />
          <div class="p-not-found-actions">
            <QButton variant="primary" size="lg" chamfer icon="home" href="/">{{ t('nf.home') }}</QButton>
            <QButton variant="secondary" size="lg" :icon="isRtl() ? 'arrow-right' : 'arrow-left'" @click="back">{{ t('nf.back') }}</QButton>
            <QButton variant="ghost" size="lg" icon="inbox" :href="reportHref">{{ t('nf.report') }}</QButton>
          </div>
        </div>
        <div class="p-not-found-art" aria-hidden="true">
          <span class="p-not-found-art__num">{{ fa('404') }}</span>
          <span class="p-not-found-art__logo"><QLogo :size="36" alt="" /><QTricolor /></span>
          <div class="p-not-found-br">
            <div class="p-not-found-col">
              <span class="p-not-found-slot p-not-found-slot--win"><i /><b /></span>
              <span class="p-not-found-slot"><i /><b /></span>
            </div>
            <span class="p-not-found-join" />
            <span class="p-not-found-miss">?</span>
          </div>
        </div>
      </div>
      <QSection id="go" :title="t('nf.maybe')" small>
        <div class="p-not-found-links">
          <QDiscoveryCard v-for="l in links" :key="l.key" :icon="l.icon" :title="t(`nf.${l.key}`)" :description="t(`nf.${l.key}Hint`)" :href="l.href" :heading-level="3" />
        </div>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.nf { gap: var(--space-8); }
.p-not-found-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-9); align-items: center; padding-block: var(--space-8); }
.p-not-found-copy { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.p-not-found-code { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 14px; font-weight: 800; color: var(--green-text); }
.p-not-found-title { margin: 0; font-size: 48px; line-height: 64px; font-weight: 900; text-wrap: balance; }
.p-not-found-body { margin: 0; font-size: 17px; line-height: 30px; color: var(--ink-muted); max-width: 52ch; }
.p-not-found-path { font-size: 13px; color: var(--ink-subtle); }
.p-not-found-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
/* illustration: a bracket fragment whose final slot is missing (DS shapes only) */
.p-not-found-art { position: relative; aspect-ratio: 1 / 0.86; border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; background-color: var(--surface);
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 40px 40px; direction: ltr; }
.p-not-found-art__num { position: absolute; inset-inline: 0; inset-block-start: 6%; text-align: center; font-size: 168px; line-height: 1; font-weight: 900; color: transparent; -webkit-text-stroke: 2px var(--line-strong); }
.p-not-found-br { position: absolute; inset-inline: 10%; inset-block-end: 18%; display: grid; grid-template-columns: 1fr 40px 1fr; align-items: center; }
.p-not-found-col { display: flex; flex-direction: column; gap: 28px; }
.p-not-found-slot { display: flex; align-items: center; gap: 10px; block-size: 40px; padding-inline: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-raised); }
.p-not-found-slot i { inline-size: 18px; block-size: 18px; border-radius: 2px; background: var(--line-strong); }
.p-not-found-slot b { flex: 1; block-size: 8px; border-radius: var(--radius-pill); background: var(--line-strong); }
.p-not-found-slot--win { border-color: var(--green-line); }
.p-not-found-slot--win i { background: var(--brand-green); }
.p-not-found-join { block-size: 108px; border: 2px solid var(--line-strong); border-inline-start: 0; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.p-not-found-miss { display: grid; place-items: center; block-size: 56px; border: 2px dashed var(--line-strong); border-radius: var(--radius-sm); color: var(--ink-subtle); font-size: 26px; font-weight: 900; }
.p-not-found-art__logo { position: absolute; inset-block-start: var(--space-5); inset-inline-start: var(--space-5); display: flex; align-items: center; gap: var(--space-3); }
.p-not-found-links { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-4); }
@media (max-width: 960px) {
  .p-not-found-wrap { grid-template-columns: minmax(0, 1fr); gap: var(--space-6); padding-block: var(--space-4); }
  .p-not-found-art { order: -1; aspect-ratio: auto; block-size: 260px; }
  .p-not-found-art__num { font-size: 104px; inset-block-start: 14%; }
  .p-not-found-br { inset-block-end: 10%; inset-inline: 8%; }
  .p-not-found-col { gap: 16px; }
  .p-not-found-slot { block-size: 32px; }
  .p-not-found-join { block-size: 80px; }
  .p-not-found-title { font-size: 34px; line-height: 50px; }
  .p-not-found-links { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) { .p-not-found-actions > * { flex: 1 1 100%; } .p-not-found-links { grid-template-columns: minmax(0, 1fr); } }
</style>
