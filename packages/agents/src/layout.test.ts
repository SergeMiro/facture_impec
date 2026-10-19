import { detectLayout, grid } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { guardLayout, type LayoutAnswer, layoutPrompt, proposeLayout } from './layout';
import { Pseudonymizer } from './pseudonymize';
import {
  failingModel,
  handleFor,
  mockModel,
  testOrchestrator,
  textResult,
  toolCallResult,
} from './test-model';

const purchases = grid('Achats', [
  ['ACHATS — OCTOBRE 2026'],
  ['N° cde', 'Date', 'Frs', 'SIRET', 'Réf. frs', 'Article', 'Qté', 'PA HT'],
  ['A-301', '02/10/2026', 'Bois du Morvan', '41234567800017', 'CH-27', 'Chêne 27 mm', 12, 18.5],
  ['A-302', '09/10/2026', 'Quincaillerie Roux', '52234567800012', 'VS-4', 'Vis 4×40', 500, 0.07],
]);

const answer = (extra: Partial<LayoutAnswer> = {}): LayoutAnswer => ({
  kind: 'purchase',
  kindConfidence: 0.9,
  headerRow: 2,
  mapping: [
    { field: 'docNumber', column: 'A', confidence: 0.9 },
    { field: 'docDate', column: 'b', confidence: 0.85 },
    { field: 'partyName', column: 'C', confidence: 0.9 },
    { field: 'itemRef', column: 'E', confidence: 0.75 },
    { field: 'itemName', column: 'F', confidence: 0.9 },
    { field: 'quantity', column: 'G', confidence: 0.9 },
    { field: 'unitPrice', column: 'H', confidence: 0.9 },
  ],
  warnings: [],
  ...extra,
});

const run = async (model: Parameters<typeof handleFor>[0], tools = true) => {
  const { store, orchestrator } = testOrchestrator({ retries: 0 });
  const result = await proposeLayout(purchases, {
    tenantId: 't1',
    orchestrator,
    ai: handleFor(model, tools),
  });
  return { result, store };
};

describe('proposeLayout', () => {
  it('falls back to the header dictionary when AI is off, and says so first', async () => {
    const { orchestrator } = testOrchestrator();
    const { layout, degraded } = await proposeLayout(purchases, {
      tenantId: 't1',
      orchestrator,
      ai: null,
    });
    expect(degraded).toBe('ai_off');
    expect(layout).toMatchObject({ source: 'heuristic', kind: 'purchase', headerRow: 2 });
    expect(layout.warnings[0]).toContain("l'assistant est désactivé");
  });

  it('uses the agent answer under its own phase, flagging columns under 0.8', async () => {
    const model = mockModel(textResult(JSON.stringify(answer())));
    const { result, store } = await run(model);
    expect(result.degraded).toBeNull();
    expect(result.layout).toMatchObject({ source: 'agent', kind: 'purchase', headerRow: 2 });
    expect(result.layout.mapping.docDate).toEqual({
      column: 'B',
      confidence: 0.85,
      needsConfirmation: false,
    });
    expect(result.layout.mapping.itemRef?.needsConfirmation).toBe(true);
    expect(store.runs[0]).toMatchObject({ agent: 'layout', status: 'ok', model: 'mock-model' });
  });

  it('never shows the model the suppliers or their identifiers', async () => {
    const model = mockModel(textResult(JSON.stringify(answer())));
    await run(model);
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    for (const secret of ['Morvan', 'Roux', '41234567800017', '52234567800012'])
      expect(sent).not.toContain(secret);
    // Article references and designations stay readable: they are what the model maps.
    for (const kept of ['CH-27', 'Chêne 27 mm', 'Frs', 'PA HT']) expect(sent).toContain(kept);
  });

  it('lets the model look at a column through sampleColumn', async () => {
    const model = mockModel(
      toolCallResult('sampleColumn', { column: 'g', headerRow: 2 }),
      textResult(JSON.stringify(answer())),
    );
    const { result } = await run(model);
    expect(result.layout.source).toBe('agent');
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('"numbers":2');
  });

  it('falls back with degraded "error" when the model keeps failing', async () => {
    const { result, store } = await run(failingModel(new Error('boom')), false);
    expect(result.degraded).toBe('error');
    expect(result.layout.source).toBe('heuristic');
    expect(result.layout.warnings[0]).toContain("n'a pas répondu");
    expect(store.runs[0]).toMatchObject({ agent: 'layout', status: 'failed' });
  });
});

