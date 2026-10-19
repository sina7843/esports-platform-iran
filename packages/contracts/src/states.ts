import type { Role } from './acl.js';

/**
 * Chapter 15.1 — state machines for every status-bearing entity.
 * This table is the single source of truth: the domain `transition()` guard enforces it, and
 * `docs/state-transitions.md` is generated from it. Free-form status writes are rejected by the API;
 * only named transitions can move an entity, and each carries an optimistic-concurrency version check.
 */
export interface Transition<S extends string> {
  name: string;
  from: readonly S[];
  to: S;
  /** Roles that may trigger this transition inside the entity's scope (plus 'system' for workers). */
  roles: readonly (Role | 'system')[];
  precondition: string;
  effect: string;
  notification: string;
  /** How the transition is reversed/compensated if it must be undone. 'none' = irreversible by design. */
  compensation: string;
  /** Requires an independent second approval (ACL-003). */
  secondApproval?: boolean;
}

export interface StateMachine<S extends string> {
  entity: string;
  entityFa: string;
  states: readonly S[];
  statesFa: Record<S, string>;
  initial: S;
  transitions: readonly Transition<S>[];
}

// ---------------------------------------------------------------- Event
export const EventStates = [
  'draft',
  'in_review',
  'published',
  'registration_open',
  'registration_closed',
  'preparing',
  'active',
  'paused',
  'finished',
  'closed',
  'cancelled',
  'archived',
] as const;
export type EventState = (typeof EventStates)[number];

export const eventMachine: StateMachine<EventState> = {
  entity: 'event',
  entityFa: 'رویداد',
  states: EventStates,
  statesFa: {
    draft: 'پیش‌نویس',
    in_review: 'در بررسی',
    published: 'منتشرشده',
    registration_open: 'ثبت‌نام باز',
    registration_closed: 'ثبت‌نام بسته',
    preparing: 'آماده‌سازی',
    active: 'فعال',
    paused: 'متوقف',
    finished: 'پایان‌یافته',
    closed: 'بسته‌شده',
    cancelled: 'لغوشده',
    archived: 'آرشیوی',
  },
  initial: 'draft',
  transitions: [
    { name: 'submit_for_review', from: ['draft'], to: 'in_review', roles: ['organizer'], precondition: 'completeness check passes (EVT-007): rules snapshot, prizes, fees, cancellation and dispute terms present', effect: 'event locked for editing except by reviewer notes', notification: 'organizer, platform review queue', compensation: 'return_to_draft' },
    { name: 'return_to_draft', from: ['in_review'], to: 'draft', roles: ['platform_admin', 'rules_officer', 'organizer'], precondition: 'review notes recorded', effect: 'editing re-enabled', notification: 'organizer', compensation: 'none (re-submit)' },
    { name: 'publish', from: ['in_review', 'draft'], to: 'published', roles: ['organizer', 'platform_admin', 'system'], precondition: 'system only for a schedule set by an authorized organizer (EVT-006), same gate; rules package consistent (RULE-010), organizer authority and limits ok (ADM-004), visibility set (EVT-003)', effect: 'public page, search indexing per visibility, rules snapshot frozen', notification: 'followers of organizer/game, scheduled posts', compensation: 'cancel (with refund policy) — unpublish is not silent' },
    { name: 'open_registration', from: ['published'], to: 'registration_open', roles: ['organizer', 'system'], precondition: 'registration window start reached or manual open; capacity and quotas defined', effect: 'registrations accepted', notification: 'followers', compensation: 'close_registration' },
    { name: 'close_registration', from: ['registration_open'], to: 'registration_closed', roles: ['organizer', 'system'], precondition: 'deadline reached or manual', effect: 'no new registrations; waitlist processing continues per policy', notification: 'pending registrants', compensation: 'reopen_registration (organizer, reason)' },
    { name: 'reopen_registration', from: ['registration_closed'], to: 'registration_open', roles: ['organizer'], precondition: 'no stage started; reason recorded', effect: 'registrations accepted again', notification: 'waitlist', compensation: 'close_registration' },
    { name: 'start_preparation', from: ['registration_closed'], to: 'preparing', roles: ['organizer', 'system'], precondition: 'minimum participants satisfied or exception approved (15.5 shortage)', effect: 'draw/schedule tools enabled; roster locks per stage', notification: 'confirmed participants', compensation: 'reopen_registration' },
    { name: 'activate', from: ['preparing'], to: 'active', roles: ['organizer', 'event_operator'], precondition: 'first stage draw published and schedule confirmed', effect: 'live center opens; matches may start', notification: 'participants, staff, followers', compensation: 'pause' },
    { name: 'pause', from: ['active'], to: 'paused', roles: ['organizer', 'event_operator', 'head_referee'], precondition: 'reason category (outage, forced game update, infrastructure)', effect: 'all running matches paused; schedule proposals generated (SCH-006)', notification: 'participants, staff, public status', compensation: 'resume' },
    { name: 'resume', from: ['paused'], to: 'active', roles: ['organizer', 'event_operator', 'head_referee'], precondition: 'pause reason resolved; rules compatibility re-checked after forced updates', effect: 'matches resume with recorded pause duration', notification: 'participants, staff', compensation: 'pause' },
    { name: 'finish', from: ['active'], to: 'finished', roles: ['organizer', 'system'], precondition: 'all stages finished; no provisional results in rank-affecting matches', effect: 'final standings computed version-stamped', notification: 'participants, newsroom', compensation: 'reopen handled through result-correction case, not a status rollback' },
    { name: 'close', from: ['finished'], to: 'closed', roles: ['organizer', 'finance_officer'], precondition: 'END-006: all rank-affecting cases resolved; open financial obligations listed', effect: 'honors, points and quotas applied exactly once (END-004); prizes move to payout workflow', notification: 'winners, finance', compensation: 'none (corrections use RES-006 case flow with second approval)', secondApproval: true },
    { name: 'archive', from: ['closed', 'cancelled'], to: 'archived', roles: ['organizer', 'platform_admin', 'system'], precondition: 'retention clock started; media and news linked', effect: 'read-only archive page (AUD-004)', notification: 'none', compensation: 'none' },
    { name: 'cancel', from: ['draft', 'in_review', 'published', 'registration_open', 'registration_closed', 'preparing', 'active', 'paused'], to: 'cancelled', roles: ['organizer', 'platform_admin'], precondition: 'reason; refund/ticket/prize disposition chosen (15.5)', effect: 'registrations → cancelled/refund queue, tickets voided, prizes cancelled', notification: 'all registrants, ticket holders, staff', compensation: 'none', secondApproval: true },
  ],
};

