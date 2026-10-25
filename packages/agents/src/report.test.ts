import { NBSP } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { approvalLines, MAX_ACTIONS, type WeekFacts, weeklyReport } from './report';

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
      `Encaissé : 1${NBSP}800,00${NBSP}€, sur 2 facture(s)`,
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

  it('adds the money the checks found not invoiced this week, and stays within ten lines', () => {
    expect(weeklyReport({ ...quiet, notInvoiced: none }).numbers).toHaveLength(4);
    const r = weeklyReport({
      ...quiet,
      notInvoiced: { count: 2, amount: 80_000 },
      formalNotices: [{ number: 'F-1', payable: 10_000 }],
      refusals: ['F-7'],
      toFix: 1,
    });
    expect(r.numbers[4]).toBe(
      `Manque à facturer repéré : 2 écart(s), 800,00${NBSP}€ (onglet « Contrôles »)`,
    );
    expect(r.text.split('\n').length).toBe(10);
  });

  it('counts the requests waiting in « À valider », after the invoices to correct', () => {
    expect(weeklyReport({ ...quiet, toFix: 1, approvals: 2, toSend: 3 }).actions).toEqual([
      'Corrigez 1 facture(s) rejetée(s) ou à corriger.',
      'Validez 2 demande(s) préparée(s) pour vos fournisseurs ou vos clients : onglet « Documents », « À valider ».',
      'Envoyez 3 facture(s) prête(s).',
    ]);
  });
});

describe('the e-mail’s « À valider » (BTP stage 3C)', () => {
  it('lists each request with its links, then how many more wait in the pane', () => {
    expect(approvalLines([])).toEqual([]);
    const url = (token: string) => `https://api.test/decide?token=${token}`;
    expect(
      approvalLines(
        [
          {
            kind: 'demande_kbis',
            company: 'Plâtrerie Dumas',
            siren: null,
            dueOn: '2026-11-10',
            to: 'contact@dumas.test',
            approveUrl: url('a'),
            rejectUrl: url('b'),
          },
          {
            kind: 'relance_facture',
            company: 'Client Roux',
            siren: null,
            dueOn: null,
            to: null,
            approveUrl: null,
            rejectUrl: url('c'),
          },
          {
            kind: 'confirmer_tiers',
            company: null,
            siren: '400000006',
            dueOn: null,
            to: null,
            approveUrl: url('d'),
            rejectUrl: url('e'),
          },
        ],
        4,
      ),
    ).toEqual([
      '',
      'À valider (7) :',
      '',
      '• Demander un extrait Kbis : Plâtrerie Dumas, échéance le 10/11/2026',
      '  À : contact@dumas.test',
      `  Envoyer : ${url('a')}`,
      `  Ignorer : ${url('b')}`,
      '',
      '• Relancer une facture impayée : Client Roux',
      '  Adresse e-mail manquante : ajoutez-la dans le volet (onglet « Documents », « À valider »).',
      `  Ignorer : ${url('c')}`,
      '',
      '• Une entreprise inconnue : le SIREN 400000006, sur un document reçu. Est-ce un de vos fournisseurs ?',
      `  Ajouter comme fournisseur : ${url('d')}`,
      `  Ignorer : ${url('e')}`,
      '',
      'Et 4 autre(s) dans le volet, onglet « Documents », « À valider ».',
      '',
      "Chaque lien ouvre une page où vous confirmez d'un clic : rien ne part avant. Il sert une fois, pendant 7 jours, et il est à votre nom : ne transférez pas cet e-mail.",
    ]);
  });
});
