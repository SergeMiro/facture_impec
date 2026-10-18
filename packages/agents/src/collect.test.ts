import { CHASE_KINDS, type ChaseKind, NBSP } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { type AutopilotPolicy, autopilotDecision, type ChaseFacts, draftChase } from './collect';

const facts = (kind: ChaseKind, extra: Partial<ChaseFacts> = {}): ChaseFacts => ({
  kind,
  number: 'F2026-0042',
  issueDate: '2026-10-17',
  dueDate: '2026-11-16',
  today: '2026-12-16',
  payable: 123_456,
  currency: 'EUR',
  seller: 'Atelier Dupont SARL',
  to: 'compta@martin.fr',
  isTest: false,
  ...extra,
});

const autopilot: AutopilotPolicy = { mode: 'autopilot', maxAmount: 500_000, mailer: true };
const invoice: { payable: number; isTest: boolean; to: string | null } = {
  payable: 123_456,
  isTest: false,
  to: 'compta@martin.fr',
};

describe('CollectAgent drafts', () => {
  it('write the number, amount and dates from the invoice, never a placeholder', () => {
    for (const kind of CHASE_KINDS) {
      const d = draftChase(facts(kind));
      expect(d.to).toBe('compta@martin.fr');
      expect(`${d.subject}\n${d.body}`).not.toMatch(/\{\w+\}/);
      expect(d.subject).toContain('F2026-0042');
      expect(d.body).toContain(`1${NBSP}234,56`);
      expect(d.body).toContain('Atelier Dupont SARL');
    }
    expect(draftChase(facts('courtesy', { today: '2026-11-13' })).body).toContain('16/11/2026');
  });

  it('count the days late, and quote the law only from the firm step on', () => {
    expect(draftChase(facts('firm', { today: '2026-12-01' })).subject).toContain('15 jours');
    expect(draftChase(facts('formal_notice')).body).toContain('30 jours de retard');
    expect(draftChase(facts('formal_notice')).body).toContain('mettons en demeure');
    expect(draftChase(facts('reminder')).body).not.toContain('L441-10');
    expect(draftChase(facts('firm')).body).toContain('L441-10');
  });

  it('mark a test invoice draft as a test', () => {
    expect(draftChase(facts('reminder', { isTest: true })).subject).toMatch(/^\[TEST\] /);
  });
});

describe('CollectAgent autopilot guardrail', () => {
  it('never sends a formal notice, whatever the settings (plan §6)', () => {
    const generous: AutopilotPolicy = {
      mode: 'autopilot',
      maxAmount: Number.MAX_SAFE_INTEGER,
      mailer: true,
    };
    expect(autopilotDecision('formal_notice', generous, invoice)).toEqual({
      send: false,
      reason: 'formal_notice',
    });
  });

  it('sends courtesy, reminder and firm steps in autopilot, under the ceiling', () => {
    for (const kind of ['courtesy', 'reminder', 'firm'] as const) {
      expect(autopilotDecision(kind, autopilot, invoice)).toEqual({ send: true });
    }
    expect(autopilotDecision('firm', autopilot, { ...invoice, payable: 500_000 })).toEqual({
      send: true,
    });
  });

  it('leaves a draft, with its reason, in every other case', () => {
    const why = (policy: Partial<AutopilotPolicy>, inv: Partial<typeof invoice> = {}) =>
      autopilotDecision('reminder', { ...autopilot, ...policy }, { ...invoice, ...inv });
    expect(why({ mode: 'review' })).toEqual({ send: false, reason: 'review' });
    expect(why({}, { isTest: true })).toEqual({ send: false, reason: 'test' });
    expect(why({ mailer: false })).toEqual({ send: false, reason: 'no_mailer' });
    expect(why({}, { payable: 500_001 })).toEqual({ send: false, reason: 'ceiling' });
    expect(why({ maxAmount: null })).toEqual({ send: false, reason: 'ceiling' });
    expect(why({}, { to: null })).toEqual({ send: false, reason: 'no_recipient' });
  });
});
