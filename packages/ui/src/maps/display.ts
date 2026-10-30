import { tr } from '../locale';
import type { IconName } from '../icons';

/* Section-local tables and helpers of bundle.js 02-display (StatusBadge machines, Alert/Toast tone icons, Avatar sizes, EmptyState texts). */

export type StatusBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live';
export type StatusBadgeMachine =
  | 'event' | 'registration' | 'match' | 'dispute' | 'payment' | 'prize' | 'news'
  | 'approval' | 'fileScan' | 'game' | 'gameReadiness' | 'capability' | 'gameIdentity' | 'accountReview'
  | 'organizerApplication' | 'rulesPackage' | 'invitation' | 'ownershipTransfer' | 'recruitmentAd'
  | 'teamApplication' | 'scrim' | 'outbox' | 'serviceHealth'
  | 'reschedule' | 'equipment' | 'ticket';
export interface StatusBadgeEntry { readonly label: string; fa: string; en: string; tone: StatusBadgeTone }
export interface StatusBadgeMachineInfo { readonly label: string; fa: string; en: string; source: 'contracts' | 'web' | 'ds' }

type Row = [string, string, 'contracts' | 'web' | 'ds', Record<string, [string, string, StatusBadgeTone]>];
// machine → [fa entity name, en entity name, label source, { state: [fa label, en label, tone] }] — copied from bundle.js.
const M: Record<StatusBadgeMachine, Row> = {
    event: ['رویداد', 'Event', 'contracts', {
      draft: ['پیش‌نویس', 'Draft', 'neutral'], in_review: ['در بررسی', 'In review', 'warning'], published: ['منتشرشده', 'Published', 'success'],
      registration_open: ['ثبت‌نام باز', 'Registration open', 'success'], registration_closed: ['ثبت‌نام بسته', 'Registration closed', 'info'], preparing: ['آماده‌سازی', 'Preparing', 'warning'],
      active: ['فعال', 'Active', 'live'], paused: ['متوقف', 'Paused', 'warning'], finished: ['پایان‌یافته', 'Finished', 'success'], closed: ['بسته‌شده', 'Closed', 'neutral'],
      cancelled: ['لغوشده', 'Cancelled', 'danger'], archived: ['آرشیوی', 'Archived', 'neutral'] }],
    registration: ['ثبت‌نام', 'Registration', 'contracts', {
      draft: ['پیش‌نویس', 'Draft', 'neutral'], incomplete: ['ناقص', 'Incomplete', 'warning'], awaiting_payment: ['انتظار پرداخت', 'Awaiting payment', 'warning'],
      awaiting_review: ['انتظار بررسی', 'Awaiting review', 'warning'], awaiting_capacity: ['انتظار ظرفیت', 'Awaiting capacity', 'warning'], confirmed: ['تأیید', 'Confirmed', 'success'],
      rejected: ['رد', 'Rejected', 'danger'], withdrawn: ['انصراف', 'Withdrawn', 'danger'], removed: ['حذف', 'Removed', 'danger'] }],
    match: ['رویارویی', 'Match', 'contracts', {
      awaiting_sides: ['انتظار طرفین', 'Awaiting sides', 'warning'], scheduled: ['برنامه‌ریزی‌شده', 'Scheduled', 'info'], awaiting_readiness: ['انتظار آمادگی', 'Awaiting readiness', 'warning'],
      ready: ['آماده', 'Ready', 'success'], pre_game_selection: ['انتخاب‌های پیش از بازی', 'Pre-game selection', 'warning'], live: ['زنده', 'Live', 'live'],
      paused: ['متوقف', 'Paused', 'warning'], provisional: ['پایان موقت', 'Provisional', 'warning'], disputed: ['در اختلاف', 'Disputed', 'warning'],
      final: ['نهایی', 'Final', 'success'], cancelled: ['لغوشده', 'Cancelled', 'danger'] }],
    dispute: ['اعتراض', 'Dispute', 'contracts', {
      filed: ['ثبت‌شده', 'Filed', 'warning'], assigned: ['ارجاع‌شده', 'Assigned', 'warning'], defense_received: ['دریافت دفاع', 'Defence received', 'warning'],
      under_review: ['بررسی', 'Under review', 'warning'], first_decision: ['رأی نخست', 'First decision', 'info'], appeal: ['تجدیدنظر', 'Appeal', 'warning'], closed: ['مختومه', 'Closed', 'neutral'] }],
    payment: ['پرداخت', 'Payment', 'contracts', {
      created: ['ایجادشده', 'Created', 'neutral'], awaiting_gateway: ['انتظار درگاه', 'Awaiting gateway', 'warning'], verified: ['موفق تأییدشده', 'Verified', 'success'],
      failed: ['ناموفق', 'Failed', 'danger'], unknown: ['نامشخص', 'Unknown', 'warning'], awaiting_refund: ['انتظار بازپرداخت', 'Awaiting refund', 'warning'],
      refunded_partial: ['بازپرداخت جزئی', 'Partially refunded', 'info'], refunded_full: ['بازپرداخت کامل', 'Fully refunded', 'info'] }],
    prize: ['جایزه', 'Prize', 'contracts', {
      defined: ['تعریف‌شده', 'Defined', 'info'], recipient_verified: ['احراز گیرنده', 'Recipient verified', 'info'], ready_to_pay: ['آماده پرداخت', 'Ready to pay', 'success'],
      paying: ['پرداخت در جریان', 'Paying', 'warning'], paid: ['پرداخت‌شده', 'Paid', 'success'], disputed: ['مورد اختلاف', 'Disputed', 'warning'], cancelled: ['لغوشده', 'Cancelled', 'danger'] }],
    news: ['خبر', 'News', 'contracts', {
      draft: ['پیش‌نویس', 'Draft', 'neutral'], in_review: ['در بررسی', 'In review', 'warning'], scheduled: ['زمان‌بندی‌شده', 'Scheduled', 'info'], published: ['منتشرشده', 'Published', 'success'],
      corrected: ['اصلاح‌شده', 'Corrected', 'info'], retracted: ['پس‌گرفته‌شده', 'Retracted', 'danger'], archived: ['آرشیوی', 'Archived', 'neutral'] }],
    approval: ['تأیید دوم', 'Second approval', 'web', {
      pending: ['در انتظار', 'Pending', 'warning'], approved: ['تأییدشده', 'Approved', 'success'], rejected: ['ردشده', 'Rejected', 'danger'], expired: ['منقضی', 'Expired', 'danger'], executed: ['اجراشده', 'Executed', 'success'] }],
    fileScan: ['اسکن فایل', 'File scan', 'ds', {
      pending: ['در صف اسکن', 'Queued for scan', 'warning'], clean: ['سالم', 'Clean', 'success'], infected: ['آلوده', 'Infected', 'danger'], failed: ['ناموفق', 'Failed', 'danger'], skipped_dev: ['اسکن‌نشده (توسعه)', 'Not scanned (dev)', 'neutral'] }],
    game: ['بازی', 'Game', 'web', {
      proposed: ['پیشنهادی', 'Proposed', 'info'], under_review: ['در حال بررسی', 'Under review', 'warning'], ready: ['آماده برگزاری', 'Ready', 'success'], suspended: ['موقتاً غیرفعال', 'Suspended', 'danger'], archived: ['آرشیوی', 'Archived', 'neutral'] }],
    gameReadiness: ['آمادگی بازی', 'Game readiness', 'ds', {
      not_ready: ['آماده نیست', 'Not ready', 'warning'], ready: ['آماده', 'Ready', 'success'], suspended: ['معلق', 'Suspended', 'danger'] }],
    capability: ['قابلیت بازی', 'Game capability', 'web', {
      supported: ['پشتیبانی می‌شود', 'Supported', 'success'], limited: ['محدود', 'Limited', 'warning'], unsupported: ['پشتیبانی نمی‌شود', 'Not supported', 'danger'], unknown: ['نامشخص', 'Unknown', 'neutral'] }],
    gameIdentity: ['شناسه بازی', 'Game id', 'ds', {
      unverified: ['تأییدنشده', 'Unverified', 'neutral'], pending: ['در انتظار تأیید', 'Awaiting verification', 'warning'], verified: ['تأییدشده', 'Verified', 'success'], rejected: ['ردشده', 'Rejected', 'danger'], disputed: ['مورد اختلاف', 'Disputed', 'warning'] }],
    accountReview: ['بررسی حساب', 'Account review', 'web', {
      open: ['باز', 'Open', 'warning'], resolved_distinct: ['حساب‌های مستقل', 'Distinct accounts', 'success'], resolved_merged_manually: ['ادغام دستی', 'Merged manually', 'success'], resolved_suspended: ['تعلیق', 'Suspended', 'danger'] }],
    organizerApplication: ['درخواست برگزارکنندگی', 'Organizer application', 'ds', {
      submitted: ['ارسال‌شده', 'Submitted', 'warning'], needs_info: ['نیازمند اطلاعات', 'Needs information', 'warning'], under_review: ['در حال بررسی', 'Under review', 'warning'], approved: ['تأییدشده', 'Approved', 'success'], rejected: ['ردشده', 'Rejected', 'danger'] }],
    rulesPackage: ['بسته قوانین', 'Rules package', 'ds', {
      draft: ['پیش‌نویس', 'Draft', 'neutral'], under_review: ['در حال بررسی', 'Under review', 'warning'], published: ['منتشرشده', 'Published', 'success'], superseded: ['جایگزین‌شده', 'Superseded', 'neutral'], withdrawn: ['پس‌گرفته‌شده', 'Withdrawn', 'danger'] }],
    invitation: ['دعوت به تیم', 'Team invitation', 'ds', {
      pending: ['در انتظار پاسخ', 'Awaiting reply', 'warning'], accepted: ['پذیرفته‌شده', 'Accepted', 'success'], declined: ['ردشده', 'Declined', 'danger'], cancelled: ['لغوشده', 'Cancelled', 'danger'], expired: ['منقضی', 'Expired', 'danger'] }],
    ownershipTransfer: ['انتقال مالکیت تیم', 'Team ownership transfer', 'ds', {
      pending: ['در انتظار پاسخ', 'Awaiting reply', 'warning'], accepted: ['پذیرفته‌شده', 'Accepted', 'success'], declined: ['ردشده', 'Declined', 'danger'], cancelled: ['لغوشده', 'Cancelled', 'danger'], expired: ['منقضی', 'Expired', 'danger'] }],
    recruitmentAd: ['آگهی جذب', 'Recruitment ad', 'ds', { open: ['باز', 'Open', 'success'], closed: ['بسته', 'Closed', 'neutral'] }],
    teamApplication: ['درخواست عضویت', 'Team application', 'ds', {
      applied: ['درخواست‌شده', 'Applied', 'warning'], tryout_invited: ['دعوت به تست', 'Invited to tryout', 'info'], under_review: ['در حال بررسی', 'Under review', 'warning'],
      accepted: ['پذیرفته‌شده', 'Accepted', 'success'], rejected: ['ردشده', 'Rejected', 'danger'], withdrawn: ['انصراف', 'Withdrawn', 'danger'] }],
    scrim: ['بازی تمرینی', 'Scrim', 'ds', {
      open: ['باز', 'Open', 'success'], proposed: ['پیشنهادشده', 'Proposed', 'warning'], accepted: ['پذیرفته‌شده', 'Accepted', 'success'], declined: ['ردشده', 'Declined', 'danger'], played: ['انجام‌شده', 'Played', 'success'], cancelled: ['لغوشده', 'Cancelled', 'danger'] }],
    outbox: ['صف ارسال', 'Event outbox', 'web', {
      pending: ['در صف', 'Queued', 'warning'], processing: ['در حال پردازش', 'Processing', 'warning'], done: ['انجام‌شده', 'Done', 'success'], dead_letter: ['صف مرده', 'Dead letter', 'danger'] }],
    serviceHealth: ['سلامت سرویس', 'Service health', 'web', {
      ok: ['سالم', 'Healthy', 'success'], degraded: ['مختل', 'Degraded', 'warning'], down: ['قطع', 'Down', 'danger'], unconfigured: ['پیکربندی‌نشده', 'Not configured', 'neutral'] }],
    /* v1.1 — machines the page builders mapped by hand (DS wording until the product has labels) */
    reschedule: ['درخواست تغییر زمان', 'Reschedule request', 'ds', {
      open: ['باز', 'Open', 'warning'], agreed: ['توافق‌شده', 'Agreed', 'info'], approved: ['تأییدشده', 'Approved', 'success'], rejected: ['ردشده', 'Rejected', 'danger'] }],
    equipment: ['تجهیزات شخصی', 'Personal equipment', 'ds', {
      declared: ['اعلام شد؛ در انتظار بازرسی', 'Declared; awaiting inspection', 'warning'], approved: ['تأییدشده', 'Approved', 'success'], rejected: ['ردشده', 'Rejected', 'danger'] }],
    ticket: ['کارت حضور', 'Entry ticket', 'ds', {
      valid: ['معتبر', 'Valid', 'success'], used: ['استفاده‌شده', 'Used', 'neutral'], void: ['باطل‌شده', 'Void', 'danger'] }]
};

