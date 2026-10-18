// What a company's account is made of besides its invoices (M7): its subscription and an accounting
// firm's brand. Shared by the API (authoritative) and the task pane (display).
import { z } from 'zod';

/**
 * The plans of docs/research/PRICING.md §3.2. ⚠️ A proposal until the owner confirms it against
 * B2Brouter's quote: nothing here is published, and prices live only in the owner's Stripe account.
 */
export const PLANS = ['essentiel', 'croissance'] as const;
export const Plan = z.enum(PLANS);
export type Plan = z.infer<typeof Plan>;

/** Invoices sent to the platform each calendar month (Europe/Paris) before each one is billed. */
export const MONTHLY_SENDS: Record<Plan, number> = { essentiel: 30, croissance: 100 };

export const BILLING_INTERVALS = ['month', 'year'] as const;
export const BillingInterval = z.enum(BILLING_INTERVALS);
export type BillingInterval = z.infer<typeof BillingInterval>;

/** 30 days with every feature; Mode test unlimited, 10 invoices sent for real (PRICING.md §3.2). */
export const TRIAL_DAYS = 30;
export const TRIAL_REAL_SENDS = 10;

/**
 * trial: the free month. active / past_due: a subscription (past_due while Stripe retries a failed
 * payment). ended: trial over without one, or the subscription ended. pilot: set by the operator,
 * never billed (pilot customers, internal companies).
 */
export const BILLING_STATUSES = ['trial', 'active', 'past_due', 'ended', 'pilot'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/** The terms a new account accepts; bump when the owner publishes new ones. */
export const TERMS_VERSION = '2026-10-18';

/**
 * An accounting firm's brand on a company it deploys to (plan §11 M7 « accountant white-label
 * flag »). `full` drops the Facture Impec mention (PRICING.md: on quote).
 */
export const WhiteLabel = z.object({
  firmName: z.string().trim().min(1).max(80),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB')
    .optional(),
  full: z.boolean().default(false),
});
export type WhiteLabel = z.infer<typeof WhiteLabel>;
