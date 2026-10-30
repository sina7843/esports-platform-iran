<script setup lang="ts">
import { computed, useId } from 'vue';
import { fa, tr } from '../locale';
import { appArena, appName, connOf, countText, topbarNav, type TopBarNavItem } from '../maps/navigation';
import { useListenerCheck } from '../composables/navigation-dom';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';
import QLogo from './QLogo.vue';

export type { TopBarNavItem };
export interface TopBarUser {
  /** Display name; also the button's accessible name. */
  name: string;
  /** One or two letters for the avatar; default first letter of name. */
  initials?: string;
  avatarSrc?: string;
  href?: string;
}
/**
 * TopBar — the site header. variant 'public' (nav links, guest «ورود» or avatar) | 'panel' (menu button, live-connection
 * chip, notifications). Menu: `v-model:menuOpen` (button icon + aria-expanded) and/or `@menu`; in public mode without a
 * `@menu` listener the bar opens its own inline nav sheet below 900px. Links go through QLink (SPA navigation).
 */
export interface QTopBarProps {
  variant?: ('public' | 'panel') | undefined;
  /** Nav links; default رویدادها، رده‌بندی، بازی‌ها، اخبار، جذب و تمرین، برگزارکنندگان. */
  items?: (TopBarNavItem[]) | undefined;
  /** Key of the current section (aria-current="page"). */
  active?: (string) | undefined;
  /** Show nav links. Default true for public, false for panel. */
  showNav?: boolean | undefined;
  /** Signed-in user; omit for a guest («ورود» primary button). */
  user?: (TopBarUser | null) | undefined;
  /** Unread notifications. The bell shows in panel, or in public when this is set. */
  notifications?: (number) | undefined;
  /** Panel live-connection state: «زنده (SSE)» | «به‌روزرسانی دوره‌ای» | «آفلاین». */
  connection?: ('sse' | 'poll' | 'offline') | undefined;
  /** Time of the last update, already formatted (e.g. «۱۸:۳۲»). */
  lastUpdate?: (string) | undefined;
  title?: (string) | undefined;
  subtitle?: (string) | undefined;
  homeHref?: (string) | undefined;
  loginLabel?: (string) | undefined;
  loginHref?: (string) | undefined;
  searchLabel?: (string) | undefined;
  searchHref?: (string) | undefined;
  settingsLabel?: (string) | undefined;
  notificationsHref?: (string) | undefined;
  /** Uncontrolled initial state of the inline nav sheet (public, narrow). */
  defaultMenuOpen?: (boolean) | undefined;
  /** id of the element the menu button controls (e.g. 'side-nav'). */
  menuControls?: (string) | undefined;
}
const p = withDefaults(defineProps<QTopBarProps>(), { variant: 'public', showNav: undefined, homeHref: '/' });
const menuModel = defineModel<boolean | undefined>('menuOpen', { default: undefined });
const emit = defineEmits<{
  login: [e: MouseEvent]; search: [e: MouseEvent]; settings: [e: MouseEvent]; notifications: [e: MouseEvent];
  user: [e: MouseEvent]; menu: []; navigate: [key: string, e: MouseEvent];
}>();
const listens = useListenerCheck();

const id = useId();
const sheetId = `${id}-nav`;
const panel = computed(() => p.variant === 'panel');
const navItems = computed(() => p.items ?? topbarNav());
const showNavLinks = computed(() => p.showNav ?? !panel.value);
const menuOpen = computed(() => menuModel.value ?? !!p.defaultMenuOpen);
const useSheet = computed(() => !panel.value && showNavLinks.value && !listens('onMenu'));
const conn = computed(() => (panel.value && p.connection ? connOf(p.connection) : null));
const showBell = computed(() => panel.value || p.notifications != null);
const menuLabel = computed(() => (menuOpen.value ? tr('بستن منو', 'Close menu') : tr('منو', 'Menu')));
const searchText = computed(() => p.searchLabel || tr('جست‌وجو', 'Search'));
const settingsText = computed(() => p.settingsLabel || tr('تنظیمات نمایش', 'Display settings'));
const bellText = computed(() => {
  const n = p.notifications;
  return tr('اعلان‌ها', 'Notifications') + (n ? tr(`، ${fa(n)} خوانده‌نشده`, `, ${n} unread`) : '');
});
const brandName = computed(() => p.title || appName());
const loginTarget = computed(() => p.loginHref || (listens('onLogin') ? undefined : '/login'));

function onMenu() {
  emit('menu');
  menuModel.value = !menuOpen.value;
}
// SPA navigation does not reload the page, so the inline sheet closes itself after a link is chosen.
function onSheetLink(key: string, e: MouseEvent) {
  emit('navigate', key, e);
  menuModel.value = false;
}
</script>

