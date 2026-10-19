import { createRouter, createWebHistory, type RouterHistory, type RouteRecordRaw } from 'vue-router';
import type { MessageKey } from './i18n';
import { can, ensureMe, session } from './session';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    permission?: string;
    /** i18n key of the page title, used by breadcrumb and placeholder pages */
    title?: MessageKey;
    /** placeholder shell page: honest "later stage" empty state */
    shell?: boolean;
  }
}

const Shell = () => import('./views/ShellPage.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: 'nav.home' } },
  { path: '/events', name: 'events', component: () => import('./views/EventsView.vue'), meta: { title: 'nav.events' } },
  { path: '/events/:id', name: 'event', component: () => import('./views/EventDetailView.vue'), meta: { title: 'nav.events' } },
  { path: '/matches/:id', name: 'match', component: () => import('./views/MatchView.vue'), meta: { title: 'match.title' } },
  { path: '/news', name: 'news', component: Shell, meta: { title: 'nav.news', shell: true } },
  { path: '/rankings', name: 'rankings', component: Shell, meta: { title: 'nav.rankings', shell: true } },
  { path: '/teams', name: 'teams', component: () => import('./views/TeamsView.vue'), meta: { requiresAuth: true, title: 'nav.myTeams' } },
  { path: '/teams/:id', name: 'team-page', component: () => import('./views/TeamView.vue'), meta: { title: 'nav.teams' } },
  { path: '/players/:nickname', name: 'player', component: () => import('./views/PlayerView.vue'), meta: { title: 'player.title' } },
  { path: '/recruitment', name: 'recruitment', component: () => import('./views/RecruitmentView.vue'), meta: { title: 'nav.recruitment' } },
  { path: '/organizers', name: 'organizers', component: () => import('./views/OrganizersView.vue'), meta: { title: 'nav.organizers' } },
  { path: '/organizers/:slug', name: 'organizer-page', component: () => import('./views/OrganizerView.vue'), meta: { title: 'nav.organizers' } },
  { path: '/games', name: 'games', component: () => import('./views/GamesView.vue'), meta: { title: 'nav.games' } },
  { path: '/games/:id', name: 'game', component: () => import('./views/GameView.vue'), meta: { title: 'nav.games' } },
  { path: '/rules', name: 'rules', component: () => import('./views/RulesView.vue'), meta: { title: 'nav.rules' } },
  { path: '/rules/:id', name: 'rules-package', component: () => import('./views/RulesPackageView.vue'), meta: { title: 'nav.rules' } },
  { path: '/search', name: 'search', component: Shell, meta: { title: 'nav.search', shell: true } },
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { title: 'nav.login' } },
  { path: '/403', name: 'forbidden', component: () => import('./views/ForbiddenView.vue'), meta: { title: 'forbidden.title' } },
  { path: '/offline', name: 'offline', component: () => import('./views/OfflineView.vue'), meta: { title: 'offline.title' } },

  { path: '/account', name: 'account', component: () => import('./views/AccountView.vue'), meta: { requiresAuth: true, title: 'nav.account' } },
  { path: '/account/profile', name: 'profile', component: () => import('./views/ProfileView.vue'), meta: { requiresAuth: true, title: 'nav.profile' } },
  { path: '/account/security', name: 'security', component: () => import('./views/SecurityView.vue'), meta: { requiresAuth: true, title: 'nav.security' } },
  { path: '/account/notifications', name: 'notifications', component: Shell, meta: { requiresAuth: true, title: 'nav.notifications', shell: true } },
  { path: '/account/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: 'nav.settings' } },

  { path: '/team', name: 'team', component: Shell, meta: { requiresAuth: true, permission: 'team.read_private', title: 'nav.team', shell: true } },
  { path: '/organizer', name: 'organizer', component: Shell, meta: { requiresAuth: true, permission: 'event.manage', title: 'nav.organizer', shell: true } },
  { path: '/organizer/access', name: 'organizer-access', component: () => import('./views/OrganizerAccessView.vue'), meta: { requiresAuth: true, permission: 'acl.read', title: 'nav.organizerAccess' } },
  { path: '/referee', name: 'referee', component: Shell, meta: { requiresAuth: true, permission: 'match.result.verify', title: 'nav.referee', shell: true } },
  { path: '/newsroom', name: 'newsroom', component: Shell, meta: { requiresAuth: true, permission: 'news.draft', title: 'nav.newsroom', shell: true } },
  { path: '/finance', name: 'finance', component: Shell, meta: { requiresAuth: true, permission: 'finance.read', title: 'nav.finance', shell: true } },
  { path: '/finance/approvals', name: 'finance-approvals', component: () => import('./views/FinanceApprovalsView.vue'), meta: { requiresAuth: true, permission: 'approval.read', title: 'nav.approvals' } },
  { path: '/admin', name: 'admin', component: Shell, meta: { requiresAuth: true, permission: 'platform.settings', title: 'nav.admin', shell: true } },
  { path: '/admin/reviews', name: 'admin-reviews', component: () => import('./views/AdminReviewsView.vue'), meta: { requiresAuth: true, permission: 'account.review', title: 'nav.accountReviews' } },
  { path: '/admin/ops', name: 'admin-ops', component: () => import('./views/AdminOpsView.vue'), meta: { requiresAuth: true, permission: 'outbox.read', title: 'nav.ops' } },

  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./views/NotFoundView.vue'), meta: { title: 'nav.notFound' } },
];

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({ history, routes });

  router.beforeEach(async (to) => {
    const protectedRoute = to.meta.requiresAuth || to.meta.permission;
    try {
      await ensureMe();
    } catch {
      // /auth/me unreachable: protected pages cannot be decided, public pages still render
      if (protectedRoute && to.name !== 'offline') return { name: 'offline' };
      return true;
    }
    if (!protectedRoute) return true;
    if (!session.me) return { name: 'login', query: { redirect: to.fullPath } };
    if (to.meta.permission && !can(to.meta.permission)) return { name: 'forbidden' };
    return true;
  });

  return router;
}
