import { describe, expect, it } from 'vitest';
import { eventText } from './InvoiceView';

const note = (payload: unknown) => ({
  at: '2026-10-24T09:00:00.000Z',
  type: 'note',
  actor: 'agent:party',
  event: 'vat_check',
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
});