function entry<X extends object>(fa: string, en: string, extra: X): X & { fa: string; en: string; readonly label: string } {
  const o = { fa, en, ...extra };
  Object.defineProperty(o, 'label', { enumerable: true, get: () => tr(fa, en) });
  return o as X & { fa: string; en: string; readonly label: string };
}
export const STATUS_STATES = {} as Record<StatusBadgeMachine, Record<string, StatusBadgeEntry>>;
export const STATUS_MACHINES = {} as Record<StatusBadgeMachine, StatusBadgeMachineInfo>;
const FLAT: Record<string, StatusBadgeEntry> = {};
for (const k of Object.keys(M) as StatusBadgeMachine[]) {
  const [fa, en, source, states] = M[k];
  STATUS_MACHINES[k] = entry(fa, en, { source });
  const map: Record<string, StatusBadgeEntry> = {};
  for (const s of Object.keys(states)) {
    const [sf, se, tone] = states[s]!;
    const v = entry(sf, se, { tone });
    map[s] = v;
    if (!FLAT[s]) FLAT[s] = v; // first machine wins (event, registration, match … come first)
  }
  STATUS_STATES[k] = map;
}
/** Unknown state: the raw key in fa, the product's en rule (underscores → spaces, sentence case) in en. */
function unknownState(state: unknown): StatusBadgeEntry {
  const raw = String(state ?? '');
  const s = raw.replace(/_/g, ' ');
  return entry(raw, s.charAt(0).toUpperCase() + s.slice(1), { tone: 'neutral' as StatusBadgeTone });
}
/** Machine first, then the first machine that defines the state; unknown → { label: state, tone: neutral }. */
export function resolveStatus(state: string, machine?: StatusBadgeMachine): StatusBadgeEntry {
  const m = machine ? STATUS_STATES[machine]?.[state] : undefined;
  return m ?? FLAT[state] ?? unknownState(state);
}