// ---------------------------------------------------------------- Registration
export const RegistrationStates = ['draft', 'incomplete', 'awaiting_payment', 'awaiting_review', 'awaiting_capacity', 'confirmed', 'rejected', 'withdrawn', 'removed'] as const;
export type RegistrationState = (typeof RegistrationStates)[number];

export const registrationMachine: StateMachine<RegistrationState> = {
  entity: 'registration',
  entityFa: 'ثبت‌نام',
  states: RegistrationStates,
  statesFa: {
    draft: 'پیش‌نویس',
    incomplete: 'ناقص',
    awaiting_payment: 'انتظار پرداخت',
    awaiting_review: 'انتظار بررسی',
    awaiting_capacity: 'انتظار ظرفیت',
    confirmed: 'تأیید',
    rejected: 'رد',
    withdrawn: 'انصراف',
    removed: 'حذف',
  },
  initial: 'draft',
  transitions: [
    { name: 'submit', from: ['draft', 'incomplete'], to: 'awaiting_review', roles: ['player', 'team_captain', 'team_manager', 'team_owner'], precondition: 'eligibility checks pass (REG-002), rules version accepted (RULE-006), roster minimum met, capacity reserved atomically (REG-009) and fee is zero', effect: 'reservation held until review deadline', notification: 'organizer review queue', compensation: 'withdraw' },
    { name: 'submit_with_fee', from: ['draft', 'incomplete'], to: 'awaiting_payment', roles: ['player', 'team_captain', 'team_manager', 'team_owner'], precondition: 'as submit, fee > 0; temporary reservation with expiry (REG-006)', effect: 'payment intent created', notification: 'registrant', compensation: 'expire_reservation' },
    { name: 'mark_incomplete', from: ['awaiting_review'], to: 'incomplete', roles: ['organizer', 'event_operator'], precondition: 'reason and missing items listed (REG-004)', effect: 'reservation kept until fix deadline', notification: 'registrant', compensation: 'submit' },
    { name: 'payment_confirmed', from: ['awaiting_payment'], to: 'awaiting_review', roles: ['system'], precondition: 'server-verified payment matched amount/order (FIN-002); reservation still valid', effect: 'ledger entry; reservation converted', notification: 'registrant, organizer', compensation: 'refund via payment machine' },
    { name: 'payment_after_expiry', from: ['awaiting_payment', 'draft'], to: 'awaiting_capacity', roles: ['system'], precondition: 'verified payment arrived after reservation expired (REG-010)', effect: 'explicit decision pending: allocate if capacity exists or refund', notification: 'organizer, finance, registrant', compensation: 'refund' },
    { name: 'join_waitlist', from: ['draft'], to: 'awaiting_capacity', roles: ['system'], precondition: 'quota full at submission; FIFO position recorded (REG-006)', effect: 'no capacity held; promoted when capacity frees', notification: 'registrant', compensation: 'withdraw' },
    { name: 'allocate_for_payment', from: ['awaiting_capacity'], to: 'awaiting_payment', roles: ['system', 'organizer'], precondition: 'capacity freed for an unpaid waitlisted paid registration; atomic reservation with new payment window', effect: 'order (re)opened, reservation expiry set', notification: 'registrant', compensation: 'expire_reservation' },
    { name: 'allocate_from_waitlist', from: ['awaiting_capacity'], to: 'awaiting_review', roles: ['organizer', 'system'], precondition: 'capacity freed; atomic allocation succeeded', effect: 'reservation created', notification: 'registrant', compensation: 'release_to_waitlist' },
    { name: 'approve', from: ['awaiting_review'], to: 'confirmed', roles: ['organizer', 'event_operator', 'system'], precondition: 'auto or manual approval policy; documents verified by authorized staff only (REG-008)', effect: 'participation record created with roster + display name snapshot (DATA-002)', notification: 'registrant', compensation: 'remove (with reason) or withdraw' },
    { name: 'reject', from: ['awaiting_review', 'awaiting_capacity'], to: 'rejected', roles: ['organizer', 'event_operator', 'system'], precondition: 'reason mandatory; appeal/re-review path offered (REG-004)', effect: 'capacity released; fee refund queued per policy', notification: 'registrant', compensation: 'request_re_review → awaiting_review' },
    { name: 'request_re_review', from: ['rejected'], to: 'awaiting_review', roles: ['player', 'team_captain', 'team_manager'], precondition: 'within re-review window', effect: 'queued again', notification: 'organizer', compensation: 'reject' },
    { name: 'withdraw', from: ['draft', 'incomplete', 'awaiting_payment', 'awaiting_review', 'awaiting_capacity', 'confirmed'], to: 'withdrawn', roles: ['player', 'team_captain', 'team_manager', 'team_owner'], precondition: 'before withdrawal deadline or with refund-policy consequence shown (FIN-006)', effect: 'capacity released; waitlist promotion job; refund per policy', notification: 'organizer, waitlist', compensation: 'none' },
    { name: 'remove', from: ['confirmed'], to: 'removed', roles: ['organizer', 'head_referee', 'disciplinary_admin'], precondition: 'documented reason (disqualification, no-show, discipline) linked to a case', effect: 'participation flagged; bracket consequences per FMT-004', notification: 'registrant, affected opponents', compensation: 'reinstate via case decision (not a free status write)' },
    { name: 'cancel_by_event', from: ['draft', 'incomplete', 'awaiting_payment', 'awaiting_review', 'awaiting_capacity', 'confirmed'], to: 'removed', roles: ['system'], precondition: 'parent event cancelled with approval (15.5 cancellation)', effect: 'capacity released; refund per the published cancellation percentage; tickets voided', notification: 'registrant', compensation: 'none' },
    { name: 'expire_reservation', from: ['awaiting_payment'], to: 'draft', roles: ['system'], precondition: 'reservation expiry reached without verified payment', effect: 'capacity released', notification: 'registrant', compensation: 'submit_with_fee' },
  ],
};

