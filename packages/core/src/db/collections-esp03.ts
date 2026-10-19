import type { Collection, Db } from 'mongodb';
import type { PaymentState, PrizeState, RegistrationState } from '@esp/contracts';

/**
 * ESP-03 collections: event configuration (disciplines, stages, links, quotas, seasons), registration with atomic
 * capacity, roster and check-in, and finance (orders, payments, gateway callbacks, append-only ledger, refunds,
 * manual payments, prizes/payouts, subscriptions, discounts, price lists, sponsors). Money is integer IRR.
 */

export interface EventConfig {
  description: string | null;
  posterFileId: string | null;
  presence: 'online' | 'offline' | 'hybrid';
  regions: string[];
  language: string;
  contact: string | null;
  linkToken: string | null; // link_only visibility: access requires the token; never indexed
  publishAt: string | null; // scheduled publication
  rated: boolean; // rating-affecting event (RANK-004); needs pre-event rules review (RULE-012)
  prizes: Array<{ key: string; title: string; kind: 'cash' | 'non_cash'; amountRial: number; description: string | null; responsible: 'platform' | 'organizer' | 'sponsor'; responsibleName: string | null }>;
  refundPolicy: { beforeDeadlinePercent: number; afterDeadlinePercent: number; onEventCancelPercent: number; onDisqualificationPercent: number; text: string } | null;
  cancellationTerms: string | null;
  disputeTerms: string | null;
  isTemplate: boolean;
  duplicatedFrom: string | null;
  seasonId: string | null;
  /** EVT-008: official affiliation claim; shown publicly only once an independent reviewer verified the evidence. */
  affiliation?: EventAffiliation | null;
}

