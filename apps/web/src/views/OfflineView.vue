<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QBadge, QButton, QContainer, QIcon, QLogo, QTricolor, formatJalali, isRtl } from '@esp/ui';
import { t } from '../i18n';
import { connection } from '../realtime';
import { safeRedirect } from '../validators';

/** Spec docs/redesign/03-specs/offline.md — the connection is down; retry, and reload by itself when it comes back. */
const route = useRoute();
const router = useRouter();
const checking = ref(false);
const target = computed(() => (typeof route.query.from === 'string' ? safeRedirect(route.query.from) : ''));
const lastSeen = computed(() => (connection.lastUpdate ? formatJalali(connection.lastUpdate, 'time') : ''));
const heights = [40, 64, 88, 112];

function retry() {
  checking.value = true;
  if (navigator.onLine && target.value) void router.replace(target.value).finally(() => { checking.value = false; });
  else if (navigator.onLine) window.location.reload();
  else setTimeout(() => { checking.value = false; }, 1500);
}
function back() {
  if (window.history.length > 1) router.back();
  else void router.push('/');
}
const onOnline = () => retry();
onMounted(() => window.addEventListener('online', onOnline));
onUnmounted(() => window.removeEventListener('online', onOnline));
</script>

<template>
  <QContainer>
    <div class="p-offline-wrap">
      <div class="p-offline-copy">
        <div class="p-offline-status" role="status">
          <QBadge tone="warning" dot>{{ checking ? t('off.checking') : t('off.noConnection') }}</QBadge>
          <span v-if="lastSeen">{{ t('off.last', { time: lastSeen }) }}</span>
        </div>
        <h1 class="p-offline-title">{{ t('off.title') }}</h1>
        <p class="p-offline-body">{{ t('off.body') }}</p>
        <div class="p-offline-actions">
          <QButton variant="primary" size="lg" chamfer icon="refresh" :loading="checking" @click="retry">{{ t('off.retry') }}</QButton>
          <QButton variant="secondary" size="lg" :icon="isRtl() ? 'arrow-right' : 'arrow-left'" @click="back">{{ t('off.back') }}</QButton>
        </div>
        <ul class="p-offline-help">
          <li><QIcon name="wifi-off" :size="18" />{{ t('off.helpWifi') }}</li>
          <li><QIcon name="globe" :size="18" />{{ t('off.helpVpn') }}</li>
          <li><QIcon name="swords" :size="18" />{{ t('off.helpMatch') }}</li>
        </ul>
      </div>
      <div class="p-offline-art" aria-hidden="true">
        <span class="p-offline-art__word">OFFLINE</span>
        <div class="p-offline-art__meter">
          <span v-for="(hh, i) in heights" :key="i" :class="['p-offline-art__bar', { 'p-offline-art__bar--on': i === 0, 'p-offline-art__bar--off': i > 1 }]" :style="{ blockSize: `${hh}px` }" />
        </div>
        <span class="p-offline-art__tile q-chamfer-md"><QIcon name="wifi-off" :size="40" /></span>
        <span class="p-offline-art__logo"><QLogo :size="36" alt="" /><QTricolor /></span>
        <span class="p-offline-art__tag"><QBadge tone="warning" icon="wifi-off">{{ t('off.badge') }}</QBadge></span>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-offline-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-9); align-items: center; padding-block: var(--space-8); }
.p-offline-copy { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.p-offline-status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); font-size: 13px; color: var(--ink-subtle); }
.p-offline-title { margin: 0; font-size: 48px; line-height: 64px; font-weight: 900; text-wrap: balance; }
.p-offline-body { margin: 0; font-size: 17px; line-height: 30px; color: var(--ink-muted); max-width: 52ch; }
.p-offline-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.p-offline-help { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: var(--space-5); list-style: none; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.p-offline-help li { display: flex; gap: var(--space-3); align-items: flex-start; font-size: 14px; line-height: 24px; color: var(--ink-muted); }
.p-offline-help :deep(.q-icon) { color: var(--green-text); flex: none; margin-block-start: 2px; }
/* illustration: arena grid, a signal meter whose bars break off, an outlined OFFLINE word and the wifi-off tile */
.p-offline-art { position: relative; aspect-ratio: 1 / 0.86; border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; background-color: var(--surface);
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 40px 40px; }
.p-offline-art__word { position: absolute; inset-inline: 0; inset-block-start: 9%; text-align: center; font-size: 96px; line-height: 1; font-weight: 900; color: transparent; -webkit-text-stroke: 2px var(--line-strong); direction: ltr; }
.p-offline-art__meter { position: absolute; inset-block-end: 22%; inset-inline: 0; display: flex; justify-content: center; align-items: flex-end; gap: 14px; direction: ltr; }
.p-offline-art__bar { inline-size: 34px; border-radius: var(--radius-sm); border: 2px solid var(--line-strong); background: var(--surface-raised); }
.p-offline-art__bar--on { background: var(--brand-green); border-color: var(--brand-green); }
.p-offline-art__bar--off { border-style: dashed; background: transparent; }
.p-offline-art__tile { position: absolute; inset-block-start: 34%; inset-inline-end: 12%; inline-size: 96px; block-size: 96px; display: grid; place-items: center; background: var(--surface-raised); border: 1px solid var(--line-strong); color: var(--warning-text); }
.p-offline-art__logo { position: absolute; inset-block-end: var(--space-5); inset-inline-start: var(--space-5); display: flex; align-items: center; gap: var(--space-3); }
.p-offline-art__tag { position: absolute; inset-block-end: var(--space-5); inset-inline-end: var(--space-5); }
@media (max-width: 960px) {
  .p-offline-wrap { grid-template-columns: minmax(0, 1fr); gap: var(--space-6); padding-block: var(--space-4); }
  .p-offline-art { order: -1; aspect-ratio: auto; block-size: 240px; }
  .p-offline-art__word { font-size: 60px; inset-block-start: 8%; }
  .p-offline-art__meter { inset-block-end: 26%; gap: 10px; }
  .p-offline-art__bar { inline-size: 24px; max-block-size: 64px; }
  .p-offline-art__tile { inline-size: 64px; block-size: 64px; inset-block-start: 32%; inset-inline-end: 8%; }
  .p-offline-title { font-size: 34px; line-height: 50px; }
}
@media (max-width: 560px) { .p-offline-actions > * { flex: 1 1 100%; } }
</style>