// ---------------------------------------------------------------- Match
export const MatchStates = ['awaiting_sides', 'scheduled', 'awaiting_readiness', 'ready', 'pre_game_selection', 'live', 'paused', 'provisional', 'disputed', 'final', 'cancelled'] as const;
export type MatchState = (typeof MatchStates)[number];

export const matchMachine: StateMachine<MatchState> = {
  entity: 'match',
  entityFa: 'رویارویی',
  states: MatchStates,
  statesFa: {
    awaiting_sides: 'انتظار طرفین',
    scheduled: 'برنامه‌ریزی‌شده',
    awaiting_readiness: 'انتظار آمادگی',
    ready: 'آماده',
    pre_game_selection: 'انتخاب‌های پیش از بازی',
    live: 'جاری',
    paused: 'متوقف',
    provisional: 'پایان موقت',
    disputed: 'در اختلاف',
    final: 'نهایی',
    cancelled: 'لغوشده',
  },
  initial: 'awaiting_sides',
  transitions: [
    { name: 'assign_sides', from: ['awaiting_sides'], to: 'scheduled', roles: ['system', 'organizer', 'event_operator'], precondition: 'both sides have a valid origin (previous match, seed, quota) and no duplicate advancement (STG-002)', effect: 'slot filled; schedule candidate', notification: 'participants', compensation: 'unassign via draw redo with reason (DRAW-003)' },
    { name: 'open_checkin', from: ['scheduled'], to: 'awaiting_readiness', roles: ['system', 'event_operator'], precondition: 'check-in window opened (CHK-001)', effect: 'readiness collection starts', notification: 'captains/members', compensation: 'none' },
    { name: 'mark_ready', from: ['awaiting_readiness'], to: 'ready', roles: ['system', 'event_operator', 'referee'], precondition: 'minimum roster readiness met for both sides (CHK-002) or operator manual check-in (CHK-003)', effect: 'lobby data releasable to authorized members (ROOM-004)', notification: 'participants, referee', compensation: 'back to awaiting_readiness if a side becomes unavailable' },
    { name: 'start_selection', from: ['ready'], to: 'pre_game_selection', roles: ['system', 'referee', 'event_operator'], precondition: 'rules snapshot defines veto/pick order (CFG-003)', effect: 'veto timer started', notification: 'participants', compensation: 'none' },
    { name: 'start', from: ['pre_game_selection', 'ready'], to: 'live', roles: ['referee', 'event_operator', 'system', 'team_captain'], precondition: 'selections complete or rules say none required; start actor and time recorded (RUN-001)', effect: 'running; timers active', notification: 'live center, participants', compensation: 'pause' },
    { name: 'pause', from: ['live'], to: 'paused', roles: ['referee', 'event_operator', 'team_captain', 'system'], precondition: 'pause type tactical/technical within allowed count/duration (RUN-002)', effect: 'pause recorded with reason', notification: 'participants, referee', compensation: 'resume' },
    { name: 'resume', from: ['paused'], to: 'live', roles: ['referee', 'event_operator', 'system'], precondition: 'return deadline not exceeded or referee decision recorded', effect: 'running', notification: 'participants', compensation: 'pause' },
    { name: 'submit_result', from: ['live', 'paused'], to: 'provisional', roles: ['team_captain', 'referee', 'system'], precondition: 'result values valid against the game scoring model (RES-004); evidence attached if required', effect: 'provisional result visible with label; opponent confirmation deadline starts', notification: 'opponent, referee, live center (delayed projection)', compensation: 'dispute' },
    { name: 'dispute', from: ['provisional'], to: 'disputed', roles: ['team_captain', 'referee', 'system'], precondition: 'conflicting submissions or an opened dispute case within deadline (AC-09)', effect: 'auto-finalization blocked; case created', notification: 'both sides, referee', compensation: 'finalize after decision' },
    { name: 'finalize', from: ['provisional', 'disputed'], to: 'final', roles: ['referee', 'head_referee', 'system'], precondition: 'opponent confirmed or deadline passed with no active dispute (RES-003), or dispute decided; evidence source recorded (DATA-007)', effect: 'advancement/standings computed once; downstream slots filled; outbox events for news/ranking (exactly-once via event id)', notification: 'participants, newsroom, followers', compensation: 'result correction case (RES-006/007) with second approval; never a direct status write' },
    { name: 'reopen', from: ['final'], to: 'disputed', roles: ['head_referee', 'appeal_authority'], precondition: 'documented reason; impact list previewed (RES-006); dependent matches started → automatic rewrite forbidden, case required (RES-007)', effect: 'dependent actions frozen; affected parties listed', notification: 'affected parties', compensation: 'finalize again with new result version', secondApproval: true },
    { name: 'cancel', from: ['awaiting_sides', 'scheduled', 'awaiting_readiness', 'ready', 'pre_game_selection', 'live', 'paused'], to: 'cancelled', roles: ['organizer', 'head_referee', 'event_operator'], precondition: 'reason type (walkover, forfeit type, stage cancelled) per RUN-004', effect: 'bracket consequences per rules; no score invented', notification: 'participants', compensation: 'none' },
  ],
};

