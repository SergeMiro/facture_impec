import { NBSP } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { MAX_ACTIONS, type WeekFacts, weeklyReport } from './report';

const none = { count: 0, amount: 0 };
const quiet: WeekFacts = {
  from: '2026-10-12',
  to: '2026-10-18',
  currency: 'EUR',
  sent: { count: 4, amount: 512_000 },
  paid: { count: 2, amount: 180_000 },
  overdue: none,
  atRisk: { count: 1, amount: 99_000 },
  formalNotices: [],
  refusals: [],
  toFix: 0,
  drafts: 0,
  toSend: 0,
};

describe('ReportAgent', () => {
  it('gives the four numbers of the week and says when nothing is to do', () => {
    const r = weeklyReport(quiet);
    expect(r.subject).toContain('12/10/2026');
    expect(r.numbers).toEqual([
      `Envoyées : 4 facture(s), 5${NBSP}120,00${NBSP}€`,
      `Encaissées : 2 facture(s), 1${NBSP}800,00${NBSP}€`,
      `En retard : 0 facture(s), 0,00${NBSP}€`,
      `À échéance dans les 7 jours : 1 facture(s), 990,00${NBSP}€`,
    ]);
    expect(r.actions).toEqual([]);
    expect(r.text.split('\n')).toHaveLength(6);
    expect(r.text).toContain('Rien à faire');
  });

  it('puts the formal notices first, the largest first, and stops at three actions', () => {
    const r = weeklyReport({
      ...quiet,
      formalNotices: [
        { number: 'F-1', payable: 10_000 },
        { number: 'F-2', payable: 250_000 },
      ],
      refusals: ['F-7', 'F-9'],
      toFix: 1,
      drafts: 3,
      toSend: 5,
    });
    expect(r.actions).toHaveLength(MAX_ACTIONS);
    expect(r.actions[0]).toContain('F-2');
    expect(r.actions[1]).toContain('F-1');
    expect(r.actions[2]).toBe('Répondez aux refus de vos clients sur 2 factures.');
    expect(r.text.split('\n').length).toBeLessThanOrEqual(10);
  });

  it('names a single refusal, then the fixes, drafts and invoices to send', () => {
    const r = weeklyReport({ ...quiet, refusals: ['F-7'], toFix: 2, drafts: 1, toSend: 4 });
    expect(r.actions).toEqual([
      'Répondez au refus de votre client sur la facture F-7.',
      'Corrigez 2 facture(s) rejetée(s) ou à corriger.',
      'Envoyez 1 relance(s) préparée(s).',
    ]);
    expect(weeklyReport({ ...quiet, toSend: 4 }).actions).toEqual([
      'Envoyez 4 facture(s) prête(s).',
    ]);
  });
});
