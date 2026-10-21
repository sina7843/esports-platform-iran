<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { connection } from '../realtime';
import { session } from '../session';
import { setDigits, setLocale, setTheme, settings } from '../settings';
import { t } from '../i18n';
import Icon from './Icon.vue';
import JalaliDate from './JalaliDate.vue';

defineProps<{ menuOpen: boolean }>();
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
  <header class="topbar">
    <button type="button" class="btn btn-sm menu-btn" :aria-expanded="menuOpen" aria-controls="side-nav" :aria-label="menuOpen ? t('app.closeMenu') : t('app.menu')" @click="emit('menu')">
      <Icon :name="menuOpen ? 'close' : 'menu'" />
    </button>
    <RouterLink to="/" class="brand" :aria-label="t('app.name')"><Icon name="trophy" /> <span>{{ t('app.name') }}</span></RouterLink>

    <div class="spacer" />

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
    <button type="button" class="btn btn-sm" :aria-label="t('ui.toggleDigits')" :title="t(`ui.digits.${settings.digits}`)" @click="setDigits(settings.digits === 'fa' ? 'latn' : 'fa')">
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
.spacer { flex: 1; }
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
  .last { display: none; }
  .brand span, .user bdi { display: none; }
}
</style>