// ---------------------------------------------------------------- Dispute
export const DisputeStates = ['filed', 'assigned', 'defense_received', 'under_review', 'first_decision', 'appeal', 'closed'] as const;
export type DisputeState = (typeof DisputeStates)[number];
export const disputeMachine: StateMachine<DisputeState> = {
  entity: 'dispute',
  entityFa: 'اعتراض',
  states: DisputeStates,
  statesFa: { filed: 'ثبت‌شده', assigned: 'ارجاع‌شده', defense_received: 'دریافت دفاع', under_review: 'بررسی', first_decision: 'رأی نخست', appeal: 'تجدیدنظر', closed: 'مختومه' },
  initial: 'filed',
  transitions: [
    { name: 'assign', from: ['filed'], to: 'assigned', roles: ['head_referee', 'system'], precondition: 'assignee has no conflict of interest (REF-001)', effect: 'assignee set; deadlines computed from rules package', notification: 'assignee, parties', compensation: 'reassign with reason' },
    { name: 'receive_defense', from: ['assigned'], to: 'defense_received', roles: ['team_captain', 'player', 'system'], precondition: 'within defense deadline', effect: 'defense and evidence attached (private)', notification: 'assignee', compensation: 'none' },
    { name: 'start_review', from: ['assigned', 'defense_received'], to: 'under_review', roles: ['referee', 'head_referee'], precondition: 'defense received or deadline passed', effect: 'evidence requests possible (REF-003)', notification: 'parties', compensation: 'none' },
    { name: 'decide_first', from: ['under_review'], to: 'first_decision', roles: ['referee', 'head_referee'], precondition: 'decision cites rules version and clause (RULE-011)', effect: 'sanctions/result effects applied via their own machines; appeal window starts', notification: 'parties (served), head referee', compensation: 'appeal' },
    { name: 'appeal', from: ['first_decision'], to: 'appeal', roles: ['team_captain', 'player', 'team_manager'], precondition: 'within appeal deadline; independent appeal authority exists (REF-005)', effect: 'appeal authority assigned ≠ first decider', notification: 'appeal authority, parties', compensation: 'none' },
    { name: 'close', from: ['first_decision', 'appeal'], to: 'closed', roles: ['head_referee', 'appeal_authority', 'system'], precondition: 'appeal window passed or appeal decided with cited clause', effect: 'final; result correction case triggered if needed', notification: 'parties, affected matches', compensation: 'none (platform-wide extension needs disciplinary_admin, INT-004)' },
  ],
};

