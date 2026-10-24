import { describe, expect, it } from 'vitest';
import { eventText } from './InvoiceView';

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
