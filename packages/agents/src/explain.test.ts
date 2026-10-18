import type { Invoice, Issue } from '@fi/core';
import { validate } from '@fi/core';
import { buildCase, invalidCases } from '@fi/core/testing';
import { describe, expect, it } from 'vitest';
import {
  autoFixFor,
  type ExplainAnswer,
  explainDegradedNote,
  explainIssues,
  valueAt,
} from './explain';
import { failingModel, handleFor, mockModel, testOrchestrator, textResult } from './test-model';

function fromRule(rule: string): { invoice: Invoice; issues: Issue[] } {
  const c = invalidCases.find((x) => x.rule === rule);
  if (!c) throw new Error(rule);
  const { invoice, context } = buildCase(c);
  return { invoice, issues: validate(invoice, context) };
}

const vat = fromRule('FF-FMT-02');
const iban = fromRule('FF-IBAN-01');

const explanation = (
  index: number,
  extra: Partial<ExplainAnswer['explanations'][number]> = {},
) => ({
  index,
  message_fr: 'Le numéro de TVA de votre client contient des espaces.',
  why_it_matters: 'La plateforme refuserait la facture.',
  fix_steps: ['Ouvrez la cellule.', 'Retirez les espaces.'],
  auto_fix_value: null,
  ...extra,
});

const run = async (invoice: Invoice, issues: Issue[], answer: unknown) => {
  const model = mockModel(textResult(JSON.stringify(answer)));
  const { orchestrator, store } = testOrchestrator({ retries: 0 });
  const result = await explainIssues(invoice, issues, {
    tenantId: 't1',
    invoiceId: 'inv-1',
    orchestrator,
    ai: handleFor(model),
    cellFor: (path) => (path === 'buyer.vatId' ? "'Factures'!F7" : null),
  });
  return { result, model, store };
};

describe('valueAt and autoFixFor', () => {
  it('read a value by path', () => {
    expect(valueAt({ lines: [{ vat: { rate: '5,5' } }] }, 'lines[0].vat.rate')).toBe('5,5');
    expect(valueAt({ a: 1 }, 'a')).toBeUndefined();
    expect(valueAt({ a: null }, 'a.b')).toBeUndefined();
  });

  it('fix formatting only, never amounts, never a non-fixable rule', () => {
    const fix = (rule: string) => {
      const { invoice, issues } = fromRule(rule);
      const issue = issues.find((i) => i.ruleId === rule);
      if (!issue) throw new Error(rule);
      return autoFixFor(issue, invoice);
    };
    expect(fix('FF-FMT-01')).toBe('F2026-0042');
    expect(fix('FF-FMT-02')).toBe('FR37200000008');
    expect(fix('FF-FMT-03')).toBe('2026-11-14');
    expect(fix('FF-RATE-01')).toBe('5.5');
    expect(fix('FF-FMT-04')).toBeNull();
    const amount: Issue = {
      ...vat.issues[0],
      ruleId: 'FF-FMT-01',
      autoFixable: true,
      path: 'lines[0].price.net',
    } as Issue;
    expect(autoFixFor(amount, vat.invoice)).toBeNull();
    const missing: Issue = { ...amount, path: 'buyer.nothing' };
    expect(autoFixFor(missing, vat.invoice)).toBeNull();
    const unknownRule: Issue = { ...amount, ruleId: 'FF-XX', path: 'buyer.vatId' };
    expect(autoFixFor(unknownRule, vat.invoice)).toBeNull();
  });
});