export interface EventAffiliation {
  kind: 'publisher_licensed' | 'federation_sanctioned' | 'official_partner';
  body: string;
  evidenceFileId: string;
  state: 'pending' | 'verified' | 'rejected';
  claimedBy: string;
  claimedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

export interface DisciplineConfig {
  rulesPackageId: string | null;
  participantKind: 'team' | 'player';
  capacity: number;
  minParticipants: number;
  feeRial: number;
  priceListId: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  lateRegistrationUntil: string | null;
  editDeadline: string | null;
  withdrawalDeadline: string | null;
  paymentWindowMinutes: number;
  autoApprove: boolean;
  waitlistPolicy: 'fifo';
  quotas: Array<{ kind: 'public' | 'invite' | 'qualifier' | 'organization'; size: number; ref: string | null }>;
  formFields: Array<{ key: string; label: string; type: 'text' | 'number' | 'select' | 'checkbox'; required: boolean; options: string[] | null; private: boolean }>;
  requiredDocuments: Array<{ key: string; label: string; retentionClass: string }>;
  checkin: { opensMinutesBefore: number; closesMinutesBefore: number; graceMinutes: number; policy: 'captain' | 'all_members' | 'min_members'; minMembers: number | null } | null;
  seasonChangeCap: number | null;
  presence: 'online' | 'offline' | 'hybrid';
  regions: string[];
}

export interface StageLink {
  fromStageId: string | null; // null = direct invite / external quota
  kind: 'qualifier' | 'invite' | 'seed' | 'quota';
  slots: number;
  points: 'carry' | 'reset' | 'factor';
  factor: number | null;
}

export interface QualificationSlotDoc {
  _id: string;
  targetDisciplineId: string;
  targetStageId: string | null;
  source: { kind: 'stage' | 'event' | 'invite' | 'season'; ref: string; rank: number | null };
  /** Participant identity (team or player) that holds the slot; unique per target discipline. */
  holderKey: string; // `team:<id>` | `player:<id>`
  state: 'reserved' | 'claimed' | 'released';
  /** Assigned only from a final result (ESP-04/05); ESP-03 never fabricates advancement. */
  provenance: { createdBy: string; createdAt: string; resultVersion: number | null; reason: string };
  version: number;
}

export interface SeasonDoc {
  _id: string;
  gameId: string;
  name: string;
  from: string;
  to: string;
  pointsPolicy: string;
  nextEventQuotas: Array<{ targetEventId: string; slots: number }>;
  createdAt: string;
  version: number;
}

export interface EntryCodeDoc {
  _id: string; // code itself (upper-case)
  disciplineId: string;
  quotaKind: 'invite' | 'organization';
  holderKey: string | null; // invite bound to a team/player; null = any holder (group code)
  maxUses: number;
  used: number;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CapacityCounterDoc {
  _id: string; // `${disciplineId}:${quotaKind}`
  disciplineId: string;
  quotaKind: string;
  capacity: number;
  held: number; // temporary reservations (awaiting payment / review)
  confirmed: number;
  version: number;
}

export interface RegistrationDoc {
  _id: string;
  trackingCode: string;
  eventId: string;
  disciplineId: string;
  kind: 'team' | 'player';
  teamId: string | null;
  holderKey: string;
  applicantPrincipalId: string;
  displayName: string;
  quotaKind: string;
  entryCode: string | null;
  state: RegistrationState;
  /** Members invited to this registration; each must confirm personally (ROS-002). */
  roster: Array<{ principalId: string; displayName: string; role: 'starter' | 'substitute' | 'coach' | 'manager'; status: 'invited' | 'confirmed' | 'declined'; confirmedAt: string | null }>;
  formAnswers: Record<string, unknown>;
  documentFileIds: Record<string, string>;
  acceptedRules: { packageId: string; version: string; hash: string; acceptedAt: string } | null;
  eligibility: { ok: boolean; issues: Array<{ code: string; message: string; clause: string | null; needsReview: boolean }>; checkedAt: string };
  /** Capacity unit owned by this registration: `held` until approval, then `confirmed`; released exactly once. */
  reservation: { counterId: string; heldAt: string; expiresAt: string | null; released: boolean; confirmed: boolean } | null;
  waitlistedAt: string | null;
  /** Strict FIFO position from an atomic counter (timestamps can tie). */
  waitlistSeq: number | null;
  feeRial: number;
  orderId: string | null;
  participationId: string | null;
  late: boolean;
  history: Array<{ at: string; by: string; transition: string; note: string | null }>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RosterLockDoc {
  _id: string; // `${level}:${ref}:${registrationId}`
  level: 'event' | 'stage' | 'match';
  ref: string;
  registrationId: string;
  members: Array<{ principalId: string; displayName: string; role: string }>;
  lockedAt: string;
  lockedBy: string;
}

export interface SubstitutionDoc {
  _id: string;
  registrationId: string;
  kind: 'regular' | 'between_maps' | 'emergency';
  outPrincipalId: string;
  inPrincipalId: string;
  matchId: string | null;
  reason: string | null;
  approvedBy: string | null;
  seasonId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CheckinDoc {
  _id: string; // `${level}:${ref}:${registrationId}`
  level: 'event' | 'stage' | 'match';
  ref: string;
  registrationId: string;
  members: Array<{ principalId: string; at: string; by: string; manual: boolean }>;
  state: 'pending' | 'checked_in' | 'late' | 'no_show' | 'excused';
  decidedBy: string | null;
  reason: string | null;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------------- finance
export type ProductKind = 'entry' | 'ticket' | 'subscription' | 'organizer_service';

export interface PriceListDoc {
  _id: string;
  productKey: string; // e.g. `entry:<disciplineId>`, `subscription:player_pro`
  kind: ProductKind;
  amountRial: number;
  feeBps: number; // platform fee in basis points, versioned (FIN-011)
  version: number;
  effectiveFrom: string;
  createdBy: string;
  createdAt: string;
  supersededAt: string | null;
}

export interface DiscountDoc {
  _id: string; // code
  kind: 'percent' | 'amount';
  value: number;
  appliesTo: ProductKind[];
  maxUses: number;
  used: number;
  validFrom: string | null;
  validTo: string | null;
  createdBy: string;
  createdAt: string;
}

export interface OrderDoc {
  _id: string;
  kind: ProductKind;
  payerPrincipalId: string;
  items: Array<{ productKey: string; description: string; amountRial: number; quantity: number }>;
  priceListId: string | null;
  priceVersion: number | null;
  subtotalRial: number;
  discountCode: string | null;
  discountRial: number;
  feeRial: number;
  totalRial: number;
  refs: { registrationId?: string; eventId?: string; ticketId?: string; subscriptionId?: string; organizationId?: string };
  /** Ledger account credited with the net amount (organizer payable or platform revenue). */
  creditAccount: string;
  state: 'open' | 'paid' | 'cancelled' | 'refunded' | 'partially_refunded' | 'expired';
  receiptNo: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PaymentDoc {
  _id: string;
  orderId: string;
  amountRial: number;
  adapter: string;
  gatewayRef: string | null;
  providerRef: string | null;
  state: PaymentState;
  manual: { evidenceFileId: string; approvalId: string; label: 'manual'; recordedBy: string } | null;
  refundedRial: number;
  expiresAt: string;
  verifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface GatewayCallbackDoc {
  _id: string;
  gatewayRef: string;
  receivedAt: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
  outcome: 'applied' | 'duplicate' | 'rejected' | 'out_of_order' | 'unknown_ref';
}

/** Append-only double-entry ledger (FIN-003). Corrections are new compensating entries (`reversalOf`). */
export interface LedgerEntryDoc {
  _id: string;
  seq: number;
  txId: string; // groups the balanced lines of one transaction
  account: string; // e.g. `cash:gateway`, `revenue:entry`, `liability:refunds`, `fee:platform`, `prize:obligation:<id>`
  amountRial: number; // debit positive, credit negative; every txId sums to 0
  kind: 'payment' | 'fee' | 'discount' | 'refund' | 'debt' | 'prize' | 'payout' | 'manual_payment' | 'reversal' | 'subscription';
  refs: Record<string, string>;
  reason: string | null;
  reversalOf: string | null;
  createdBy: string;
  createdAt: string;
}

export interface RefundDoc {
  _id: string;
  paymentId: string;
  orderId: string;
  amountRial: number;
  reason: 'withdrawal' | 'event_cancelled' | 'disqualification' | 'postponement' | 'capacity_unavailable' | 'manual';
  idempotencyKey: string; // unique
  state: 'requested' | 'awaiting_approval' | 'sent' | 'confirmed' | 'failed';
  approvalId: string | null;
  providerRef: string | null;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PrizeDoc {
  _id: string;
  eventId: string;
  disciplineId: string | null;
  prizeKey: string;
  title: string;
  kind: 'cash' | 'non_cash';
  amountRial: number;
  responsible: 'platform' | 'organizer' | 'sponsor';
  state: PrizeState;
  recipient: { kind: 'team' | 'player'; ref: string; payeePrincipalId: string; shares: Array<{ principalId: string; percent: number }> } | null;
  /** Release requires a final result reference from ESP-05 (provider/contract until then). */
  resultRef: { matchOrStandingId: string; resultVersion: number; final: true } | null;
  payout: { approvalId: string; providerRef: string | null; evidenceFileId: string | null; paidAt: string | null } | null;
  history: Array<{ at: string; by: string; transition: string; note: string | null }>;
  createdAt: string;
  version: number;
}

export interface SubscriptionDoc {
  _id: string;
  plan: string;
  holder: { kind: 'player' | 'team' | 'organization'; ref: string };
  payerPrincipalId: string;
  state: 'pending_payment' | 'active' | 'expired' | 'cancelled';
  periodStart: string | null;
  periodEnd: string | null;
  autoRenew: boolean;
  /** Features are presentation/tooling only; they never grant competitive points or refereeing authority (BASE-007). */
  features: string[];
  orderIds: string[];
  createdAt: string;
  version: number;
}

export interface TicketDoc {
  _id: string;
  eventId: string;
  holderPrincipalId: string;
  orderId: string;
  code: string; // unique validation code
  state: 'pending_payment' | 'valid' | 'used' | 'void';
  usedAt: string | null;
  createdAt: string;
  version: number;
}

export interface SponsorPlacementDoc {
  _id: string;
  eventId: string;
  sponsorName: string;
  placement: 'event_header' | 'live_center' | 'stream_overlay' | 'news_sidebar';
  label: 'sponsor' | 'advertisement';
  publisherRestrictionCheck: { checked: boolean; packageId: string | null; note: string | null; checkedBy: string | null };
  state: 'draft' | 'approved' | 'withdrawn';
  createdBy: string;
  createdAt: string;
  version: number;
}

export interface Esp03Collections {
  qualificationSlots: Collection<QualificationSlotDoc>;
  seasons: Collection<SeasonDoc>;
  entryCodes: Collection<EntryCodeDoc>;
  capacityCounters: Collection<CapacityCounterDoc>;
  registrations: Collection<RegistrationDoc>;
  rosterLocks: Collection<RosterLockDoc>;
  substitutions: Collection<SubstitutionDoc>;
  checkins: Collection<CheckinDoc>;
  priceLists: Collection<PriceListDoc>;
  discounts: Collection<DiscountDoc>;
  orders: Collection<OrderDoc>;
  payments: Collection<PaymentDoc>;
  gatewayCallbacks: Collection<GatewayCallbackDoc>;
  ledger: Collection<LedgerEntryDoc>;
  refunds: Collection<RefundDoc>;
  prizes: Collection<PrizeDoc>;
  subscriptions: Collection<SubscriptionDoc>;
  tickets: Collection<TicketDoc>;
  sponsorPlacements: Collection<SponsorPlacementDoc>;
}

export const esp03CollectionNames = {
  qualificationSlots: 'qualification_slots',
  seasons: 'seasons',
  entryCodes: 'entry_codes',
  capacityCounters: 'capacity_counters',
  registrations: 'registrations',
  rosterLocks: 'roster_locks',
  substitutions: 'substitutions',
  checkins: 'checkins',
  priceLists: 'price_lists',
  discounts: 'discounts',
  orders: 'orders',
  payments: 'payments',
  gatewayCallbacks: 'gateway_callbacks',
  ledger: 'ledger',
  refunds: 'refunds',
  prizes: 'prizes',
  subscriptions: 'subscriptions',
  tickets: 'tickets',
  sponsorPlacements: 'sponsor_placements',
} as const satisfies Record<keyof Esp03Collections, string>;

export function esp03Collections(db: Db): Esp03Collections {
  const out = {} as Record<string, Collection>;
  for (const [k, name] of Object.entries(esp03CollectionNames)) out[k] = db.collection(name);
  return out as unknown as Esp03Collections;
}
