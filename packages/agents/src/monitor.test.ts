import { NBSP } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { adviseNext, amountsIn, type MonitorInvoice, monitorPrompt, rulesIn } from './monitor';
import { Pseudonymizer } from './pseudonymize';
import { failingModel, handleFor, mockModel, testOrchestrator, textResult } from './test-model';

const invoice: MonitorInvoice = {
  number: 'F2026-0107',
  issueDate: '2026-10-05',
  dueDate: '2026-11-04',
  payable: 240_000,
  currency: 'EUR',
  seller: 'Atelier Dupont SARL',
  customer: 'Hôtel du Port SAS',
  to: 'compta@exemple-client.fr',
};
const refusal = { kind: 'refusal' as const, reason: { code: 'DOUBLON', text: 'Déjà reçue.' } };

function ctx(answer: unknown) {
  const { orchestrator, store } = testOrchestrator({ retries: 0 });
  return {
    store,
    ctx: {
      tenantId: 't',
      orchestrator,
      ai: handleFor(mockModel(textResult(JSON.stringify(answer))), false),
    },
  };
}

const good = {
  proposal: 'credit_note',
  why: 'Votre client signale un doublon : un avoir annule cette facture.',
  draft_body: `Bonjour,\n\nNous établissons un avoir de 2${NBSP}400,00 € pour la facture F2026-0107.\n\nCordialement,\n{{PARTY_1}}`,
};

describe('MonitorAgent', () => {
  it('reads the rule ids of a platform rejection by code, and proposes fix and resend', async () => {
    const errors = [
      { rule: 'BR-FR-02', message: 'Invalid invoice number' },
      { rule: 'schematron', message: '[BR-CO-10] Sum of line net amounts mismatch; see BR-FR-02' },
      { rule: 'REJ_SEMAN', message: 'Something else' },
    ];
    expect(rulesIn(errors)).toEqual(['BR-FR-02', 'BR-CO-10']);
    const { advice } = await adviseNext(invoice, { kind: 'rejection', errors }, ctx(good).ctx);
    expect(advice).toMatchObject({ proposal: 'fix_and_resend', source: 'rules', draft: null });
    expect(advice.why).toContain('BR-FR-02, BR-CO-10');
  });

  it('never sends a party name or e-mail to the model', () => {
    const p = new Pseudonymizer();
    const prompt = monitorPrompt(
      invoice,
      { kind: 'refusal', reason: { text: 'Écrire à compta@exemple-client.fr, Hôtel du Port SAS' } },
      p,
    );
    expect(prompt).not.toContain('Atelier Dupont');
    expect(prompt).not.toContain('Hôtel du Port');
    expect(prompt).not.toContain('compta@');
    expect(prompt).toContain(`2${NBSP}400,00`);
  });

  it("keeps a model's proposal and draft once checked, with the real seller name", async () => {
    const { advice } = await adviseNext(invoice, refusal, ctx(good).ctx);
    expect(advice).toMatchObject({ proposal: 'credit_note', source: 'agent', degraded: null });
    expect(advice.draft).toMatchObject({ to: 'compta@exemple-client.fr' });
    expect(advice.draft?.subject).toContain('F2026-0107');
    expect(advice.draft?.body).toContain('Atelier Dupont SARL');
  });

  it('falls back to the three options on a wrong amount or an invented token', async () => {
    const wrong = {
      ...good,
      draft_body: 'Bonjour,\n\nNous vous devons 2 000,00 €.\n\n{{PARTY_1}}',
    };
    const r1 = await adviseNext(invoice, refusal, ctx(wrong).ctx);
    expect(r1.advice).toMatchObject({ proposal: null, source: 'rules' });
    expect(r1.rejected.wrongAmount).toBe(1);
    const invented = { ...good, why: 'Appelez {{PERSON_9}}.' };
    const r2 = await adviseNext(invoice, refusal, ctx(invented).ctx);
    expect(r2.advice.proposal).toBeNull();
    expect(r2.rejected.unknownTokens).toBe(1);
    expect(r2.advice.draft?.body).toContain('« Déjà reçue. »');
  });

  it('offers the three options with a template draft when the AI is off or fails', async () => {
    const { orchestrator } = testOrchestrator({ retries: 0 });
    const off = await adviseNext(invoice, refusal, { tenantId: 't', orchestrator, ai: null });
    expect(off.advice).toMatchObject({ proposal: null, degraded: 'ai_off' });
    expect(off.advice.why).toContain('Trois possibilités');
    const failed = await adviseNext(invoice, refusal, {
      tenantId: 't',
      orchestrator,
      ai: handleFor(failingModel(new Error('boom')), false),
    });
    expect(failed.advice).toMatchObject({ proposal: null, degraded: 'error' });
    expect(failed.advice.draft?.body).toContain(`2${NBSP}400,00`);
  });

  it('finds every amount written in a draft', () => {
    expect(amountsIn(`soit 2${NBSP}400,00 € TTC, 1234.5 EUR et 40 euros`)).toEqual([
      240_000, 123_450, 4_000,
    ]);
    expect(amountsIn('facture F2026-0107 du 05/10/2026')).toEqual([]);
  });
});
