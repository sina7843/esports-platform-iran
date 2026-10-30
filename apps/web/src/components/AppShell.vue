<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QFooter, QSideNav, QTopBar, formatJalali, type IconName } from '@esp/ui';
import { esp06 } from '../api/esp06';
import { connection, startRealtime } from '../realtime';
import { t, type MessageKey } from '../i18n';
import { can, session } from '../session';
import { settings } from '../settings';

/**
 * The QeSB kit shells (docs/redesign/02-prototypes/kit/kit.js Shell()): public (top bar + footer), auth (no footer; no
 * sign-in button on /login) and panel (top bar + side nav rail at 900px and wider, drawer below). Bare displays render
 * in App.vue. Views without meta.redesigned keep the old look inside .legacy-view until their page task lands.
 */
const route = useRoute();
const router = useRouter();
const kind = computed(() => route.meta.layout ?? 'public');
const panel = computed(() => kind.value === 'panel');
const menuOpen = ref(false);
const main = ref<HTMLElement | null>(null);

const narrow = ref(false);
let mq: MediaQueryList | undefined;
const onWidth = () => {
  narrow.value = !!mq?.matches;
  if (!narrow.value) menuOpen.value = false;
};

const title = computed(() => (route.meta.title ? t(route.meta.title) : ''));
watch([title, () => settings.locale], () => {
  globalThis.document.title = title.value ? `${title.value} — ${t('app.name')}` : t('app.name');
}, { immediate: true });

watch(() => route.fullPath, async () => {
  menuOpen.value = false;
  await nextTick();
  main.value?.focus({ preventScroll: true }); // move keyboard/screen-reader context to the new page
});

const L = (k: string) => t(`shell.${k}` as MessageKey);
const topItems = computed(() => (['events', 'rankings', 'games', 'news', 'recruitment', 'organizers'] as const).map((k) => ({ key: k, label: L(k), href: `/${k}` })));

const unread = ref<number | undefined>(undefined);
watch(() => session.me?.principal.id, async (id) => {
  unread.value = undefined;
  if (!id) return;
  try {
    unread.value = (await esp06.notifications({ unread: true })).unread || undefined;
  } catch {
    /* the badge is optional */
  }
}, { immediate: true });

const user = computed(() => {
  const me = session.me;
  if (!me) return null;
  const name = me.principal.displayName;
  return { name, initials: Array.from(name.trim())[0] ?? '?', href: '/account' };
});
const loginHref = computed(() => (route.path === '/' || route.name === 'login' ? '/login' : `/login?redirect=${encodeURIComponent(route.fullPath)}`));
// built as a loose record so optional props that are absent stay absent (exactOptionalPropertyTypes)
const common = computed<Record<string, unknown>>(() => ({
  user: user.value, homeHref: '/', searchHref: '/search', loginHref: loginHref.value,
  notificationsHref: '/account/notifications', notifications: unread.value,
  loginLabel: L('sign_in'), searchLabel: L('search'), settingsLabel: L('display_settings'),
  title: L('esports_platform'), subtitle: L('the_arena'),
}));
const conn = computed<'sse' | 'poll' | 'offline'>(() => (!connection.online || !connection.reachable ? 'offline' : connection.mode === 'poll' ? 'poll' : 'sse'));
const panelBar = computed<Record<string, unknown>>(() => ({ ...common.value, connection: conn.value, lastUpdate: connection.lastUpdate ? formatJalali(connection.lastUpdate, 'time') : undefined }));

