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
const panel = computed(() => !!route.meta.requiresAuth || !!route.meta.permission || route.path.startsWith('/account'));
const collapsed = ref(false);
const main = ref<{ focus: (o?: { preventScroll: boolean }) => void } | null>(null);

const footerLinks = [{ to: '/rules', label: 'nav.rules' }, { to: '/organizers', label: 'nav.organizers' }, { to: '/games', label: 'nav.games' }, { to: '/verify', label: 'ver.title' }, { to: '/account/settings', label: 'nav.settings' }] as const;
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
  else if (panel.value) collapsed.value = !collapsed.value;
  else open.value = !open.value;
}

watch(open, async (value) => {
  await nextTick();
  if (value) document.querySelector<HTMLElement>('#side-nav button, #side-nav a')?.focus();
  else document.getElementById('menu-trigger')?.focus();
});
function drawerKeys(event: KeyboardEvent) {
  if (!open.value) return;
  if (event.key === 'Escape') { open.value = false; return; }
  if (event.key !== 'Tab') return;
  const targets = [...document.querySelectorAll<HTMLElement>('#side-nav a, #side-nav button')].filter(el => el.getClientRects().length > 0);
  const first = targets[0]; const last = targets.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
let stop: (() => void) | undefined;
onMounted(() => {
  stop = startRealtime();
  document.addEventListener('keydown', drawerKeys);
});
onUnmounted(() => { stop?.(); document.removeEventListener('keydown', drawerKeys); });
</script>

<template>
  <a class="skip-link" href="#main" @click.prevent="main?.focus()">{{ t('app.skip') }}</a>
  <TopBar :menu-open="open" :panel="panel" @menu="onMenu" />
  <div class="layout" :class="{ public: !panel }">
    <SideNav v-if="panel || open" :public-only="!panel" :open="open" :collapsed="collapsed" @close="open = false" />
    <main id="main" ref="main" tabindex="-1" class="content" :inert="open">
      <div class="inner">
        <nav v-if="route.path !== '/'" class="crumbs" :aria-label="t('app.breadcrumb')">
          <slot name="breadcrumb">
            <ol>
              <li><RouterLink to="/">{{ t('nav.home') }}</RouterLink></li>
              <li v-if="route.path !== '/' && title" aria-current="page"><Icon name="chevron" :size="14" class="sep" /> {{ title }}</li>
            </ol>
          </slot>
        </nav>
        <slot />
        <footer class="site-footer"><span>{{ t('app.name') }}</span><nav :aria-label="t('app.footer')"><RouterLink v-for="link in footerLinks" :key="link.to" :to="link.to">{{ t(link.label) }}</RouterLink></nav></footer>
      </div>
    </main>
  </div>
</template>

<style scoped>
.layout { display: flex; align-items: flex-start; min-block-size: calc(100vh - var(--topbar-h)); }
.content { flex: 1; min-inline-size: 0; padding: var(--sp-6); }
.site-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--sp-4); margin-block-start: var(--sp-7); padding-block: var(--sp-5); border-block-start: 1px solid var(--border); color: var(--text-muted); font-size: var(--fs-xs); }
.site-footer nav { display: flex; gap: var(--sp-4); }
.site-footer a { color: var(--text-muted); text-decoration: none; }
.public .content { padding-block-start: var(--sp-6); }
.content:focus { outline: none; }
.inner { max-inline-size: var(--content-max); margin-inline: auto; }
.crumbs ol { display: flex; flex-wrap: wrap; gap: var(--sp-2); list-style: none; margin: 0 0 var(--sp-4); padding: 0; font-size: var(--fs-sm); color: var(--text-muted); }
.crumbs li { display: inline-flex; align-items: center; gap: var(--sp-1); }
/* the whole selector must sit inside :global(); with a scoped tail the build emitted a bare [dir=rtl] rule that mirrored the entire page */
:global([dir='rtl'] .crumbs .sep) { transform: scaleX(-1); }
@media (max-width: 900px) { .content { padding: var(--sp-4); } }
</style>
