import { detectMapping, grid } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { guardMapping, type MappingAnswer, proposeMapping } from './mapping';
import { Pseudonymizer } from './pseudonymize';
import {
  failingModel,
  handleFor,
  mockModel,
  testOrchestrator,
  textResult,
  toolCallResult,
} from './test-model';

const sheet = grid('Factures', [
  ['Ventes octobre'],
  ['Fact.', 'Dt', 'Cli.', 'Code', 'Prest.', 'Nb', 'P.U.', 'Tx', 'Ident.'],
  [
    '2026-118',
    '01/10/2026',
    'Menuiserie Girard',
    '100245871',
    'Pose parquet',
    35,
    28,
    10,
    '260000006',
  ],
  [
    '2026-119',
    '15/10/2026',
    'Boucherie Faure',
    '100245872',
    'Étagères chêne',
    4,
    210,
    20,
    '270000007',
  ],
]);

const answer = (extra: Partial<MappingAnswer> = {}): MappingAnswer => ({
  headerRow: 2,
  mapping: [
    { field: 'number', column: 'A', confidence: 0.9 },
    { field: 'issueDate', column: 'b', confidence: 0.85 },
    { field: 'buyerName', column: 'C', confidence: 0.9 },
    { field: 'itemName', column: 'E', confidence: 0.75 },
    { field: 'quantity', column: 'F', confidence: 0.8 },
    { field: 'unitPrice', column: 'G', confidence: 0.85 },
    { field: 'vatRate', column: 'H', confidence: 0.9 },
  ],
  groupingColumn: null,
  warnings: [],
  ...extra,
});

const run = async (model: Parameters<typeof handleFor>[0], tools = true) => {
  const { store, orchestrator } = testOrchestrator({ retries: 0 });
  const result = await proposeMapping(sheet, {
    tenantId: 't1',
    orchestrator,
    ai: handleFor(model, tools),
  });
  return { result, store };
};

describe('proposeMapping', () => {
  it('falls back to the header dictionary when AI is off, and says so first', async () => {
    const { orchestrator } = testOrchestrator();
    const { mapping, degraded } = await proposeMapping(sheet, {
      tenantId: 't1',
      orchestrator,
      ai: null,
    });
    expect(degraded).toBe('ai_off');
    expect(mapping.source).toBe('heuristic');
    expect(mapping.warnings[0]).toContain("l'assistant est désactivé");
  });

  it('uses the agent answer, flagging columns under 0.8 for confirmation', async () => {
    const model = mockModel(textResult(JSON.stringify(answer())));
    const { result, store } = await run(model);
    expect(result.degraded).toBeNull();
    expect(result.mapping).toMatchObject({ source: 'agent', headerRow: 2, grouping: null });
    expect(result.mapping.mapping.issueDate).toEqual({
      column: 'B',
      confidence: 0.85,
      needsConfirmation: false,
    });
    expect(result.mapping.mapping.itemName?.needsConfirmation).toBe(true);
    // No SIREN column was named, and the warning for it comes from the code, not the model.
    expect(result.mapping.warnings).toEqual([
      'Colonne introuvable : SIREN du client. Indiquez-la si votre feuille la contient.',
    ]);
    expect(store.runs[0]).toMatchObject({ agent: 'mapping', status: 'ok', model: 'mock-model' });
  });

  it('never shows the model names or identifiers from the sheet', async () => {
    const model = mockModel(textResult(JSON.stringify(answer())));
    await run(model);
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    for (const secret of ['Girard', 'Faure', '260000006', '270000007'])
      expect(sent).not.toContain(secret);
    expect(sent).toContain('Pose parquet');
    expect(sent).toContain('Fact.');
  });

  it('lets the model look at a column through sampleColumn', async () => {
    const model = mockModel(
      toolCallResult('sampleColumn', { column: 'f', headerRow: 2 }),
      textResult(JSON.stringify(answer())),
    );
    const { result } = await run(model);
    expect(result.mapping.source).toBe('agent');
    const second = JSON.stringify(model.doGenerateCalls[1]?.prompt);
    expect(second).toContain('"filled":2');
    expect(second).toContain('"numbers":2');
  });

  it('falls back with degraded "error" when the model keeps failing', async () => {
    const { result, store } = await run(failingModel(new Error('boom')), false);
    expect(result.degraded).toBe('error');
    expect(result.mapping.source).toBe('heuristic');
    expect(result.mapping.warnings[0]).toContain("n'a pas répondu");
    expect(store.runs[0]?.status).toBe('failed');
  });
});