// ---------------------------------------------------------------- Payment
export const PaymentStates = ['created', 'awaiting_gateway', 'verified', 'failed', 'unknown', 'awaiting_refund', 'refunded_partial', 'refunded_full'] as const;
export type PaymentState = (typeof PaymentStates)[number];
export const paymentMachine: StateMachine<PaymentState> = {
  entity: 'payment',
  entityFa: 'پرداخت',
  states: PaymentStates,
  statesFa: { created: 'ایجادشده', awaiting_gateway: 'انتظار درگاه', verified: 'موفق تأییدشده', failed: 'ناموفق', unknown: 'نامشخص', awaiting_refund: 'انتظار بازپرداخت', refunded_partial: 'بازپرداخت جزئی', refunded_full: 'بازپرداخت کامل' },
  initial: 'created',
  transitions: [
    { name: 'redirect', from: ['created'], to: 'awaiting_gateway', roles: ['system'], precondition: 'gateway adapter configured (never a test double in production); order id + amount recorded', effect: 'gateway reference stored', notification: 'none', compensation: 'fail' },
    { name: 'verify', from: ['awaiting_gateway', 'unknown'], to: 'verified', roles: ['system'], precondition: 'server-side verification matched amount, currency and order id (FIN-002); idempotent on gateway reference (FIN-004)', effect: 'single ledger entry; registration payment_confirmed', notification: 'payer', compensation: 'refund' },
    { name: 'fail', from: ['created', 'awaiting_gateway', 'unknown'], to: 'failed', roles: ['system'], precondition: 'gateway reported failure or verification mismatch', effect: 'no ledger effect', notification: 'payer', compensation: 'none' },
    { name: 'mark_unknown', from: ['awaiting_gateway'], to: 'unknown', roles: ['system'], precondition: 'callback missing/timeout; reconciliation job scheduled', effect: 'reconciliation queue entry', notification: 'finance dashboard', compensation: 'verify or fail after reconciliation' },
    { name: 'request_refund', from: ['verified', 'refunded_partial'], to: 'awaiting_refund', roles: ['finance_officer', 'system'], precondition: 'refund policy outcome computed (FIN-006); amount ≤ remaining', effect: 'refund intent; large refunds need second approval', notification: 'payer', compensation: 'cancel refund request (returns to previous state)' },
    { name: 'refund_partial', from: ['awaiting_refund'], to: 'refunded_partial', roles: ['system', 'finance_officer'], precondition: 'provider confirmed partial refund with reference', effect: 'ledger refund entry', notification: 'payer', compensation: 'none', secondApproval: true },
    { name: 'refund_full', from: ['awaiting_refund'], to: 'refunded_full', roles: ['system', 'finance_officer'], precondition: 'provider confirmed full refund with reference', effect: 'ledger refund entry; obligation closed, re-settlement blocked', notification: 'payer', compensation: 'none', secondApproval: true },
  ],
};

