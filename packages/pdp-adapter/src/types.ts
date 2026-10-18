// PdpAdapter (plan §8), with the two changes docs/ARCHITECTURE.md records from docs/B2BROUTER.md:
// every call names the tenant's PDP account, and reporting a payment has its own method.
import type { Cents } from '@fi/core';

export type PdpProvider = 'mock' | 'b2brouter';

/**
 * The platform events we understand, whatever the provider calls them. Each provider maps its own
 * vocabulary here (B2Brouter: docs/B2BROUTER.md §7); src/mapping.ts maps these to our state machine.
 */
export const PDP_STATUSES = [
  'deposited',
  'received_by_platform',
  'delivered',
  'accepted',
  'refused',
  'payment_received',
  'rejected',
] as const;
export type PdpStatus = (typeof PDP_STATUSES)[number];

export interface PdpReason {
  code?: string;
  text?: string;
}

export interface PdpStatusEvent {
  /** The platform's id for this event: we apply each one once. */
  id: string;
  /** `unknown` when the provider sent a state we do not map yet; `raw` keeps it for the timeline. */
  status: PdpStatus | 'unknown';
  raw: string;
  /** ISO date-time. */
  at: string;
  reason?: PdpReason;
}

export interface PdpRejection {
  rule: string;
  message: string;
}

export type SendResult =
  | { outcome: 'deposited'; pdpRef: string }
  | { outcome: 'rejected'; errors: PdpRejection[] };

export interface SendInput {
  account: string;
  xml: string;
  format: 'CII' | 'UBL';
  pdf?: Uint8Array;
  /** tenant + number + fingerprint: the same key never deposits twice. */
  idempotencyKey: string;
}

export interface RoutingInfo {
  siren: string;
  name?: string;
  /** Platform that receives for this company, when the directory says. */
  platform?: string;
}

export interface InboundInvoice {
  pdpRef: string;
  receivedAt: string;
  xml: string;
}

/** A webhook as received: headers and the raw body, before any JSON parsing. */
export interface WebhookRequest {
  headers: Headers;
  body: string;
}

/** What a webhook tells us: something changed on this invoice. We fetch the state ourselves. */
export interface WebhookNotice {
  account: string;
  pdpRef: string;
}

export interface PdpAdapter {
  readonly provider: PdpProvider;
  sendInvoice(input: SendInput): Promise<SendResult>;
  /** The full event history of an invoice, oldest first. */
  getStatus(input: { account: string; pdpRef: string }): Promise<PdpStatusEvent[]>;
  listInbound(input: { account: string; since: Date }): Promise<InboundInvoice[]>;
  lookupRecipient(input: { account: string; siren: string }): Promise<RoutingInfo | null>;
  /** « Encaissée » (status 212): the seller reports the payment it received. */
  reportPayment(input: { account: string; pdpRef: string; amount: Cents }): Promise<void>;
  verifyWebhook(request: WebhookRequest): boolean;
  /** Throws PdpRequestError on a body it cannot read. Call verifyWebhook first. */
  parseWebhook(body: string): WebhookNotice[];
}

/** The platform could not be reached or answered 5xx/429: try again later, with the same key. */
export class PdpUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PdpUnavailableError';
  }
}

/** The platform refused the request itself (auth, unknown invoice, bad answer): retrying will not help. */
export class PdpRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PdpRequestError';
  }
}
