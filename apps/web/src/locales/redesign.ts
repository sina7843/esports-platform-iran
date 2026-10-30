/** QeSB redesign copy: one module per page under ./redesign/ (keys from the page specs). */
import * as pShell from './redesign/shell';
import * as pHome from './redesign/home';
import * as pEvents from './redesign/events';
import * as pEvent from './redesign/event';
import * as pStage from './redesign/stage';
import * as pMatch from './redesign/match';
import * as pLive from './redesign/live';
import * as pNews from './redesign/news';
import * as pArticle from './redesign/article';
import * as pRankings from './redesign/rankings';
import * as pFormula from './redesign/formula';
import * as pVerify from './redesign/verify';
import * as pTeam from './redesign/team';
import * as pPlayer from './redesign/player';
import * as pRecruitment from './redesign/recruitment';
import * as pOrganizers from './redesign/organizers';
import * as pOrganizerPage from './redesign/organizer-page';
import * as pGames from './redesign/games';
import * as pGame from './redesign/game';
import * as pRules from './redesign/rules';
import * as pRulesPackage from './redesign/rules-package';
import * as pSearch from './redesign/search';
import * as pLegal from './redesign/legal';
import * as pLogin from './redesign/login';
import * as pHall from './redesign/hall';
import * as pOverlay from './redesign/overlay';
import * as pAccount from './redesign/account';
import * as pProfile from './redesign/profile';
import * as pSecurity from './redesign/security';
import * as pNotifications from './redesign/notifications';
import * as pRegistrations from './redesign/registrations';
import * as pCertificates from './redesign/certificates';
import * as pCalendar from './redesign/calendar';
import * as pMyQr from './redesign/my-qr';
import * as pPaymentReturn from './redesign/payment-return';
import * as pSettings from './redesign/settings';
import * as pPrivacy from './redesign/privacy';
import * as pMyTeams from './redesign/my-teams';
import * as pMessages from './redesign/messages';
import * as pSupport from './redesign/support';
import * as pTeamPanel from './redesign/team-panel';
import * as pOrganizer from './redesign/organizer';
import * as pOrganizerEvent from './redesign/organizer-event';
import * as pOperations from './redesign/operations';
import * as pResultsAdmin from './redesign/results-admin';
import * as pBroadcastAdmin from './redesign/broadcast-admin';
import * as pLanOps from './redesign/lan-ops';
import * as pEventOps from './redesign/event-ops';
import * as pOrganizerAccess from './redesign/organizer-access';
import * as pReferee from './redesign/referee';
import * as pCase from './redesign/case';
import * as pAdminRatings from './redesign/admin-ratings';
import * as pNewsroom from './redesign/newsroom';
import * as pFinance from './redesign/finance';
import * as pFinanceApprovals from './redesign/finance-approvals';
import * as pAdmin from './redesign/admin';
import * as pAdminReviews from './redesign/admin-reviews';
import * as pAdminOps from './redesign/admin-ops';
import * as pAdminUsers from './redesign/admin-users';
import * as pAdminTasks from './redesign/admin-tasks';
import * as pAdminTickets from './redesign/admin-tickets';
import * as pAdminSettings from './redesign/admin-settings';
import * as pAdminPrivacy from './redesign/admin-privacy';
import * as pAdminIntegrations from './redesign/admin-integrations';
import * as pAdminReports from './redesign/admin-reports';
import * as pForbidden from './redesign/forbidden';
import * as pOffline from './redesign/offline';
import * as pNotFound from './redesign/not-found';