describe('explainIssues', () => {
  it('gives the rules’ own explanation, the cell and the safe fix when AI is off', async () => {
    const { orchestrator } = testOrchestrator();
    const r = await explainIssues(vat.invoice, vat.issues, {
      tenantId: 't1',
      orchestrator,
      ai: null,
      cellFor: () => 'Feuil1!F7',
    });
    expect(r.degraded).toBe('ai_off');
    expect(r.explanations[0]).toMatchObject({
      ruleId: 'FF-FMT-02',
      source: 'rules',
      cell: 'Feuil1!F7',
      auto_fix: { value: 'FR37200000008' },
      fix_steps: [vat.issues[0]?.fixHintFr],
    });
    expect(explainDegradedNote('ai_off')).toContain('désactivé');
    expect(
      (await explainIssues(vat.invoice, [], { tenantId: 't1', orchestrator, ai: null })).degraded,
    ).toBeNull();
  });

  it('uses the agent wording, with the cell from the sheet and the fix computed here', async () => {
    const { result, store } = await run(vat.invoice, vat.issues, {
      explanations: [explanation(0, { auto_fix_value: 'FR37200000008' })],
    });
    expect(result.degraded).toBeNull();
    expect(result.explanations[0]).toMatchObject({
      source: 'agent',
      message_fr: 'Le numéro de TVA de votre client contient des espaces.',
      cell: "'Factures'!F7",
      auto_fix: { value: 'FR37200000008' },
    });
    expect(result.rejected).toEqual({
      forbiddenAutoFix: 0,
      wrongAutoFix: 0,
      unknownTokens: 0,
      missing: 0,
    });
    expect(store.runs[0]).toMatchObject({ agent: 'explain', invoiceId: 'inv-1' });
  });

  it('throws away forbidden and wrong automatic fixes', async () => {
    const forbidden = await run(iban.invoice, iban.issues, {
      explanations: iban.issues.map((_, i) =>
        explanation(i, { auto_fix_value: 'FR7630006000011234567890189' }),
      ),
    });
    expect(forbidden.result.explanations.every((e) => e.auto_fix === null)).toBe(true);
    expect(forbidden.result.rejected.forbiddenAutoFix).toBe(iban.issues.length);
    const wrong = await run(vat.invoice, vat.issues, {
      explanations: [explanation(0, { auto_fix_value: 'FR00000000000' })],
    });
    expect(wrong.result.explanations[0]?.auto_fix).toEqual({ value: 'FR37200000008' });
    expect(wrong.result.rejected.wrongAutoFix).toBe(1);
  });

  it('falls back per issue on invented tokens, missing answers and oversized text', async () => {
    const issues = [...vat.issues, ...iban.issues.slice(0, 1), ...vat.issues];
    const { result } = await run(vat.invoice, issues, {
      explanations: [
        explanation(0, { message_fr: 'Voyez {{PARTY_42}}' }),
        explanation(2, { fix_steps: [] }),
        explanation(7),
      ],
    });
    expect(result.explanations.map((e) => e.source)).toEqual(['rules', 'rules', 'rules']);
    expect(result.rejected).toMatchObject({ unknownTokens: 1, missing: 1 });
  });

  it('re-hydrates tokens and never sends names, identifiers or the IBAN', async () => {
    const { model, result } = await run(iban.invoice, iban.issues, {
      explanations: iban.issues.map((_, i) =>
        explanation(i, { message_fr: "L'IBAN {{IBAN_1}} semble faux." }),
      ),
    });
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    const account = iban.invoice.payment?.accounts[0]?.iban ?? 'missing';
    for (const secret of [
      account,
      iban.invoice.buyer.name ?? 'x',
      iban.invoice.seller.name ?? 'x',
      '200000008',
    ])
      expect(sent).not.toContain(secret);
    expect(sent).toContain(String(iban.invoice.totals.payable));
    expect(result.explanations[0]?.message_fr).toBe(`L'IBAN ${account} semble faux.`);
  });

  it('explains issues beyond the first 20 with the standard text, and degrades on failure', async () => {
    const many = Array.from({ length: 22 }, () => vat.issues[0] as Issue);
    const { result } = await run(vat.invoice, many, {
      explanations: many.slice(0, 20).map((_, i) => explanation(i)),
    });
    expect(result.explanations.slice(0, 20).every((e) => e.source === 'agent')).toBe(true);
    expect(result.explanations.slice(20).map((e) => e.source)).toEqual(['rules', 'rules']);
    const { orchestrator } = testOrchestrator({ retries: 0 });
    const failed = await explainIssues(vat.invoice, vat.issues, {
      tenantId: 't1',
      orchestrator,
      ai: handleFor(failingModel(new Error('down'))),
    });
    expect(failed.degraded).toBe('error');
    expect(failed.explanations[0]?.source).toBe('rules');
  });
});