/* Alert / Toast */
export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
export const TONE_ICON: Record<NoticeTone, IconName> = { info: 'info', success: 'check-circle', warning: 'alert', danger: 'x-circle' };
export const noticeTone = (t?: string): NoticeTone => (t && t in TONE_ICON ? (t as NoticeTone) : 'info');

/* Skeleton / DataState */
export const px = (v: number | string | null | undefined): string | undefined => (v == null ? undefined : typeof v === 'number' ? `${v}px` : v);

/* Avatar */
export type AvatarSize = 24 | 32 | 40 | 56 | 72 | 96;
const AV_SIZES = [24, 32, 40, 56, 72, 96];
export const avSize = (n?: number): AvatarSize => (AV_SIZES.includes(Number(n)) ? (Number(n) as AvatarSize) : 40);
export const avChamfer = (n: number): string => (n <= 32 ? 'q-chamfer-xs' : n <= 40 ? 'q-chamfer-sm' : n <= 56 ? 'q-chamfer-md' : n <= 72 ? 'q-chamfer-lg' : 'q-chamfer-xl');
export function initial(name?: string): string {
  const s = String(name ?? '').trim();
  return s ? (Array.from(s)[0] ?? '?').toUpperCase() : '?';
}

/* EmptyState / DataState (locales state.stageLater / state.stageLaterHint / state.empty) */
export const laterTitle = () => tr('این بخش در مرحله بعد تکمیل می‌شود', 'This section will be completed in a later stage');
export const laterBody = () => tr('داده‌ی واقعی این بخش هنوز وجود ندارد و داده‌ی نمایشی ساخته نمی‌شود.', 'No real data exists for this section yet, and no demo data is fabricated.');
export const emptyTitle = () => tr('موردی برای نمایش وجود ندارد.', 'Nothing to show.');
