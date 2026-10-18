import { describe, expect, it } from 'vitest';
import {
  EVENTS,
  eventsFrom,
  type InvoiceEvent,
  type InvoiceState,
  STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  transition,
} from './state';

// The whole table, written out by hand: any change to state.ts must be reflected here on purpose.
const EXPECTED: Record<InvoiceState, Partial<Record<InvoiceEvent, InvoiceState>>> = {
  draft: { validation_passed: 'validated', validation_failed: 'needs_fix', cancel: 'cancelled' },
  needs_fix: {
    validation_passed: 'validated',
    validation_failed: 'needs_fix',
    cancel: 'cancelled',
  },
  validated: {
    validation_passed: 'validated',
    validation_failed: 'needs_fix',
    approve: 'ready_to_send',
    cancel: 'cancelled',
  },
  ready_to_send: { send: 'sending', cancel: 'cancelled' },
  sending: {
    send_interrupted: 'ready_to_send',
    deposited: 'deposited',
    rejected_by_pdp: 'rejected_by_pdp',
  },
  deposited: {
    rejected_by_pdp: 'rejected_by_pdp',
    delivered: 'delivered',
    accepted: 'accepted',
    refused_by_customer: 'refused_by_customer',
    credit_note: 'credited',
    paid: 'paid',
  },
  rejected_by_pdp: { fix: 'needs_fix' },
  delivered: {
    accepted: 'accepted',
    refused_by_customer: 'refused_by_customer',
    credit_note: 'credited',
    overdue: 'overdue',
    paid: 'paid',
  },
  refused_by_customer: { dispute: 'disputed' },
  disputed: { resend: 'needs_fix', credit_note: 'credited' },
  accepted: { credit_note: 'credited', overdue: 'overdue', paid: 'paid' },
  overdue: { credit_note: 'credited', chase: 'chasing', paid: 'paid', write_off: 'written_off' },
  chasing: { credit_note: 'credited', paid: 'paid', write_off: 'written_off' },
  paid: {},
  written_off: {},
  credited: {},
  cancelled: {},
};

describe('invoice state machine', () => {
  it('matches the expected table for every state × event pair', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        // The first allowed actor of every event is a person or a system, never an agent.
        const actor = TRANSITIONS[event].by[0];
        const result = transition(state, event, actor);
        const expected = EXPECTED[state][event];
        if (expected)
          expect(result, `${state} --${event}-->`).toMatchObject({ ok: true, to: expected });
        else
          expect(result, `${state} --${event}-->`).toEqual({
            ok: false,
            reason: 'not_allowed_from_state',
          });
      }
    }
  });

  it('reaches every state from draft', () => {
    const seen = new Set<InvoiceState>(['draft']);
    const queue: InvoiceState[] = ['draft'];
    while (queue.length) {
      const state = queue.shift() as InvoiceState;
      for (const e of eventsFrom(state)) {
        const to = TRANSITIONS[e].to;
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    expect([...seen].sort()).toEqual([...STATES].sort());
  });

  it('ends only in paid, written off, credited or cancelled', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(['cancelled', 'credited', 'paid', 'written_off']);
  });

  it('never lets an agent send, approve, resend or cancel (plan §0, §6)', () => {
    for (const event of [
      'approve',
      'send',
      'resend',
      'credit_note',
      'cancel',
      'write_off',
    ] as const) {
      for (const from of TRANSITIONS[event].from) {
        expect(transition(from, event, 'agent:monitor')).toEqual({
          ok: false,
          reason: 'actor_not_allowed',
        });
      }
    }
    expect(transition('overdue', 'chase', 'agent:collect')).toMatchObject({
      ok: true,
      to: 'chasing',
    });
  });

  it('cancels only before the platform has the invoice', () => {
    const cancellable = STATES.filter((s) => transition(s, 'cancel', 'user').ok);
    expect(cancellable).toEqual(['draft', 'needs_fix', 'validated', 'ready_to_send']);
  });

  it('only lets the platform report platform statuses', () => {
    expect(transition('deposited', 'delivered', 'user')).toEqual({
      ok: false,
      reason: 'actor_not_allowed',
    });
    expect(transition('sending', 'rejected_by_pdp', 'system')).toEqual({
      ok: false,
      reason: 'actor_not_allowed',
    });
    expect(transition('delivered', 'paid', 'user')).toMatchObject({ ok: true, to: 'paid' });
  });

  it('returns who did what', () => {
    expect(transition('ready_to_send', 'send', 'user')).toEqual({
      ok: true,
      from: 'ready_to_send',
      to: 'sending',
      event: 'send',
      actor: 'user',
    });
  });
});