<template>
  <header :class="['q-top-bar', panel ? 'q-top-bar--panel' : 'q-top-bar--public']">
    <div class="q-top-bar__inner">
      <button
        v-if="panel || showNavLinks" type="button" :class="['q-top-bar__icon', 'q-top-bar__menu', { 'q-top-bar__menu--always': panel }]"
        :aria-label="menuLabel" :title="menuLabel" :aria-expanded="menuOpen ? 'true' : 'false'"
        :aria-controls="menuControls || (useSheet && menuOpen ? sheetId : undefined)" @click="onMenu"
      >
        <QIcon :name="menuOpen ? 'x' : 'menu'" :size="20" />
      </button>
      <QLink :href="homeHref" class="q-top-bar__brand" :aria-label="brandName">
        <QLogo :size="48" alt="" />
        <span class="q-top-bar__brand-copy" aria-hidden="true">
          <strong>{{ brandName }}</strong>
          <small>{{ subtitle || appArena() }}</small>
        </span>
      </QLink>
      <nav v-if="showNavLinks" class="q-top-bar__nav" :aria-label="tr('ناوبری اصلی', 'Main navigation')">
        <QLink
          v-for="it in navItems" :key="it.key" :href="it.href || '#'" :class="['q-top-bar__link', { 'is-active': it.key === active }]"
          :aria-current="it.key === active ? 'page' : undefined" @click="emit('navigate', it.key, $event)"
        >{{ it.label }}</QLink>
      </nav>
      <div v-if="conn" class="q-top-bar__status">
        <span class="q-top-bar__conn" :data-tone="conn.tone" role="status">
          <span class="q-top-bar__conn-dot" aria-hidden="true" />
          <span>{{ conn.label }}</span>
          <span v-if="lastUpdate" class="q-top-bar__conn-last">{{ tr('آخرین به‌روزرسانی ', 'Last update ') }}<span class="q-num">{{ lastUpdate }}</span></span>
        </span>
      </div>
      <div class="q-top-bar__actions">
        <QLink v-if="searchHref" :href="searchHref" class="q-top-bar__icon" :aria-label="searchText" :title="searchText" @click="emit('search', $event)">
          <QIcon name="search" :size="20" />
        </QLink>
        <button v-else type="button" class="q-top-bar__icon" :aria-label="searchText" :title="searchText" @click="emit('search', $event)">
          <QIcon name="search" :size="20" />
        </button>
        <button type="button" class="q-top-bar__icon q-top-bar__icon--settings" :aria-label="settingsText" :title="settingsText" @click="emit('settings', $event)">
          <QIcon name="settings" :size="20" />
        </button>
        <template v-if="showBell">
          <QLink v-if="notificationsHref" :href="notificationsHref" class="q-top-bar__icon" :aria-label="bellText" :title="bellText" @click="emit('notifications', $event)">
            <QIcon name="bell" :size="20" />
            <span v-if="notifications" class="q-top-bar__count" aria-hidden="true">{{ countText(notifications) }}</span>
          </QLink>
          <button v-else type="button" class="q-top-bar__icon" :aria-label="bellText" :title="bellText" @click="emit('notifications', $event)">
            <QIcon name="bell" :size="20" />
            <span v-if="notifications" class="q-top-bar__count" aria-hidden="true">{{ countText(notifications) }}</span>
          </button>
        </template>
        <template v-if="user">
          <QLink v-if="user.href" :href="user.href" class="q-top-bar__user" :aria-label="user.name" :title="user.name" @click="emit('user', $event)">
            <span class="q-top-bar__avatar" aria-hidden="true"><img v-if="user.avatarSrc" :src="user.avatarSrc" alt="" /><template v-else>{{ user.initials || String(user.name || '').charAt(0) }}</template></span>
            <bdi class="q-top-bar__user-name">{{ user.name }}</bdi>
          </QLink>
          <button v-else type="button" class="q-top-bar__user" :aria-label="user.name" :title="user.name" @click="emit('user', $event)">
            <span class="q-top-bar__avatar" aria-hidden="true"><img v-if="user.avatarSrc" :src="user.avatarSrc" alt="" /><template v-else>{{ user.initials || String(user.name || '').charAt(0) }}</template></span>
            <bdi class="q-top-bar__user-name">{{ user.name }}</bdi>
          </button>
        </template>
        <QButton
          v-else variant="primary" v-bind="loginTarget ? { href: loginTarget } : {}" class="q-top-bar__login"
          style="border-radius: var(--radius-lg)" @click="emit('login', $event)"
        >{{ loginLabel || tr('ورود', 'Sign in') }}</QButton>
      </div>
    </div>
    <nav v-if="useSheet && menuOpen" :id="sheetId" class="q-top-bar__sheet" :aria-label="tr('ناوبری اصلی', 'Main navigation')">
      <QLink
        v-for="it in navItems" :key="it.key" :href="it.href || '#'" :class="['q-top-bar__sheet-link', { 'is-active': it.key === active }]"
        :aria-current="it.key === active ? 'page' : undefined" @click="onSheetLink(it.key, $event)"
      >{{ it.label }}</QLink>
    </nav>
  </header>
</template>