describe('layoutPrompt', () => {
  it('names every kind and field in French and passes the hint', () => {
    const hint = detectLayout(purchases);
    const prompt = JSON.parse(layoutPrompt(purchases, hint, 'fr-FR'));
    expect(prompt.kinds).toContainEqual({
      kind: 'purchase',
      label: 'Achats auprès de vos fournisseurs',
    });
    expect(prompt.fields).toContainEqual({ field: 'orderRef', label: 'Commande livrée' });
    expect(prompt.hint.kind).toBe('purchase');
    expect(prompt.rows[0]).toEqual({ row: 1, cells: { A: 'ACHATS — OCTOBRE 2026' } });
  });
});

describe('guardLayout', () => {
  const hint = detectLayout(purchases);

  it('drops unknown fields, bad or empty columns, and keeps one column per field', () => {
    const m = guardLayout(
      answer({
        mapping: [
          { field: 'docNumber', column: 'A', confidence: 2 },
          { field: 'colour', column: 'D', confidence: 0.9 },
          { field: 'itemName', column: 'Z', confidence: 0.9 },
          { field: 'quantity', column: '1A', confidence: 0.9 },
          { field: 'unitPrice', column: 'A', confidence: 0.6 },
          { field: 'docDate', column: 'B', confidence: Number.NaN },
          { field: 'docNumber', column: 'B', confidence: 0.5 },
        ],
      }),
      purchases,
      hint,
      new Pseudonymizer(),
    );
    expect(m.mapping.docNumber).toEqual({ column: 'A', confidence: 1, needsConfirmation: false });
    expect(m.mapping.docDate).toEqual({ column: 'B', confidence: 0, needsConfirmation: true });
    // The model's '1A' and 'Z' were refused; the dictionary's strong matches fill the gaps.
    expect(m.mapping.quantity?.column).toBe('G');
    expect(m.mapping.unitPrice?.column).toBe('H');
    expect(m.mapping.itemName?.column).toBe('F');
  });

  it('keeps the dictionary kind when the model invents one, and its row when the row is missing', () => {
    const m = guardLayout(
      answer({ kind: 'quote', kindConfidence: 0.99, headerRow: 99, mapping: [] }),
      purchases,
      hint,
      new Pseudonymizer(),
    );
    expect(m.kind).toBe(hint.kind);
    expect(m.kindConfidence).toBe(hint.kindConfidence);
    expect(m.headerRow).toBe(2);
    expect(m.mapping.docNumber?.column).toBe('A');
  });

  it('gives a price list no document fields, and adds no dictionary column of another kind', () => {
    const m = guardLayout(
      answer({ kind: 'price_list', kindConfidence: 1.5 }),
      purchases,
      hint,
      new Pseudonymizer(),
    );
    expect(m.kind).toBe('price_list');
    expect(m.kindConfidence).toBe(1);
    expect(Object.keys(m.mapping).sort()).toEqual(['itemName', 'itemRef', 'unitPrice']);
  });

  it('refuses a SIREN column whose header does not say SIREN', () => {
    const m = guardLayout(
      answer({ mapping: [{ field: 'partySiren', column: 'E', confidence: 0.9 }] }),
      purchases,
      hint,
      new Pseudonymizer(),
    );
    expect(m.mapping.partySiren?.column).toBe('D'); // the dictionary's « SIRET », not the model's E
    expect(m.warnings.some((w) => w.includes('ni de SIREN ni de SIRET'))).toBe(true);
    const ok = guardLayout(
      answer({ mapping: [{ field: 'partySiren', column: 'D', confidence: 0.9 }] }),
      purchases,
      hint,
      new Pseudonymizer(),
    );
    expect(ok.mapping.partySiren?.column).toBe('D');
  });

  it('says what an invoice sheet is, and what is missing', () => {
    const m = guardLayout(
      answer({ kind: 'invoice', mapping: [] }),
      purchases,
      hint,
      new Pseudonymizer(),
    );
    expect(m.warnings[0]).toContain('feuille de factures');
    const missing = guardLayout(
      answer({ mapping: [{ field: 'itemName', column: 'F', confidence: 0.9 }] }),
      grid('Achats', [
        ['Article', 'Note'],
        ['Chêne', 'x'],
      ]),
      detectLayout(grid('Feuil1', [['A'], ['B']])),
      new Pseudonymizer(),
    );
    expect(missing.warnings.some((w) => w.includes('Numéro du document'))).toBe(true);
  });

  it('re-hydrates the model warnings and drops those with invented tokens', () => {
    const p = new Pseudonymizer();
    const token = p.token('PARTY', 'Bois du Morvan');
    const m = guardLayout(
      answer({ warnings: [`Vérifiez ${token}.`, 'Voir {{PARTY_9}}', '  ', 'x'.repeat(400)] }),
      purchases,
      hint,
      p,
    );
    expect(m.warnings).toContain('Vérifiez Bois du Morvan.');
    expect(m.warnings.some((w) => w.includes('PARTY_9'))).toBe(false);
    expect(m.warnings.find((w) => w.startsWith('xxx'))).toHaveLength(300);
  });
});
