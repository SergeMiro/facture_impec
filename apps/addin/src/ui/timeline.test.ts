import { describe, expect, it } from 'vitest';
import { centsOf } from './ChasePanel';
import { resultLine } from './InvoiceSearch';
import { eventText, viesHolder } from './InvoiceView';

const note = (payload: unknown, event = 'vat_check', actor = 'agent:party') => ({
  at: '2026-10-24T09:00:00.000Z',
  type: 'note',
  actor,
  event,
  fromStatus: null,
  toStatus: null,
  payload,
});

describe('the invoice timeline', () => {
  it('tells what VIES answered on the customer number, with its consultation number', () => {
    expect(
      eventText(note({ vatId: 'DE129273398', valid: true, requestIdentifier: 'WAPIDEMO00000001' })),
    ).toBe(
      "Numéro de TVA DE129273398 de votre client vérifié dans le service européen VIES : valide (consultation n° WAPIDEMO00000001) · par l'assistant",
    );
    expect(eventText(note({ vatId: 'DE999999999', valid: false, requestIdentifier: null }))).toBe(
      "Numéro de TVA DE999999999 de votre client vérifié dans le service européen VIES : non valide · par l'assistant",
    );
  });

  it('says who VIES has at the number on one line, and who asked on « Vérifier dans VIES »', () => {
    expect(
      viesHolder({
        name: 'SOCIETE DE DEMONSTRATION 5245',
        address: '1 RUE DES EXEMPLES\n1000 EXEMPLEVILLE\n',
      }),
    ).toBe('SOCIETE DE DEMONSTRATION 5245, 1 RUE DES EXEMPLES, 1000 EXEMPLEVILLE');
    expect(viesHolder({ name: null, address: null })).toBe('');
    expect(
      eventText(
        note({ vatId: 'LU26375245', valid: true, requestIdentifier: null }, 'vat_check', 'user'),
      ),
    ).toBe(
      'Numéro de TVA LU26375245 de votre client vérifié dans le service européen VIES : valide · par vous',
    );
  });

  it('tells an instalment with what is left, and a credit note stopped by one', () => {
    const part = note(
      { paidOn: '2026-10-24', amount: 40_000, paid: 40_000, left: 80_000 },
      'payment_partial',
      'user',
    );
    expect(eventText(part)).toBe(
      'Paiement reçu : 400,00\u00a0€. Reste à payer : 800,00\u00a0€ · par vous',
    );
    const stopped = note(
      { number: 'AV2026-0001', status: 'chasing', paid: 40_000 },
      'credit_note_not_applied',
      'system',
    );
    expect(eventText(stopped)).toContain('votre client en avait déjà payé 400,00\u00a0€');
  });

  it('shows a search result with its kind, customer, amount, date and Mode test', () => {
    const base = {
      id: 'i1',
      number: 'AV2026-0001',
      typeCode: '381',
      status: 'validated',
      statusLabel: 'Prête à envoyer',
      issueDate: '2026-10-24',
      dueDate: null,
      currency: 'EUR',
      buyerName: 'Boulangerie Martin',
      payable: 120_000,
      amountPaid: 0,
      pdpRef: null,
      isTest: true,
      partyId: null,
      autopilot: { at: null, held: false },
      excelBinding: null,
    };
    expect(resultLine(base)).toBe(
      'Avoir · Boulangerie Martin · 1\u00a0200,00\u00a0€ · 24/10/2026 · Test',
    );
    expect(resultLine({ ...base, typeCode: '380', isTest: false, buyerName: null })).toBe(
      '1\u00a0200,00\u00a0€ · 24/10/2026',
    );
  });

  it('reads the amount received as the user types it', () => {
    expect(centsOf('1 200,50')).toBe(120_050);
    expect(centsOf('300 €')).toBe(30_000);
    expect(centsOf('12.5')).toBe(1_250);
    for (const bad of ['', '0', '-5', '12,345', 'dix']) expect(centsOf(bad)).toBeNull();
  });

  it('names the credit note on its invoice, and the invoice on its credit note', () => {
    const drafted = note({ number: 'AV2026-0001' }, 'credit_note_drafted', 'user');
    expect(eventText(drafted)).toBe(
      'Avoir AV2026-0001 préparé : il annulera cette facture une fois transmis · par vous',
    );
    expect(eventText(note({ number: 'F2026-0042' }, 'credit_note_of', 'user'))).toBe(
      'Avoir de la facture F2026-0042 · par vous',
    );
    const late = note(
      { number: 'AV2026-0001', status: 'paid' },
      'credit_note_not_applied',
      'system',
    );
    expect(eventText(late)).toContain('elle était déjà « Payée »');
  });

  it('never advises resending a refused invoice under its number', () => {
    const advice = (kind: string) =>
      eventText(note({ kind, proposal: 'fix_and_resend' }, 'monitor', 'agent:monitor'));
    expect(advice('rejection')).toContain('Corriger et renvoyer');
    expect(advice('refusal')).toContain('un avoir, puis une nouvelle facture');
  });
});
