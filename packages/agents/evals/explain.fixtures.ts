// Invoices with known problems for the ExplainAgent eval: one per kind of rule (formatting fixes the
// agent may propose, amounts and identities it must never touch), plus one invoice with several.
import { type Invoice, type Issue, validate } from '@fi/core';
import { buildCase, invalidCases } from '@fi/core/testing';

export interface ExplainFixture {
  name: string;
  invoice: Invoice;
  issues: Issue[];
}

/** Rule ids taken from fixtures/invalid; each yields the invoice its case describes. */
const RULES = [
  'FF-FMT-01',
  'FF-FMT-02',
  'FF-FMT-03',
  'FF-RATE-01',
  'FF-FMT-04',
  'FF-RATE-02',
  'BR-FR-02',
  'BR-CO-10',
  'BR-16',
  'BR-07',
  'FF-IBAN-01',
  'BR-FR-05',
];

function fromCase(rule: string): ExplainFixture {
  const c = invalidCases.find((x) => x.rule === rule);
  if (!c) throw new Error(`No invalid case for ${rule}`);
  const { invoice, context } = buildCase(c);
  return { name: rule, invoice, issues: validate(invoice, context) };
}

function combined(): ExplainFixture {
  const base = fromCase('FF-FMT-03').invoice;
  const invoice: Invoice = structuredClone(base);
  invoice.buyer.vatId = 'fr 37 200000008';
  const first = invoice.lines[0];
  if (first) first.vat.rate = '20,0';
  invoice.number = ' F2026-0042';
  return { name: 'several', invoice, issues: validate(invoice, { today: '2026-10-17' }) };
}

export const EXPLAIN_FIXTURES: ExplainFixture[] = [...RULES.map(fromCase), combined()];
