// Invoice state machine (plan §4). `transition` is the only way to change an invoice status; the API
// keeps the status column write in one function that calls it. docs/STATE_MACHINE.md is generated from
// this table (scripts/generate-docs.ts) and a test fails when it is out of date.

export const STATES = [
  'draft',
  'needs_fix',
  'validated',
  'ready_to_send',
  'sending',
  'deposited',
  'rejected_by_pdp',
  'delivered',
  'refused_by_customer',
  'disputed',
  'accepted',
  'overdue',
  'chasing',
  'paid',
  'written_off',
  'credited',
  'cancelled',
] as const;
export type InvoiceState = (typeof STATES)[number];

/** Who triggers a transition: the user, one of our agents, the PDP (webhook or polling) or the system. */
export type Actor = 'user' | 'pdp' | 'system' | `agent:${string}`;
type ActorKind = 'user' | 'pdp' | 'system' | 'agent';

interface Transition {
  from: readonly InvoiceState[];
  to: InvoiceState;
  by: readonly ActorKind[];
  note: string;
}

const BEFORE_DEPOSIT = ['draft', 'needs_fix', 'validated', 'ready_to_send'] as const;
const AFTER_DEPOSIT = ['deposited', 'delivered', 'accepted', 'overdue', 'chasing'] as const;

export const TRANSITIONS = {
  validation_passed: {
    from: ['draft', 'needs_fix', 'validated'],
    to: 'validated',
    by: ['system'],
    note: 'The deterministic core found no blocking issue.',
  },
  validation_failed: {
    from: ['draft', 'needs_fix', 'validated'],
    to: 'needs_fix',
    by: ['system'],
    note: 'The deterministic core found at least one blocking issue.',
  },
  approve: {
    from: ['validated'],
    to: 'ready_to_send',
    by: ['user', 'system'],
    note: 'The user clicks « Envoyer », or the autopilot policy of the tenant passes.',
  },
  send: {
    from: ['ready_to_send'],
    to: 'sending',
    by: ['user', 'system'],
    note: 'The send job starts. Its idempotency key is tenant + number + fingerprint.',
  },
  send_interrupted: {
    from: ['sending'],
    to: 'ready_to_send',
    by: ['system'],
    note: 'Network or PDP outage; the job retries with the same idempotency key.',
  },
  deposited: {
    from: ['sending'],
    to: 'deposited',
    by: ['pdp', 'system'],
    note: 'The platform accepted the file (« Déposée »).',
  },
  rejected_by_pdp: {
    from: ['sending', 'deposited'],
    to: 'rejected_by_pdp',
    by: ['pdp'],
    note: 'The platform refused the file (« Rejetée »). Nothing reached the customer.',
  },
  fix: {
    from: ['rejected_by_pdp'],
    to: 'needs_fix',
    by: ['user', 'system'],
    note: 'Back to the sheet to correct the invoice.',
  },
  delivered: {
    from: ['deposited'],
    to: 'delivered',
    by: ['pdp'],
    note: 'Made available to the customer (« Mise à disposition »).',
  },
  accepted: {
    from: ['deposited', 'delivered'],
    to: 'accepted',
    by: ['pdp'],
    note: 'The customer approved it (« Approuvée »).',
  },
  refused_by_customer: {
    from: ['deposited', 'delivered'],
    to: 'refused_by_customer',
    by: ['pdp'],
    note: 'The customer refused it (« Refusée »), with a reason.',
  },
  dispute: {
    from: ['refused_by_customer'],
    to: 'disputed',
    by: ['user', 'system'],
    note: 'The refusal is being handled; chasing pauses.',
  },
  resend: {
    from: ['disputed'],
    to: 'needs_fix',
    by: ['user'],
    note: 'The user corrects the invoice and sends it again (validation runs again).',
  },
  credit_note: {
    from: ['disputed', ...AFTER_DEPOSIT],
    to: 'credited',
    by: ['user', 'system'],
    note: 'Cancelled by a credit note; after deposit this is the only way to cancel. Applied when the platform has the credit note.',
  },
  overdue: {
    from: ['delivered', 'accepted'],
    to: 'overdue',
    by: ['system'],
    note: 'Daily job: the due date has passed and no payment was recorded.',
  },
  chase: {
    from: ['overdue'],
    to: 'chasing',
    by: ['system', 'agent'],
    note: 'A chasing plan is active (CollectAgent).',
  },
  paid: {
    from: ['deposited', 'delivered', 'accepted', 'overdue', 'chasing'],
    to: 'paid',
    by: ['user', 'pdp'],
    note: 'Payment received (« Encaissée »), from the platform or recorded by the user.',
  },
  write_off: {
    from: ['overdue', 'chasing'],
    to: 'written_off',
    by: ['user'],
    note: 'The user gives up on the payment.',
  },
  cancel: {
    from: BEFORE_DEPOSIT,
    to: 'cancelled',
    by: ['user'],
    note: 'Only before the platform has the invoice; never while it is being sent.',
  },
} as const satisfies Record<string, Transition>;

export type InvoiceEvent = keyof typeof TRANSITIONS;
export const EVENTS = Object.keys(TRANSITIONS) as InvoiceEvent[];

export const TERMINAL_STATES: readonly InvoiceState[] = STATES.filter(
  (s) => !EVENTS.some((e) => (TRANSITIONS[e].from as readonly InvoiceState[]).includes(s)),
);

export type TransitionResult =
  | { ok: true; from: InvoiceState; to: InvoiceState; event: InvoiceEvent; actor: Actor }
  | { ok: false; reason: 'not_allowed_from_state' | 'actor_not_allowed' };

const kindOf = (actor: Actor): ActorKind =>
  actor.startsWith('agent:') ? 'agent' : (actor as ActorKind);

export function transition(
  from: InvoiceState,
  event: InvoiceEvent,
  actor: Actor,
): TransitionResult {
  const t: Transition = TRANSITIONS[event];
  if (!t.from.includes(from)) return { ok: false, reason: 'not_allowed_from_state' };
  if (!t.by.includes(kindOf(actor))) return { ok: false, reason: 'actor_not_allowed' };
  return { ok: true, from, to: t.to, event, actor };
}

/** Events that can fire from a state, whoever triggers them. */
export function eventsFrom(state: InvoiceState): InvoiceEvent[] {
  return EVENTS.filter((e) => (TRANSITIONS[e].from as readonly InvoiceState[]).includes(state));
}
