<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { connection } from '../realtime';
import { session } from '../session';
import { setDigits, setLocale, setTheme, settings } from '../settings';
import { t } from '../i18n';
import Icon from './Icon.vue';
import JalaliDate from './JalaliDate.vue';

defineProps<{ menuOpen: boolean; panel?: boolean }>();
const emit = defineEmits<{ menu: [] }>();

const themes = ['light', 'dark', 'system'] as const;
function cycleTheme() {
  setTheme(themes[(themes.indexOf(settings.theme) + 1) % themes.length] ?? 'system');
}
const isDark = computed(() => settings.theme === 'dark');

const chip = computed(() => {
  if (!connection.online) return { tone: 'down', text: t('conn.offline') };
  if (!connection.reachable) return { tone: 'warn', text: t('conn.unreachable') };
  if (connection.mode === 'sse') return { tone: 'ok', text: t('conn.sse') };
  if (connection.mode === 'poll') return { tone: 'warn', text: t('conn.poll') };
  return { tone: 'ok', text: t('conn.online') };
});
</script>

<template>
  <header class="topbar" :class="{ 'public-topbar': !panel }">
    <button id="menu-trigger" type="button" class="btn btn-sm menu-btn" :aria-expanded="menuOpen" aria-controls="side-nav" :aria-label="menuOpen ? t('app.closeMenu') : t('app.menu')" @click="emit('menu')">
      <Icon :name="menuOpen ? 'close' : 'menu'" />
    </button>
    <RouterLink to="/" class="brand" :aria-label="t('app.name')"><span class="brand-mark"><Icon name="swords" :size="24" /></span><span class="brand-copy">{{ t('app.name') }}<small>{{ t('app.arena') }}</small></span></RouterLink>

    <nav class="top-links" :aria-label="t('home.discover')"><RouterLink to="/events">{{ t('nav.events') }}</RouterLink><RouterLink to="/rankings">{{ t('nav.rankings') }}</RouterLink><RouterLink to="/games">{{ t('nav.games') }}</RouterLink><RouterLink to="/news">{{ t('nav.news') }}</RouterLink><RouterLink to="/recruitment">{{ t('nav.recruitment') }}</RouterLink><RouterLink to="/organizers">{{ t('nav.organizers') }}</RouterLink></nav>
    <div class="spacer" />
    <RouterLink to="/search" class="btn btn-sm quick-search" :aria-label="t('nav.search')"><Icon name="search" /></RouterLink>

    <div class="chip" role="status" :data-tone="chip.tone" :title="`${t('conn.lastUpdate')}`">
      <span class="dot" aria-hidden="true" />
      <span>{{ chip.text }}</span>
      <span class="last muted">
        {{ t('conn.lastUpdate') }}:
        <JalaliDate v-if="connection.lastUpdate" :iso="connection.lastUpdate" format="time" />
        <template v-else>{{ t('conn.none') }}</template>
      </span>
    </div>

    <button type="button" class="btn btn-sm" :aria-label="`${t('ui.toggleTheme')}: ${t(`ui.theme.${settings.theme}`)}`" :title="t(`ui.theme.${settings.theme}`)" @click="cycleTheme">
      <Icon :name="isDark ? 'moon' : 'sun'" />
    </button>
    <button type="button" class="btn btn-sm" :aria-label="t('ui.toggleLocale')" :lang="settings.locale === 'fa' ? 'en' : 'fa'" @click="setLocale(settings.locale === 'fa' ? 'en' : 'fa')">
      <Icon name="globe" /> {{ settings.locale === 'fa' ? 'EN' : 'فا' }}
    </button>
    <button type="button" class="btn btn-sm digits-toggle" :aria-label="t('ui.toggleDigits')" :title="t(`ui.digits.${settings.digits}`)" @click="setDigits(settings.digits === 'fa' ? 'latn' : 'fa')">
      <Icon name="hash" /> <span class="num">{{ settings.digits === 'fa' ? '۱۲۳' : '123' }}</span>
    </button>

    <RouterLink v-if="session.me" to="/account" class="btn btn-sm user" :aria-label="session.me.principal.displayName"><Icon name="user" /> <bdi>{{ session.me.principal.displayName }}</bdi></RouterLink>
    <RouterLink v-else to="/login" class="btn btn-sm btn-primary">{{ t('nav.login') }}</RouterLink>
  </header>
</template>

<style scoped>
.topbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: var(--sp-2); min-block-size: var(--topbar-h); padding: var(--sp-2) var(--sp-4); background: var(--surface); border-block-end: 1px solid var(--border); }
.brand { min-inline-size: 2.5rem; min-block-size: 2.5rem; justify-content: center; display: inline-flex; align-items: center; gap: var(--sp-2); font-weight: 800; font-size: var(--fs-lg); color: var(--text); text-decoration: none; }
.brand :deep(svg) { color: var(--accent); }
.brand-mark { display: grid; place-items: center; inline-size: 44px; block-size: 44px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--accent-soft); }
.brand-copy { display: grid; font-size: var(--fs-md); line-height: 1.5; }
.brand-copy small { font-size: var(--fs-xs); color: var(--text-muted); font-weight: 400; }
.public-topbar { padding-inline: var(--sp-6); }
.public-topbar .chip { display: none; }
.top-links { display: flex; gap: var(--sp-5); padding-inline-start: var(--sp-6); font-size: var(--fs-sm); }
.top-links a { text-decoration: none; color: var(--text-muted); }
.top-links .router-link-active { color: var(--accent); }
.spacer { flex: 1; }
@media (max-width: 1400px) { .top-links { gap: var(--sp-3); padding-inline-start: var(--sp-3); } .chip .last { display: none; } }
@media (min-width: 901px) { .topbar:not(.public-topbar) .top-links { display: none; } .topbar:not(.public-topbar) .menu-btn { display: inline-flex; } }
@media (max-width: 1100px) and (min-width: 901px) { .public-topbar { flex-wrap: wrap; } .public-topbar .top-links { order: 10; inline-size: 100%; justify-content: center; padding-block: var(--sp-2); } }
.menu-btn { display: none; }
.chip { display: inline-flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-3); border: 1px solid var(--border); border-radius: 999px; font-size: var(--fs-sm); }
.dot { inline-size: 0.6rem; block-size: 0.6rem; border-radius: 50%; background: var(--text-muted); }
[data-tone='ok'] .dot { background: var(--ok); }
[data-tone='warn'] .dot { background: var(--warn); }
[data-tone='down'] .dot { background: var(--danger); }
@media (max-width: 900px) {
  /* seven controls do not fit one 390px row; wrapping beats pushing the page sideways (it shifted the whole RTL layout) */
  .topbar { flex-wrap: wrap; row-gap: var(--sp-1); }
  .menu-btn { display: inline-flex; }
  .top-links { display: none; }
  .public-topbar { padding-inline: var(--sp-3); }
  .last { display: none; }
  .brand .brand-copy, .user bdi, .digits-toggle, .quick-search { display: none; }
  .chip { font-size: var(--fs-xs); padding-inline: var(--sp-2); }
  .topbar { gap: var(--sp-1); }
}
</style>