export const faRedesign = {
  ...pShell.fa,
  ...pHome.fa,
  ...pEvents.fa,
  ...pEvent.fa,
  ...pStage.fa,
  ...pMatch.fa,
  ...pLive.fa,
  ...pNews.fa,
  ...pArticle.fa,
  ...pRankings.fa,
  ...pFormula.fa,
  ...pVerify.fa,
  ...pTeam.fa,
  ...pPlayer.fa,
  ...pRecruitment.fa,
  ...pOrganizers.fa,
  ...pOrganizerPage.fa,
  ...pGames.fa,
  ...pGame.fa,
  ...pRules.fa,
  ...pRulesPackage.fa,
  ...pSearch.fa,
  ...pLegal.fa,
  ...pLogin.fa,
  ...pHall.fa,
  ...pOverlay.fa,
  ...pAccount.fa,
  ...pProfile.fa,
  ...pSecurity.fa,
  ...pNotifications.fa,
  ...pRegistrations.fa,
  ...pCertificates.fa,
  ...pCalendar.fa,
  ...pMyQr.fa,
  ...pPaymentReturn.fa,
  ...pSettings.fa,
  ...pPrivacy.fa,
  ...pMyTeams.fa,
  ...pMessages.fa,
  ...pSupport.fa,
  ...pTeamPanel.fa,
  ...pOrganizer.fa,
  ...pOrganizerEvent.fa,
  ...pOperations.fa,
  ...pResultsAdmin.fa,
  ...pBroadcastAdmin.fa,
  ...pLanOps.fa,
  ...pEventOps.fa,
  ...pOrganizerAccess.fa,
  ...pReferee.fa,
  ...pCase.fa,
  ...pAdminRatings.fa,
  ...pNewsroom.fa,
  ...pFinance.fa,
  ...pFinanceApprovals.fa,
  ...pAdmin.fa,
  ...pAdminReviews.fa,
  ...pAdminOps.fa,
  ...pAdminUsers.fa,
  ...pAdminTasks.fa,
  ...pAdminTickets.fa,
  ...pAdminSettings.fa,
  ...pAdminPrivacy.fa,
  ...pAdminIntegrations.fa,
  ...pAdminReports.fa,
  ...pForbidden.fa,
  ...pOffline.fa,
  ...pNotFound.fa,
};

export const enRedesign: Record<keyof typeof faRedesign, string> = {
  ...pShell.en,
  ...pHome.en,
  ...pEvents.en,
  ...pEvent.en,
  ...pStage.en,
  ...pMatch.en,
  ...pLive.en,
  ...pNews.en,
  ...pArticle.en,
  ...pRankings.en,
  ...pFormula.en,
  ...pVerify.en,
  ...pTeam.en,
  ...pPlayer.en,
  ...pRecruitment.en,
  ...pOrganizers.en,
  ...pOrganizerPage.en,
  ...pGames.en,
  ...pGame.en,
  ...pRules.en,
  ...pRulesPackage.en,
  ...pSearch.en,
  ...pLegal.en,
  ...pLogin.en,
  ...pHall.en,
  ...pOverlay.en,
  ...pAccount.en,
  ...pProfile.en,
  ...pSecurity.en,
  ...pNotifications.en,
  ...pRegistrations.en,
  ...pCertificates.en,
  ...pCalendar.en,
  ...pMyQr.en,
  ...pPaymentReturn.en,
  ...pSettings.en,
  ...pPrivacy.en,
  ...pMyTeams.en,
  ...pMessages.en,
  ...pSupport.en,
  ...pTeamPanel.en,
  ...pOrganizer.en,
  ...pOrganizerEvent.en,
  ...pOperations.en,
  ...pResultsAdmin.en,
  ...pBroadcastAdmin.en,
  ...pLanOps.en,
  ...pEventOps.en,
  ...pOrganizerAccess.en,
  ...pReferee.en,
  ...pCase.en,
  ...pAdminRatings.en,
  ...pNewsroom.en,
  ...pFinance.en,
  ...pFinanceApprovals.en,
  ...pAdmin.en,
  ...pAdminReviews.en,
  ...pAdminOps.en,
  ...pAdminUsers.en,
  ...pAdminTasks.en,
  ...pAdminTickets.en,
  ...pAdminSettings.en,
  ...pAdminPrivacy.en,
  ...pAdminIntegrations.en,
  ...pAdminReports.en,
  ...pForbidden.en,
  ...pOffline.en,
  ...pNotFound.en,
};
