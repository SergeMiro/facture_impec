import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { classifyByRules, classifyDocument, classifyPrompt } from './classify';
import { Pseudonymizer } from './pseudonymize';
import { failingModel, handleFor, mockModel, testOrchestrator, textResult } from './test-model';

const doc = (text: string, name = 'scan0042.pdf', subject?: string) => ({ text, name, subject });

/** A text the patterns cannot place: the model must say. */
const vague = doc(
  'Suite à notre rendez-vous sur le chantier de la rue des Tanneurs, veuillez trouver les éléments demandés.',
);

function ctx(...answers: unknown[]) {
  const { orchestrator, store } = testOrchestrator({ retries: 2 });
  const model = mockModel(...answers.map((a) => textResult(JSON.stringify(a))));
  return {
    store,
    model,
    ctx: { tenantId: 't', orchestrator, ai: handleFor(model, false), known: ['Maçonnerie Durand'] },
  };
}

describe('the classifier rules', () => {
  it('take the kind named in the first lines, the most specific first', () => {
    const cases: [string, string][] = [
      ['URSSAF\nATTESTATION DE VIGILANCE\nDélivrée le 12/03/2026', 'attestation_vigilance'],
      ['Extrait Kbis\nGreffe du tribunal de commerce de Dijon', 'kbis'],
      [
        'Attestation d’assurance\nResponsabilité civile et décennale',
        'attestation_assurance_decennale',
      ],
      [
        'ATTESTATION D’ASSURANCE\nResponsabilité civile professionnelle',
        'attestation_assurance_rc',
      ],
      ['FACTURE DE SITUATION N° 3\nChantier Tanneurs', 'situation'],
      ['AVOIR N° A-2026-004\nSur facture F-2026-118', 'avoir'],
      ['DEVIS N° 2026-45\nRénovation façade', 'devis'],
      ['FACTURE N° F-2026-118\nNet à payer', 'facture'],
      ['PROCÈS-VERBAL DE RÉCEPTION DES TRAVAUX', 'pv_reception'],
      ['Décompte général et définitif\nMarché n° 24-118', 'dgd'],
      ['CONTRAT DE SOUS-TRAITANCE\nEntre les soussignés', 'contrat_sous_traitance'],
      ['Contrat de travail à durée indéterminée', 'contrat_travail'],
      ['Liste nominative des salariés étrangers', 'liste_salaries_etrangers'],
      ['BON DE LIVRAISON N° 4471', 'autre'],
    ];
    for (const [text, label] of cases) {
      expect(classifyByRules(doc(text)), text).toEqual({ label, confidence: 0.95, where: 'title' });
    }
  });

  it('read the file name as a title, the subject only as a body hint', () => {
    expect(classifyByRules(doc('', 'Kbis_Dupont-2026.pdf'))?.label).toBe('kbis');
    expect(classifyByRules(doc('Page 1/1', 'scan.pdf', 'Votre attestation de vigilance'))).toBe(
      null,
    );
  });

  it('answer from the body only when one kind alone matches there', () => {
    const body = `${'Monsieur,\n'.repeat(80)}Le maître d’ouvrage prononce la réception des ouvrages.`;
    expect(classifyByRules(doc(body))).toEqual({
      label: 'pv_reception',
      confidence: 0.75,
      where: 'body',
    });
    // A contract's body names the attestation it asks for: two kinds, no answer.
    const contract = `${'Article.\n'.repeat(80)}Le sous-traitant s’engage à fournir tous les six mois une attestation. L’URSSAF atteste…`;
    expect(classifyByRules(doc(contract))).toBe(null);
  });
});

describe('the classifier', () => {
  it('needs no model when the title says it', async () => {
    const { ctx: c, model } = ctx({ kind: 'autre', confidence: 0.9 });
    const r = await classifyDocument(doc('ATTESTATION DE VIGILANCE'), c);
    expect(r).toEqual({
      label: 'attestation_vigilance',
      confidence: 0.95,
      source: 'rules',
      degraded: null,
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('asks the model otherwise, and a person when the model doubts', async () => {
    const sure = await classifyDocument(vague, ctx({ kind: 'devis', confidence: 0.82 }).ctx);
    expect(sure).toEqual({ label: 'devis', confidence: 0.82, source: 'agent', degraded: null });
    const unsure = await classifyDocument(vague, ctx({ kind: 'devis', confidence: 0.5 }).ctx);
    expect(unsure).toEqual({ label: null, confidence: 0.5, source: 'agent', degraded: 'unsure' });
  });

  it('never sends a SIREN, an e-mail or a company name to the model', async () => {
    const { ctx: c, model } = ctx({ kind: 'autre', confidence: 0.9 });
    await classifyDocument(
      doc(
        'Maçonnerie Durand, SIREN 200 000 008, écrit à compta@atelier-dupont.fr pour Atelier Dupont SARL.',
        'durand-200000008.pdf',
        'De la part de Maçonnerie Durand',
      ),
      c,
    );
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    for (const secret of ['200 000 008', '200000008', 'compta@', 'Dupont SARL', 'Durand']) {
      expect(sent).not.toContain(secret);
    }
    expect(sent).toContain('{{PARTY_1}}');
  });

  it('reads at most the first 2 000 characters', () => {
    const prompt = classifyPrompt(doc(`DÉBUT ${'x'.repeat(5000)} FIN`), new Pseudonymizer());
    expect(prompt).toContain('DÉBUT');
    expect(prompt).not.toContain('FIN');
    expect((JSON.parse(prompt) as { text: string }).text).toHaveLength(2000);
  });

  it('sends a malformed answer to a person at once, without asking again', async () => {
    const { ctx: c, model, store } = ctx({ kind: 'invoice', confidence: 2 });
    const r = await classifyDocument(vague, c);
    expect(r).toEqual({ label: null, confidence: 0, source: 'none', degraded: 'error' });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(store.runs.at(-1)).toMatchObject({ agent: 'classify', status: 'failed', attempts: 1 });
  });

  it('asks again after a provider error, then falls back to the body pattern', async () => {
    const { orchestrator } = testOrchestrator({ retries: 2 });
    const overloaded = new APICallError({
      message: 'overloaded',
      url: 'https://x',
      requestBodyValues: {},
      statusCode: 529,
      isRetryable: true,
    });
    const model = failingModel(overloaded);
    const body = `${'Madame,\n'.repeat(80)}Le maître d’ouvrage prononce la réception des ouvrages.`;
    const r = await classifyDocument(doc(body), {
      tenantId: 't',
      orchestrator,
      ai: handleFor(model, false),
    });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(r).toEqual({
      label: 'pv_reception',
      confidence: 0.75,
      source: 'rules',
      degraded: 'error',
    });
  });

  it('works on the rules alone with the AI off', async () => {
    const { orchestrator } = testOrchestrator();
    const off = { tenantId: 't', orchestrator, ai: null };
    expect(await classifyDocument(doc('Extrait Kbis'), off)).toMatchObject({ label: 'kbis' });
    expect(await classifyDocument(vague, off)).toEqual({
      label: null,
      confidence: 0,
      source: 'none',
      degraded: 'ai_off',
    });
  });
});
