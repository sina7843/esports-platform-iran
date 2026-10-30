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
    /** QeSB kit shell (docs/redesign/02-prototypes/kit/kit.js ROUTES): public, panel (side nav), auth (no footer), bare (displays) */
    layout?: 'public' | 'panel' | 'auth' | 'bare';
    /** active TopBar item key (public shell) */
    nav?: string;
    /** active SideNav item key (panel shell) */
    side?: string;
    /** the view is rebuilt on the QeSB design system (no legacy-view wrapper) */
    redesigned?: boolean;
  }
}

const Shell = () => import('./views/ShellPage.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: 'nav.home', layout: 'public', nav: 'home', redesigned: true } },
  { path: '/events', name: 'events', component: () => import('./views/EventsView.vue'), meta: { title: 'nav.events', layout: 'public', nav: 'events', redesigned: true } },
  { path: '/events/:id', name: 'event', component: () => import('./views/EventDetailView.vue'), meta: { title: 'nav.events', layout: 'public', nav: 'events', redesigned: true } },
  { path: '/matches/:id', name: 'match', component: () => import('./views/MatchRoomView.vue'), meta: { title: 'match.title', layout: 'public', nav: 'events' } },
  { path: '/stages/:id', name: 'stage', component: () => import('./views/StageView.vue'), meta: { title: 'stg.title', layout: 'public', nav: 'events', redesigned: true } },
  { path: '/events/:id/hall', name: 'hall', component: () => import('./views/HallDisplayView.vue'), meta: { title: 'hall.title', layout: 'bare', redesigned: true } },
  { path: '/news', name: 'news', component: () => import('./views/NewsView.vue'), meta: { title: 'nav.news', layout: 'public', nav: 'news', redesigned: true } },
  { path: '/news/:slug', name: 'article', component: () => import('./views/ArticleView.vue'), meta: { title: 'nav.news', layout: 'public', nav: 'news', redesigned: true } },
  { path: '/events/:id/live', name: 'live', component: () => import('./views/LiveCenterView.vue'), meta: { title: 'live.title', layout: 'public', nav: 'events', redesigned: true } },
  { path: '/overlay/:token', name: 'overlay', component: () => import('./views/OverlayView.vue'), meta: { title: 'ovl.title', layout: 'bare', redesigned: true } },
  { path: '/rankings', name: 'rankings', component: () => import('./views/RankingsView.vue'), meta: { title: 'nav.rankings', layout: 'public', nav: 'rankings', redesigned: true } },
  { path: '/rankings/formula', name: 'rankings-formula', component: () => import('./views/FormulaView.vue'), meta: { title: 'formula.title', layout: 'public', nav: 'rankings', redesigned: true } },
  { path: '/verify/:code?', name: 'verify', component: () => import('./views/VerifyView.vue'), meta: { title: 'ver.title', layout: 'public', redesigned: true } },
  { path: '/teams', name: 'teams', component: () => import('./views/TeamsView.vue'), meta: { requiresAuth: true, title: 'nav.myTeams', layout: 'panel', side: 'my-teams', redesigned: true } },
  { path: '/teams/:id', name: 'team-page', component: () => import('./views/TeamView.vue'), meta: { title: 'nav.teams', layout: 'public', nav: 'recruitment', redesigned: true } },
  { path: '/players/:nickname', name: 'player', component: () => import('./views/PlayerView.vue'), meta: { title: 'player.title', layout: 'public', redesigned: true } },
  { path: '/recruitment', name: 'recruitment', component: () => import('./views/RecruitmentView.vue'), meta: { title: 'nav.recruitment', layout: 'public', nav: 'recruitment', redesigned: true } },
  { path: '/organizers', name: 'organizers', component: () => import('./views/OrganizersView.vue'), meta: { title: 'nav.organizers', layout: 'public', nav: 'organizers', redesigned: true } },
  { path: '/organizers/:slug', name: 'organizer-page', component: () => import('./views/OrganizerView.vue'), meta: { title: 'nav.organizers', layout: 'public', nav: 'organizers', redesigned: true } },
  { path: '/games', name: 'games', component: () => import('./views/GamesView.vue'), meta: { title: 'nav.games', layout: 'public', nav: 'games', redesigned: true } },
  { path: '/games/:id', name: 'game', component: () => import('./views/GameView.vue'), meta: { title: 'nav.games', layout: 'public', nav: 'games', redesigned: true } },
  { path: '/rules', name: 'rules', component: () => import('./views/RulesView.vue'), meta: { title: 'nav.rules', layout: 'public', redesigned: true } },
  { path: '/rules/:id', name: 'rules-package', component: () => import('./views/RulesPackageView.vue'), meta: { title: 'nav.rules', layout: 'public', redesigned: true } },
  { path: '/search', name: 'search', component: () => import('./views/SearchView.vue'), meta: { title: 'nav.search', layout: 'public', redesigned: true } },
  { path: '/messages', name: 'messages', component: () => import('./views/MessagesView.vue'), meta: { requiresAuth: true, title: 'msg.title', layout: 'panel', side: 'messages', redesigned: true } },
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { title: 'nav.login', layout: 'auth', redesigned: true } },
  { path: '/403', name: 'forbidden', component: () => import('./views/ForbiddenView.vue'), meta: { title: 'forbidden.title', layout: 'public', redesigned: true } },
  { path: '/offline', name: 'offline', component: () => import('./views/OfflineView.vue'), meta: { title: 'offline.title', layout: 'public', redesigned: true } },

  { path: '/account', name: 'account', component: () => import('./views/AccountView.vue'), meta: { requiresAuth: true, title: 'nav.account', layout: 'panel', side: 'account', redesigned: true } },
  { path: '/account/profile', name: 'profile', component: () => import('./views/ProfileView.vue'), meta: { requiresAuth: true, title: 'nav.profile', layout: 'panel', side: 'profile', redesigned: true } },
  { path: '/account/security', name: 'security', component: () => import('./views/SecurityView.vue'), meta: { requiresAuth: true, title: 'nav.security', layout: 'panel', side: 'security', redesigned: true } },
  { path: '/account/notifications', name: 'notifications', component: () => import('./views/NotificationsView.vue'), meta: { requiresAuth: true, title: 'nav.notifications', layout: 'panel', side: 'notifications', redesigned: true } },
  { path: '/account/registrations', name: 'my-registrations', component: () => import('./views/MyRegistrationsView.vue'), meta: { requiresAuth: true, title: 'reg.mine', layout: 'panel', side: 'registrations', redesigned: true } },
  { path: '/account/certificates', name: 'my-certificates', component: () => import('./views/CertificatesView.vue'), meta: { requiresAuth: true, title: 'cert.title', layout: 'panel', side: 'certificates', redesigned: true } },
  { path: '/account/calendar', name: 'my-calendar', component: () => import('./views/MyCalendarView.vue'), meta: { requiresAuth: true, title: 'cal.title', layout: 'panel', side: 'calendar', redesigned: true } },
  { path: '/events/:id/my-qr', name: 'my-qr', component: () => import('./views/MyQrView.vue'), meta: { requiresAuth: true, title: 'qr.title', layout: 'panel', side: 'registrations', redesigned: true } },
  { path: '/payments/return', name: 'payment-return', component: () => import('./views/PaymentReturnView.vue'), meta: { requiresAuth: true, title: 'pay.title', layout: 'panel', side: 'registrations', redesigned: true } },
  { path: '/account/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: 'nav.settings', layout: 'panel', side: 'settings', redesigned: true } },

  { path: '/team', name: 'team', component: Shell, meta: { requiresAuth: true, permission: 'team.read_private', title: 'nav.team', shell: true, layout: 'panel', side: 'team-panel' } },
  { path: '/organizer', name: 'organizer', component: () => import('./views/OrganizerEventsView.vue'), meta: { requiresAuth: true, permission: 'event.manage', title: 'nav.organizer', layout: 'panel', side: 'organizer', redesigned: true } },
  { path: '/organizer/events/:id', name: 'organizer-event', component: () => import('./views/OrganizerEventView.vue'), meta: { requiresAuth: true, permission: 'event.read_private', title: 'nav.organizer', layout: 'panel', side: 'organizer' } },
  { path: '/organizer/events/:id/operations', name: 'operations', component: () => import('./views/OperationsView.vue'), meta: { requiresAuth: true, permission: 'event.read_private', title: 'cops.title', layout: 'panel', side: 'organizer' } },
  { path: '/organizer/events/:id/results', name: 'results-admin', component: () => import('./views/ResultsAdminView.vue'), meta: { requiresAuth: true, permission: 'event.read_private', title: 'res.title', layout: 'panel', side: 'organizer' } },
  { path: '/organizer/events/:id/broadcast', name: 'broadcast-admin', component: () => import('./views/BroadcastAdminView.vue'), meta: { requiresAuth: true, permission: 'event.read_private', title: 'bc.title', layout: 'panel', side: 'organizer', redesigned: true } },
  { path: '/organizer/events/:id/lan', name: 'lan-ops', component: () => import('./views/LanOpsView.vue'), meta: { requiresAuth: true, permission: 'event.read_private', title: 'lan.title', layout: 'panel', side: 'organizer' } },
  { path: '/organizer/access', name: 'organizer-access', component: () => import('./views/OrganizerAccessView.vue'), meta: { requiresAuth: true, permission: 'acl.read', title: 'nav.organizerAccess', layout: 'panel', side: 'organizer-access' } },
  { path: '/referee', name: 'referee', component: () => import('./views/RefereeView.vue'), meta: { requiresAuth: true, title: 'nav.referee', layout: 'panel', side: 'referee', redesigned: true } },
  { path: '/cases/:id', name: 'case', component: () => import('./views/CaseView.vue'), meta: { requiresAuth: true, title: 'case.title', layout: 'panel', side: 'referee', redesigned: true } },
  { path: '/admin/ratings', name: 'admin-ratings', component: () => import('./views/AdminRatingsView.vue'), meta: { requiresAuth: true, permission: 'ranking.manage', title: 'rsys.title', layout: 'panel', side: 'admin-ratings', redesigned: true } },
  { path: '/newsroom', name: 'newsroom', component: () => import('./views/NewsroomView.vue'), meta: { requiresAuth: true, permission: 'news.draft', title: 'nav.newsroom', layout: 'panel', side: 'newsroom' } },
  { path: '/finance', name: 'finance', component: () => import('./views/FinanceView.vue'), meta: { requiresAuth: true, permission: 'finance.read', title: 'nav.finance', layout: 'panel', side: 'finance' } },
  { path: '/finance/approvals', name: 'finance-approvals', component: () => import('./views/FinanceApprovalsView.vue'), meta: { requiresAuth: true, permission: 'approval.read', title: 'nav.approvals', layout: 'panel', side: 'finance-approvals', redesigned: true } },
  { path: '/admin', name: 'admin', component: Shell, meta: { requiresAuth: true, permission: 'platform.settings', title: 'nav.admin', shell: true, layout: 'panel', side: 'admin' } },
  { path: '/admin/reviews', name: 'admin-reviews', component: () => import('./views/AdminReviewsView.vue'), meta: { requiresAuth: true, permission: 'account.review', title: 'nav.accountReviews', layout: 'panel', side: 'admin-reviews' } },
  { path: '/admin/ops', name: 'admin-ops', component: () => import('./views/AdminOpsView.vue'), meta: { requiresAuth: true, permission: 'outbox.read', title: 'nav.ops', layout: 'panel', side: 'admin-ops', redesigned: true } },

  { path: '/support', name: 'support', component: () => import('./views/SupportView.vue'), meta: { requiresAuth: true, title: 'a7.nav.support', layout: 'panel', side: 'support', redesigned: true } },
  { path: '/account/privacy', name: 'my-privacy', component: () => import('./views/PrivacyView.vue'), meta: { requiresAuth: true, title: 'a7.nav.myPrivacy', layout: 'panel', side: 'privacy', redesigned: true } },
  { path: '/legal/:kind', name: 'legal', component: () => import('./views/LegalView.vue'), meta: { title: 'a7.nav.myPrivacy', layout: 'public', redesigned: true } },
  { path: '/organizer/events/:id/ops', name: 'event-ops', component: () => import('./views/EventOpsView.vue'), meta: { requiresAuth: true, permission: 'event.read_private', title: 'a7.nav.eventOps', layout: 'panel', side: 'organizer', redesigned: true } },
  { path: '/admin/users', name: 'admin-users', component: () => import('./views/AdminUsersView.vue'), meta: { requiresAuth: true, permission: 'admin.users', title: 'a7.nav.users', layout: 'panel', side: 'admin-users', redesigned: true } },
  { path: '/admin/tasks', name: 'admin-tasks', component: () => import('./views/AdminTasksView.vue'), meta: { requiresAuth: true, permission: 'admin.tasks', title: 'a7.nav.tasks', layout: 'panel', side: 'admin-tasks', redesigned: true } },
  { path: '/admin/tickets', name: 'admin-tickets', component: () => import('./views/AdminTicketsView.vue'), meta: { requiresAuth: true, permission: 'support.tickets', title: 'a7.nav.tickets', layout: 'panel', side: 'admin-tickets', redesigned: true } },
  { path: '/admin/settings', name: 'admin-settings', component: () => import('./views/AdminSettingsView.vue'), meta: { requiresAuth: true, permission: 'platform.settings', title: 'a7.nav.settings', layout: 'panel', side: 'admin-settings', redesigned: true } },
  { path: '/admin/privacy', name: 'admin-privacy', component: () => import('./views/AdminPrivacyView.vue'), meta: { requiresAuth: true, permission: 'privacy.manage', title: 'a7.nav.privacy', layout: 'panel', side: 'admin-privacy', redesigned: true } },
  { path: '/admin/integrations', name: 'admin-integrations', component: () => import('./views/AdminIntegrationsView.vue'), meta: { requiresAuth: true, permission: 'providers.manage', title: 'a7.nav.integrations', layout: 'panel', side: 'admin-integrations', redesigned: true } },
  { path: '/admin/reports', name: 'admin-reports', component: () => import('./views/AdminReportsView.vue'), meta: { requiresAuth: true, permission: 'admin.reports', title: 'a7.nav.reports', layout: 'panel', side: 'admin-reports', redesigned: true } },

  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./views/NotFoundView.vue'), meta: { title: 'nav.notFound', layout: 'public', redesigned: true } },
];

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({ history, routes });

  router.beforeEach(async (to) => {
    const protectedRoute = to.meta.requiresAuth || to.meta.permission;
    try {
      await ensureMe();
    } catch {
      // /auth/me unreachable: protected pages cannot be decided, public pages still render
      if (protectedRoute && to.name !== 'offline') return { name: 'offline', query: { from: to.fullPath } };
      return true;
    }
    if (!protectedRoute) return true;
    if (!session.me) return { name: 'login', query: { redirect: to.fullPath } };
    if (to.meta.permission && !can(to.meta.permission)) return { name: 'forbidden', query: { from: to.fullPath } };
    return true;
  });

  return router;
}