type Item = { key: string; label: string; icon: IconName; href: string };
const it = (key: string, icon: IconName, label: string, href: string): Item => ({ key, icon, label: L(label), href });
const sections = computed(() => {
  const out: { title: string; items: Item[] }[] = [{ title: L('public'), items: [
    it('home', 'home', 'home', '/'), it('events', 'trophy', 'events', '/events'), it('rankings', 'chart', 'rankings', '/rankings'),
    it('news', 'news', 'news', '/news'), it('search', 'search', 'search', '/search')] }];
  if (session.me) out.push({ title: L('my_account'), items: [
    it('account', 'user', 'my_account', '/account'), it('profile', 'edit', 'profile', '/account/profile'), it('my-teams', 'users', 'my_teams', '/teams'),
    it('registrations', 'ticket', 'my_registrations', '/account/registrations'), it('calendar', 'calendar', 'my_calendar', '/account/calendar'),
    it('certificates', 'award', 'certificates', '/account/certificates'), it('notifications', 'bell', 'notifications', '/account/notifications'),
    it('messages', 'message', 'messages', '/messages'), it('support', 'inbox', 'support', '/support'), it('security', 'lock', 'security', '/account/security'),
    it('privacy', 'shield', 'privacy', '/account/privacy'), it('settings', 'settings', 'settings', '/account/settings')] });
  else out.push({ title: L('my_account'), items: [it('settings', 'settings', 'settings', '/account/settings')] });
  const roles: Item[] = [];
  if (can('team.read_private')) roles.push(it('team-panel', 'users', 'team_panel', '/team'));
  if (can('event.manage')) roles.push(it('organizer', 'trophy', 'organizer', '/organizer'));
  if (can('acl.read')) roles.push(it('organizer-access', 'lock', 'access', '/organizer/access'));
  if (can('match.result.verify')) roles.push(it('referee', 'gavel', 'refereeing', '/referee'));
  if (can('news.draft')) roles.push(it('newsroom', 'news', 'newsroom', '/newsroom'));
  if (can('finance.read')) roles.push(it('finance', 'wallet', 'finance', '/finance'));
  if (can('approval.read')) roles.push(it('finance-approvals', 'check', 'approvals', '/finance/approvals'));
  if (can('platform.settings')) {
    roles.push(
      it('admin', 'settings', 'platform_admin', '/admin'), it('admin-users', 'users', 'users', '/admin/users'),
      it('admin-reviews', 'shield', 'account_reviews', '/admin/reviews'), it('admin-tickets', 'inbox', 'tickets', '/admin/tickets'),
      it('admin-tasks', 'list', 'tasks', '/admin/tasks'), it('admin-ops', 'server', 'service_health', '/admin/ops'),
      it('admin-ratings', 'chart', 'rating_system', '/admin/ratings'), it('admin-reports', 'activity', 'reports', '/admin/reports'),
      it('admin-integrations', 'link', 'integrations', '/admin/integrations'), it('admin-privacy', 'lock', 'privacy', '/admin/privacy'),
      it('admin-settings', 'settings', 'platform_settings', '/admin/settings'));
  } else if (can('admin.reports')) roles.push(it('admin-reports', 'activity', 'reports', '/admin/reports'));
  if (roles.length) out.push({ title: L('roles'), items: roles });
  return out;
});

const footerGroups = computed(() => {
  const l = (k: string, href: string) => ({ label: L(k), href });
  return [
    { title: L('compete'), links: [l('events', '/events'), l('rankings', '/rankings'), l('games', '/games'), l('news', '/news')] },
    { title: L('community'), links: [l('recruitment', '/recruitment'), l('organizers', '/organizers'), l('search', '/search')] },
    { title: L('trust'), links: [l('rules_packages', '/rules'), l('verify_an_honour', '/verify'), l('terms_privacy', '/legal/terms'), l('support', '/support')] },
  ];
});
// The site's real eNAMAD trust seal; QFooter opens it in a new tab with referrerpolicy="origin" as eNAMAD requires.
const ENAMAD = 'id=8145123&Code=Tttq6xJZHxyQ30jr3TKmUqPFCSXgVehq';
const seal = computed(() => ({ href: `https://trustseal.enamad.ir/?${ENAMAD}`, src: `https://trustseal.enamad.ir/logo.aspx?${ENAMAD}`, alt: L('enamad_trust_seal') }));

let stop: (() => void) | undefined;
onMounted(() => {
  stop = startRealtime();
  mq = globalThis.matchMedia?.('(max-width: 899px)');
  onWidth();
  mq?.addEventListener?.('change', onWidth);
});
onUnmounted(() => {
  stop?.();
  mq?.removeEventListener?.('change', onWidth);
});
</script>

<template>
  <div :class="['k-shell', panel ? 'k-shell--panel' : 'k-shell--public', { 'k-shell--login': route.name === 'login' }]">
    <a class="k-skip" href="#main" @click.prevent="main?.focus()">{{ L('skip_to_content') }}</a>
    <QTopBar
      v-if="panel"
      v-bind="panelBar" v-model:menu-open="menuOpen" variant="panel" menu-controls="side-nav"
      @settings="router.push('/account/settings')"
    />
    <QTopBar v-else v-bind="common" variant="public" :items="topItems" :active="route.meta.nav ?? ''" @settings="router.push('/account/settings')" />
    <div v-if="panel" class="k-panel">
      <QSideNav v-if="narrow" id="side-nav" v-model:open="menuOpen" mode="drawer" :sections="sections" :active="route.meta.side ?? ''" />
      <QSideNav v-else id="side-nav" :sections="sections" :active="route.meta.side ?? ''" />
      <main id="main" ref="main" class="k-main" tabindex="-1" :inert="menuOpen || undefined">
        <slot v-if="route.meta.redesigned" />
        <div v-else class="legacy-view k-container"><slot /></div>
      </main>
    </div>
    <template v-else>
      <main id="main" ref="main" class="k-main" tabindex="-1">
        <slot v-if="route.meta.redesigned" />
        <div v-else class="legacy-view k-container"><slot /></div>
      </main>
      <QFooter v-if="kind === 'public'" :title="L('esports_platform')" :subtitle="L('the_arena')" :description="L('tagline')" :groups="footerGroups" :seal="seal" />
    </template>
  </div>
</template>