describe('guardMapping', () => {
  const hint = detectMapping(sheet);

  it('drops unknown fields, bad or empty columns, and keeps one column per field', () => {
    const m = guardMapping(
      answer({
        mapping: [
          { field: 'number', column: 'A', confidence: 2 },
          { field: 'colour', column: 'D', confidence: 0.9 },
          { field: 'itemName', column: 'Z', confidence: 0.9 },
          { field: 'quantity', column: '1A', confidence: 0.9 },
          { field: 'unitPrice', column: 'A', confidence: 0.6 },
          { field: 'issueDate', column: 'B', confidence: Number.NaN },
          { field: 'number', column: 'B', confidence: 0.5 },
        ],
      }),
      sheet,
      hint,
      new Pseudonymizer(),
    );
    expect(m.mapping.number).toEqual({ column: 'A', confidence: 1, needsConfirmation: false });
    // The model's price column was taken; the dictionary's strong « P.U. » match fills the gap.
    expect(m.mapping.unitPrice).toEqual({
      column: 'G',
      confidence: 0.95,
      needsConfirmation: false,
    });
    expect(m.mapping.itemName).toBeUndefined();
    expect(m.mapping.quantity?.column).toBe('F'); // « Nb »: the dictionary again, the model's '1A' was refused
    expect(m.mapping.issueDate).toEqual({ column: 'B', confidence: 0, needsConfirmation: true });
  });

  it('puts a percentage discount in the percent field, and euros in the euros one', () => {
    const withDiscount = grid('Factures', [
      ['N° facture', 'Désignation', 'Qté', 'PU HT', 'Réduc.', 'Remise'],
      ['F1', 'Pose', 2, 50, { v: 0.1, t: '10%', f: '0%' }, '5 %'],
    ]);
    const m = guardMapping(
      answer({ headerRow: 1, mapping: [{ field: 'lineDiscount', column: 'E', confidence: 0.9 }] }),
      withDiscount,
      detectMapping(withDiscount),
      new Pseudonymizer(),
    );
    expect(m.mapping.lineDiscount).toBeUndefined();
    expect(m.mapping.lineDiscountPercent).toMatchObject({ column: 'E', confidence: 0.9 });
    expect(m.warnings.filter((w) => w.includes('pourcentage'))).toEqual([]);

    const inEuros = grid('Factures', [
      ['N° facture', 'Désignation', 'Qté', 'PU HT', 'Remise'],
      ['F1', 'Pose', 2, 50, 10],
    ]);
    const e = guardMapping(
      answer({
        headerRow: 1,
        mapping: [{ field: 'lineDiscountPercent', column: 'E', confidence: 0.9 }],
      }),
      inEuros,
      detectMapping(inEuros),
      new Pseudonymizer(),
    );
    expect(e.mapping.lineDiscount?.column).toBe('E');
    expect(e.mapping.lineDiscountPercent).toBeUndefined();
  });

  it('refuses a SIREN column whose header does not say SIREN', () => {
    const m = guardMapping(
      answer({
        mapping: [
          { field: 'buyerSiren', column: 'I', confidence: 0.9 },
          { field: 'buyerSiret', column: 'D', confidence: 0.9 },
        ],
      }),
      sheet,
      hint,
      new Pseudonymizer(),
    );
    expect(m.mapping.buyerSiren).toBeUndefined();
    expect(m.mapping.buyerSiret).toBeUndefined();
    expect(m.warnings.filter((w) => w.includes('ni de SIREN ni de SIRET'))).toHaveLength(2);
    const withHeader = grid('S', [
      ['N° facture', 'Client', 'N° SIREN'],
      ['F1', 'X', '200000008'],
    ]);
    const ok = guardMapping(
      answer({ headerRow: 1, mapping: [{ field: 'buyerSiren', column: 'C', confidence: 0.9 }] }),
      withHeader,
      detectMapping(withHeader),
      new Pseudonymizer(),
    );
    expect(ok.mapping.buyerSiren?.column).toBe('C');
  });

  it('keeps the hint header row when the model names a row that does not exist, and adds strong hint columns', () => {
    const clean = grid('S', [
      ['N° facture', 'Date', 'Client', 'Désignation'],
      ['F1', '01/10/2026', 'X', 'Y'],
      ['F1', '01/10/2026', 'X', 'Z'],
    ]);
    const m = guardMapping(
      answer({ headerRow: 99, mapping: [], groupingColumn: 'Q' }),
      clean,
      detectMapping(clean),
      new Pseudonymizer(),
    );
    expect(m.headerRow).toBe(1);
    expect(m.mapping.number?.column).toBe('A');
    expect(m.mapping.itemName?.column).toBe('D');
    expect(m.grouping).toEqual({ by: 'A' });
  });

  it('accepts the model grouping column when the data alone shows none', () => {
    const m = guardMapping(answer({ groupingColumn: ' d ' }), sheet, hint, new Pseudonymizer());
    expect(m.grouping).toEqual({ by: 'D' });
  });

  it('re-hydrates the model warnings and drops those with invented tokens', () => {
    const p = new Pseudonymizer();
    const token = p.token('PARTY', 'Menuiserie Girard');
    const m = guardMapping(
      answer({ warnings: [`Vérifiez ${token}.`, 'Voir {{PARTY_9}}', '  ', 'x'.repeat(400)] }),
      sheet,
      hint,
      p,
    );
    expect(m.warnings).toContain('Vérifiez Menuiserie Girard.');
    expect(m.warnings.some((w) => w.includes('PARTY_9'))).toBe(false);
    expect(m.warnings.find((w) => w.startsWith('xxx'))).toHaveLength(300);
  });
});