// ---------------------------------------------------------------- Prize
export const PrizeStates = ['defined', 'recipient_verified', 'ready_to_pay', 'paying', 'paid', 'disputed', 'cancelled'] as const;
export type PrizeState = (typeof PrizeStates)[number];
export const prizeMachine: StateMachine<PrizeState> = {
  entity: 'prize',
  entityFa: 'جایزه',
  states: PrizeStates,
  statesFa: { defined: 'تعریف‌شده', recipient_verified: 'احراز گیرنده', ready_to_pay: 'آماده پرداخت', paying: 'پرداخت در جریان', paid: 'پرداخت‌شده', disputed: 'مورد اختلاف', cancelled: 'لغوشده' },
  initial: 'defined',
  transitions: [
    { name: 'verify_recipient', from: ['defined'], to: 'recipient_verified', roles: ['finance_officer', 'organizer'], precondition: 'authorized recipient declared before competition (FIN-007); documents verified', effect: 'recipient locked', notification: 'recipient', compensation: 'dispute' },
    { name: 'mark_ready', from: ['recipient_verified'], to: 'ready_to_pay', roles: ['system', 'finance_officer'], precondition: 'event closed; result final; responsible payer (platform/organizer) explicit (END-002)', effect: 'payout queue', notification: 'finance', compensation: 'dispute' },
    { name: 'start_payout', from: ['ready_to_pay'], to: 'paying', roles: ['finance_officer'], precondition: 'second independent approval recorded (ACL-003)', effect: 'payout instruction sent via provider or manual labeled path (FIN-005)', notification: 'recipient', compensation: 'provider failure → ready_to_pay with incident', secondApproval: true },
    { name: 'confirm_paid', from: ['paying'], to: 'paid', roles: ['system', 'finance_officer'], precondition: 'provider/manual reference recorded', effect: 'ledger settled; duplicate settlement blocked', notification: 'recipient', compensation: 'none' },
    { name: 'dispute', from: ['defined', 'recipient_verified', 'ready_to_pay', 'paying'], to: 'disputed', roles: ['finance_officer', 'organizer', 'head_referee'], precondition: 'linked case id', effect: 'payout frozen', notification: 'recipient, finance', compensation: 'resolve back to recipient_verified' },
    { name: 'resolve_dispute', from: ['disputed'], to: 'recipient_verified', roles: ['finance_officer', 'appeal_authority'], precondition: 'case closed', effect: 'payout flow resumes', notification: 'recipient', compensation: 'dispute' },
    { name: 'cancel', from: ['defined', 'recipient_verified', 'ready_to_pay', 'disputed'], to: 'cancelled', roles: ['finance_officer', 'organizer'], precondition: 'event cancelled or result correction removed entitlement; reason', effect: 'obligation closed', notification: 'recipient', compensation: 'none', secondApproval: true },
  ],
};

