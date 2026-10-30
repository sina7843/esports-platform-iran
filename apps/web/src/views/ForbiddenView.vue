<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QBadge, QButton, QContainer, QIcon, QLogo, QTricolor, fa, isRtl } from '@esp/ui';
import { t } from '../i18n';
import { session } from '../session';
import { safeRedirect } from '../validators';

/** Spec docs/redesign/03-specs/forbidden.md — guest: sign in and come back; signed in: no role, ask for access. The server decides. */
const route = useRoute();
const router = useRouter();
const guest = computed(() => !session.me);
const from = computed(() => (typeof route.query.from === 'string' ? safeRedirect(route.query.from) : ''));
const loginHref = computed(() => (from.value ? `/login?redirect=${encodeURIComponent(from.value)}` : '/login'));
function back() {
  if (window.history.length > 1) router.back();
  else void router.push('/');
}
</script>

<template>
  <QContainer>
    <div class="p-forbidden-wrap">
      <div class="p-forbidden-copy">
        <span class="p-forbidden-code"><QIcon name="lock" :size="16" />{{ t('fb.code', { code: fa('403') }) }}</span>
        <h1 class="p-forbidden-title">{{ guest ? t('fb.titleGuest') : t('fb.title') }}</h1>
        <p class="p-forbidden-body">{{ guest ? t('fb.bodyGuest') : t('fb.body') }}</p>
        <div class="p-forbidden-actions">
          <QButton v-if="guest" variant="primary" size="lg" chamfer icon="user" :href="loginHref">{{ t('fb.signIn') }}</QButton>
          <QButton v-else variant="primary" size="lg" chamfer icon="home" href="/">{{ t('fb.home') }}</QButton>
          <QButton variant="secondary" size="lg" :icon="isRtl() ? 'arrow-right' : 'arrow-left'" @click="back">{{ t('fb.back') }}</QButton>
          <QButton v-if="guest" variant="ghost" size="lg" href="/">{{ t('fb.home') }}</QButton>
          <QButton v-else variant="ghost" size="lg" icon="inbox" href="/support">{{ t('fb.request') }}</QButton>
        </div>
        <ul class="p-forbidden-help">
          <li><QIcon name="info" :size="18" />{{ t('fb.helpServer') }}</li>
          <li v-if="guest"><QIcon name="shield" :size="18" />{{ t('fb.helpOtp') }}</li>
          <template v-else>
            <li><QIcon name="users" :size="18" />{{ t('fb.helpAccounts') }}</li>
            <li><QIcon name="clock" :size="18" />{{ t('fb.helpDelay') }}</li>
          </template>
        </ul>
        <div v-if="from" class="p-forbidden-meta"><span>{{ t('fb.path') }} <bdi class="q-ltr">{{ from }}</bdi></span></div>
      </div>
      <div class="p-forbidden-art" aria-hidden="true">
        <span class="p-forbidden-art__num">{{ fa('403') }}</span>
        <span class="p-forbidden-art__bar q-stripes" />
        <span class="p-forbidden-art__tile q-chamfer-lg"><span class="p-forbidden-art__lock"><QIcon name="lock" :size="34" /></span></span>
        <span class="p-forbidden-art__logo"><QLogo :size="36" alt="" /><QTricolor /></span>
        <span class="p-forbidden-art__tag"><QBadge tone="danger" icon="ban">{{ t('fb.noAccess') }}</QBadge></span>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-forbidden-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-9); align-items: center; padding-block: var(--space-8); }
.p-forbidden-copy { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.p-forbidden-code { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 14px; font-weight: 800; color: var(--danger-text); }
.p-forbidden-title { margin: 0; font-size: 48px; line-height: 64px; font-weight: 900; text-wrap: balance; }
.p-forbidden-body { margin: 0; font-size: 17px; line-height: 30px; color: var(--ink-muted); max-width: 52ch; }
.p-forbidden-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.p-forbidden-help { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: var(--space-5); list-style: none; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.p-forbidden-help li { display: flex; gap: var(--space-3); align-items: flex-start; font-size: 14px; line-height: 24px; color: var(--ink-muted); }
.p-forbidden-help :deep(.q-icon) { color: var(--green-text); flex: none; margin-block-start: 2px; }
.p-forbidden-meta { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); font-size: 13px; color: var(--ink-subtle); }
/* illustration: hairline arena grid, outlined 403, a striped barrier and a chamfered lock tile (DS shapes only) */
.p-forbidden-art { position: relative; aspect-ratio: 1 / 0.86; border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; background-color: var(--surface);
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 40px 40px; }
.p-forbidden-art__num { position: absolute; inset-inline: 0; inset-block-start: 8%; text-align: center; font-size: 168px; line-height: 1; font-weight: 900; color: transparent; -webkit-text-stroke: 2px var(--line-strong); direction: ltr; }
.p-forbidden-art__bar { position: absolute; inset-inline: -10%; inset-block-start: 52%; block-size: 44px; transform: rotate(-6deg); border-block: 2px solid var(--danger-line, var(--line-strong)); }
.p-forbidden-art__tile { position: absolute; inset-block-start: 38%; inset-inline-start: 50%; transform: translateX(-50%); inline-size: 132px; block-size: 132px; display: grid; place-items: center; background: var(--surface-raised); border: 1px solid var(--line-strong); }
:global([dir="rtl"] .p-forbidden-art__tile) { transform: translateX(50%); }
.p-forbidden-art__lock { display: grid; place-items: center; inline-size: 76px; block-size: 76px; border-radius: var(--radius-pill); background: var(--danger-soft); color: var(--danger-text); border: 1px solid var(--line-strong); }
.p-forbidden-art__logo { position: absolute; inset-block-end: var(--space-5); inset-inline-start: var(--space-5); display: flex; align-items: center; gap: var(--space-3); }
.p-forbidden-art__tag { position: absolute; inset-block-end: var(--space-5); inset-inline-end: var(--space-5); }
@media (max-width: 960px) {
  .p-forbidden-wrap { grid-template-columns: minmax(0, 1fr); gap: var(--space-6); padding-block: var(--space-4); }
  .p-forbidden-art { order: -1; aspect-ratio: auto; block-size: 240px; }
  .p-forbidden-art__num { font-size: 104px; inset-block-start: 6%; }
  .p-forbidden-art__tile { inline-size: 96px; block-size: 96px; inset-block-start: 34%; }
  .p-forbidden-art__lock { inline-size: 56px; block-size: 56px; }
  .p-forbidden-title { font-size: 34px; line-height: 50px; }
}
@media (max-width: 560px) { .p-forbidden-actions > * { flex: 1 1 100%; } }
</style>
