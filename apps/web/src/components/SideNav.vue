<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { t, type MessageKey } from '../i18n';
import { can, session } from '../session';

defineProps<{ open: boolean; collapsed: boolean }>();
const emit = defineEmits<{ close: [] }>();

interface Item {
  to: string;
  label: MessageKey;
  auth?: boolean;
  permission?: string;
}
interface Section {
  title: MessageKey;
  items: Item[];
}
const sections: Section[] = [
  {
    title: 'nav.section.public',
    items: [
      { to: '/', label: 'nav.home' },
      { to: '/events', label: 'nav.events' },
      { to: '/news', label: 'nav.news' },
      { to: '/rankings', label: 'nav.rankings' },
      { to: '/teams', label: 'nav.teams' },
      { to: '/organizers', label: 'nav.organizers' },
      { to: '/search', label: 'nav.search' },
    ],
  },
  {
    title: 'nav.section.account',
    items: [
      { to: '/account', label: 'nav.account', auth: true },
      { to: '/account/notifications', label: 'nav.notifications', auth: true },
      { to: '/account/settings', label: 'nav.settings' },
    ],
  },
  {
    title: 'nav.section.roles',
    items: [
      { to: '/team', label: 'nav.team', permission: 'team.read_private' },
      { to: '/organizer', label: 'nav.organizer', permission: 'event.manage' },
      { to: '/organizer/access', label: 'nav.organizerAccess', permission: 'acl.read' },
      { to: '/referee', label: 'nav.referee', permission: 'match.result.verify' },
      { to: '/newsroom', label: 'nav.newsroom', permission: 'news.draft' },
      { to: '/finance', label: 'nav.finance', permission: 'finance.read' },
      { to: '/finance/approvals', label: 'nav.approvals', permission: 'approval.read' },
      { to: '/admin', label: 'nav.admin', permission: 'platform.settings' },
      { to: '/admin/ops', label: 'nav.ops', permission: 'outbox.read' },
    ],
  },
];

// Client-side hint only: items the user's grants cannot use are hidden; the server enforces access.
const visible = computed(() =>
  sections
    .map((s) => ({ ...s, items: s.items.filter((i) => (i.auth ? !!session.me : true) && (i.permission ? can(i.permission) : true)) }))
    .filter((s) => s.items.length > 0),
);
</script>

<template>
  <div v-if="open" class="backdrop" @click="emit('close')" />
  <nav id="side-nav" class="sidenav" :class="{ open, collapsed }" :aria-label="t('app.mainNav')" @keydown.esc="emit('close')">
    <section v-for="s in visible" :key="s.title">
      <h2 class="sec">{{ t(s.title) }}</h2>
      <ul>
        <li v-for="i in s.items" :key="i.to">
          <RouterLink :to="i.to" @click="emit('close')">{{ t(i.label) }}</RouterLink>
        </li>
      </ul>
    </section>
  </nav>
</template>

<style scoped>
.sidenav { inline-size: var(--sidebar-w); flex: none; padding: var(--sp-4); background: var(--surface); border-inline-end: 1px solid var(--border); overflow-y: auto; position: sticky; top: var(--topbar-h); align-self: flex-start; block-size: calc(100vh - var(--topbar-h)); }
.sidenav.collapsed { display: none; }
.sec { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin: var(--sp-4) 0 var(--sp-2); }
ul { list-style: none; margin: 0; padding: 0; }
a { display: block; padding: var(--sp-1) var(--sp-3); border-radius: var(--radius-sm); color: var(--text); text-decoration: none; border-inline-start: 3px solid transparent; }
a:hover { background: var(--surface-2); }
a.router-link-exact-active, a.router-link-active:not([href='/']) { background: var(--accent-soft); color: var(--accent-strong); font-weight: 700; border-inline-start-color: var(--accent); }
.backdrop { display: none; }
@media (max-width: 900px) {
  .sidenav, .sidenav.collapsed { display: block; position: fixed; z-index: 50; top: 0; inset-inline-start: 0; block-size: 100vh; transform: translateX(-105%); transition: transform 0.2s; box-shadow: var(--shadow); }
  :global([dir='rtl']) .sidenav { transform: translateX(105%); }
  .sidenav.open, :global([dir='rtl']) .sidenav.open { transform: none; }
  .backdrop { display: block; position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / 45%); }
}
</style>