// ---------------------------------------------------------------- News
export const NewsStates = ['draft', 'in_review', 'scheduled', 'published', 'corrected', 'retracted', 'archived'] as const;
export type NewsState = (typeof NewsStates)[number];
export const newsMachine: StateMachine<NewsState> = {
  entity: 'news_post',
  entityFa: 'خبر',
  states: NewsStates,
  statesFa: { draft: 'پیش‌نویس', in_review: 'در بررسی', scheduled: 'زمان‌بندی‌شده', published: 'منتشرشده', corrected: 'اصلاح‌شده', retracted: 'پس‌گرفته‌شده', archived: 'آرشیوی' },
  initial: 'draft',
  transitions: [
    { name: 'submit', from: ['draft'], to: 'in_review', roles: ['reporter', 'photographer', 'editor'], precondition: 'linked competitive reference (NEWS-003); no provisional result labeled final (NEWS-008)', effect: 'review queue', notification: 'editors', compensation: 'return to draft' },
    { name: 'schedule', from: ['in_review', 'draft'], to: 'scheduled', roles: ['editor', 'reporter'], precondition: 'publish time respects stream delay policy (CAST-005/007); direct publish allowed only with explicit permission', effect: 'scheduled job', notification: 'author', compensation: 'unschedule → draft' },
    { name: 'publish', from: ['in_review', 'scheduled', 'draft'], to: 'published', roles: ['editor', 'system', 'reporter'], precondition: 'official result fields come from competition engine, not editable (NEWS-005); dedupe key for automatic posts (NEWS-006)', effect: 'public, stable URL, realtime event with visibleAt per delayed projection', notification: 'followers per preferences', compensation: 'retract or correct' },
    { name: 'correct', from: ['published', 'corrected'], to: 'corrected', roles: ['editor', 'system'], precondition: 'reason; correction notice shown (NEWS-004/007)', effect: 'new version; previous text retained', notification: 'readers via notice', compensation: 'none' },
    { name: 'retract', from: ['published', 'corrected', 'scheduled'], to: 'retracted', roles: ['editor'], precondition: 'reason recorded', effect: 'placeholder with retraction notice', notification: 'followers', compensation: 'none' },
    { name: 'archive', from: ['published', 'corrected', 'retracted'], to: 'archived', roles: ['system', 'editor'], precondition: 'event archived or retention', effect: 'archive page', notification: 'none', compensation: 'none' },
  ],
};

export const allMachines = [eventMachine, registrationMachine, matchMachine, disputeMachine, paymentMachine, prizeMachine, newsMachine] as const;

export function findTransition<S extends string>(machine: StateMachine<S>, name: string): Transition<S> | undefined {
  return machine.transitions.find((t) => t.name === name);
}
