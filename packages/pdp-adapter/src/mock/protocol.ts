// The HTTP protocol of apps/mock-pdp (plan §3), shared by the server and by the mock adapter.
// Shapes follow B2Brouter where it matters to the adapter (webhook envelope and signature,
// rejection list), so M4 changes the client, not the API.
import { z } from 'zod';
import { PDP_STATUSES } from '../types';

export const MOCK_HEADERS = {
  account: 'x-account-id',
  idempotencyKey: 'idempotency-key',
  signature: 'x-mock-pdp-signature',
  deliveryId: 'x-mock-pdp-delivery-id',
  deliveryAttempt: 'x-mock-pdp-delivery-attempt',
} as const;

export const MockStatus = z.enum(PDP_STATUSES);
export const Reason = z.object({ code: z.string().optional(), text: z.string().optional() });

export const MockSendResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('deposited'), id: z.string() }),
  z.object({
    status: z.literal('rejected'),
    errors: z.array(z.object({ rule: z.string(), message: z.string() })),
  }),
]);
export type MockSendResponse = z.infer<typeof MockSendResponse>;

export const MockEvent = z.object({
  id: z.string(),
  status: MockStatus,
  at: z.string(),
  reason: Reason.optional(),
});
export type MockEvent = z.infer<typeof MockEvent>;

export const MockInvoice = z.object({
  id: z.string(),
  account: z.string(),
  number: z.string().nullable(),
  status: MockStatus,
  events: z.array(MockEvent),
});
export type MockInvoice = z.infer<typeof MockInvoice>;

export const MockInbound = z.object({ id: z.string(), receivedAt: z.string(), xml: z.string() });
export type MockInbound = z.infer<typeof MockInbound>;

export const MockDirectoryEntry = z.object({
  siren: z.string(),
  name: z.string().optional(),
  platform: z.string().optional(),
});

/** B2Brouter's envelope for `issued_invoice.state_change` (docs/B2BROUTER.md §4). */
export const MockWebhook = z.object({
  code: z.string(),
  triggered_at: z.number(),
  data: z.object({
    account_id: z.string(),
    invoice_id: z.string(),
    event_id: z.string(),
    state: z.string(),
  }),
});
export type MockWebhook = z.infer<typeof MockWebhook>;

/** ISO 8601 duration with days and time only ("PT5M", "P2D", "P1DT12H"), in seconds. */
export function parseDuration(value: string): number {
  const m =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!m || value === 'P' || value.endsWith('T')) throw new Error(`not a duration: ${value}`);
  const [, d = '0', h = '0', min = '0', s = '0'] = m;
  return Number(d) * 86_400 + Number(h) * 3_600 + Number(min) * 60 + Number(s);
}

const Duration = z.string().refine((v) => {
  try {
    parseDuration(v);
    return true;
  } catch {
    return false;
  }
}, 'ISO 8601 duration such as PT5M or P2D');

/** One step of the scripted lifecycle, `after` the previous step, in business time. */
export const TimelineStep = z.object({
  status: MockStatus.exclude(['deposited']),
  after: Duration,
  reason: Reason.optional(),
});
export type TimelineStep = z.infer<typeof TimelineStep>;

export const DEFAULT_TIMELINE: TimelineStep[] = [
  { status: 'received_by_platform', after: 'PT5M' },
  { status: 'delivered', after: 'PT1H' },
  { status: 'accepted', after: 'P2D' },
  { status: 'payment_received', after: 'P30D' },
];

/** Test controls (PUT /control). Every field is optional and changes only what it names. */
export const MockControl = z.object({
  /** Business seconds per real second: 86 400 runs a day in one second. */
  speed: z.number().positive().optional(),
  timeline: z.array(TimelineStep).optional(),
  /**
   * The next `count` deposits fail. `error`: 503 before storing anything. `drop-response`: the
   * invoice is stored, then the answer is lost (503), as when a connection breaks.
   */
  failNext: z
    .object({ count: z.number().int().min(0), mode: z.enum(['error', 'drop-response']) })
    .optional(),
  /** The next `count` webhook deliveries fail as if the API were down; they are retried. */
  webhookFailures: z.number().int().min(0).optional(),
  /** SIRENs the directory does not know (« SIREN inconnu »). */
  unknownSirens: z.array(z.string()).optional(),
});
export type MockControl = z.infer<typeof MockControl>;

export const MockScenario = z.object({
  status: MockStatus.exclude(['deposited']),
  reason: Reason.optional(),
  /** Business delay: the status arrives then, and replaces what was left of the timeline. */
  after: Duration.optional(),
});
export type MockScenario = z.infer<typeof MockScenario>;
