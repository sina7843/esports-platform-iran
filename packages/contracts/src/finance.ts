import { z } from 'zod';
import { RialSchema } from './money.js';
import { UtcInstantSchema } from './time.js';

/** Chapter 11 — orders, payments, ledger, refunds, prizes, subscriptions, tickets, sponsors (FIN-001..012). */

export const ProductKinds = ['entry', 'ticket', 'subscription', 'organizer_service'] as const;

export const PriceListCreateSchema = z.object({
  productKey: z.string().min(1).max(80).regex(/^[a-z_]+:[A-Za-z0-9_-]+$/),
  kind: z.enum(ProductKinds),
  amountRial: RialSchema,
  feeBps: z.number().int().min(0).max(5000),
  effectiveFrom: UtcInstantSchema,
});

export const DiscountCreateSchema = z.object({
  code: z.string().min(3).max(30).regex(/^[A-Z0-9_-]+$/),
  kind: z.enum(['percent', 'amount']),
  value: z.number().int().min(1),
  appliesTo: z.array(z.enum(ProductKinds)).min(1),
  maxUses: z.number().int().min(1).max(1000000),
  validFrom: UtcInstantSchema.nullable().default(null),
  validTo: UtcInstantSchema.nullable().default(null),
});

export const CheckoutSchema = z.object({ discountCode: z.string().max(30).nullable().default(null) });
export const PaySchema = z.object({ returnUrl: z.string().url().max(500) });

export const GatewayCallbackSchema = z.object({
  gatewayRef: z.string().min(1).max(120),
  status: z.enum(['success', 'failed', 'cancelled']),
  amountRial: z.coerce.number().int(),
  orderId: z.string().min(1).max(64),
  merchantId: z.string().min(1).max(64),
  ts: z.coerce.number().int(),
  signature: z.string().min(16).max(256),
});

export const RefundRequestSchema = z.object({
  amountRial: RialSchema.refine((v) => v > 0, 'must be positive'),
  reason: z.enum(['withdrawal', 'event_cancelled', 'disqualification', 'postponement', 'capacity_unavailable', 'manual']),
  idempotencyKey: z.string().min(8).max(80),
  approvalId: z.string().nullable().default(null),
  /** Required when refunding a manual payment (FIN-005): the refund is executed outside the PSP. */
  evidenceFileId: z.string().nullable().default(null),
});

export const ManualPaymentSchema = z.object({
  orderId: z.string(),
  evidenceFileId: z.string(),
  approvalId: z.string(),
  note: z.string().min(3).max(1000),
});

export const PrizeRecipientSchema = z.object({
  kind: z.enum(['team', 'player']),
  ref: z.string().min(1),
  payeePrincipalId: z.string().min(1),
  shares: z.array(z.object({ principalId: z.string(), percent: z.number().int().min(0).max(100) })).max(30).default([]),
  expectedVersion: z.number().int(),
  approvalId: z.string().nullable().default(null),
});
export const PrizeReleaseSchema = z.object({ resultRef: z.object({ matchOrStandingId: z.string(), resultVersion: z.number().int(), final: z.literal(true) }), expectedVersion: z.number().int() });
export const PrizePayoutSchema = z.object({ approvalId: z.string(), evidenceFileId: z.string().nullable().default(null), providerRef: z.string().nullable().default(null), expectedVersion: z.number().int() });
export const PrizeConfirmPaidSchema = z.object({ evidenceFileId: z.string().nullable().default(null), providerRef: z.string().nullable().default(null), expectedVersion: z.number().int() });

export const SubscriptionPlans = {
  player_pro: { holder: 'player', priceKey: 'subscription:player_pro', days: 30, features: ['profile_highlight', 'advanced_stats_view'] },
  team_pro: { holder: 'team', priceKey: 'subscription:team_pro', days: 30, features: ['recruitment_boost', 'team_calendar_export'] },
  organizer_pro: { holder: 'organization', priceKey: 'subscription:organizer_pro', days: 30, features: ['bulk_import', 'sponsor_reports'] },
} as const;
export const SubscriptionCreateSchema = z.object({ plan: z.enum(['player_pro', 'team_pro', 'organizer_pro']), holderRef: z.string().min(1), autoRenew: z.boolean().default(false) });

export const TicketCreateSchema = z.object({ quantity: z.number().int().min(1).max(10).default(1) });

export const SponsorPlacementSchema = z.object({
  sponsorName: z.string().min(1).max(120),
  placement: z.enum(['event_header', 'live_center', 'stream_overlay', 'news_sidebar']),
  label: z.enum(['sponsor', 'advertisement']),
  publisherRestrictionNote: z.string().max(1000).nullable().default(null),
});
