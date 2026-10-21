<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { startRealtime } from '../realtime';
import { t } from '../i18n';
import { settings } from '../settings';
import Icon from './Icon.vue';
import SideNav from './SideNav.vue';
import TopBar from './TopBar.vue';

const route = useRoute();
const open = ref(false);
const collapsed = ref(false);
const main = ref<{ focus: (o?: { preventScroll: boolean }) => void } | null>(null);

const title = computed(() => (route.meta.title ? t(route.meta.title) : ''));
watch([title, () => settings.locale], () => {
  globalThis.document.title = title.value ? `${title.value} — ${t('app.name')}` : t('app.name');
}, { immediate: true });

watch(() => route.fullPath, async () => {
  open.value = false;
  await nextTick();
  main.value?.focus({ preventScroll: true }); // move keyboard/screen-reader context to the new page
});

function onMenu() {
  if (globalThis.matchMedia('(max-width: 900px)').matches) open.value = !open.value;
  else collapsed.value = !collapsed.value;
}

let stop: (() => void) | undefined;
onMounted(() => {
  stop = startRealtime();
});
onUnmounted(() => stop?.());
</script>

<template>
  <a class="skip-link" href="#main" @click.prevent="main?.focus()">{{ t('app.skip') }}</a>
  <TopBar :menu-open="open" @menu="onMenu" />
  <div class="layout">
    <SideNav :open="open" :collapsed="collapsed" @close="open = false" />
    <main id="main" ref="main" tabindex="-1" class="content">
      <div class="inner">
        <nav class="crumbs" :aria-label="t('app.breadcrumb')">
          <slot name="breadcrumb">
            <ol>
              <li><RouterLink to="/">{{ t('nav.home') }}</RouterLink></li>
              <li v-if="route.path !== '/' && title" aria-current="page"><Icon name="chevron" :size="14" class="sep" /> {{ title }}</li>
            </ol>
          </slot>
        </nav>
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.layout { display: flex; align-items: flex-start; min-block-size: calc(100vh - var(--topbar-h)); }
.content { flex: 1; min-inline-size: 0; padding: var(--sp-5); }
.content:focus { outline: none; }
.inner { max-inline-size: var(--content-max); margin-inline: auto; }
.crumbs ol { display: flex; flex-wrap: wrap; gap: var(--sp-2); list-style: none; margin: 0 0 var(--sp-4); padding: 0; font-size: var(--fs-sm); color: var(--text-muted); }
.crumbs li { display: inline-flex; align-items: center; gap: var(--sp-1); }
/* the whole selector must sit inside :global(); with a scoped tail the build emitted a bare [dir=rtl] rule that mirrored the entire page */
:global([dir='rtl'] .crumbs .sep) { transform: scaleX(-1); }
@media (max-width: 900px) { .content { padding: var(--sp-4); } }
</style>
