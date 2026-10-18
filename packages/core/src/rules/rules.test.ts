import { isMessageKey } from '@fi/shared';
import { describe, expect, it } from 'vitest';
import {
  buildCase,
  computeGolden,
  goldens,
  invalidCases,
  setPath,
  TODAY,
} from '../../test/fixtures';
import { computeInvoice } from '../compute';
import { InvoiceDraft } from '../model';
import { getRule, hasErrors, messageKeys, RULES, ruleContext, validate } from './index';

const modelRules = RULES.filter((r) => r.stage !== 'import');

describe('rule catalogue', () => {
  it('has unique ids', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a French message and fix hint for every rule and variant', () => {
    const missing = RULES.flatMap((r) =>
      (r.variants ?? [undefined]).flatMap((v) => {
        const keys = messageKeys(r, v);
        return [keys.message, keys.fix].filter((k) => !isMessageKey(k));
      }),
    );
    expect(missing).toEqual([]);
  });

  it('describes every rule for docs/RULES.md', () => {
    for (const r of RULES) {
      expect(r.summary, r.id).toMatch(/\.$/);
      expect(r.bt.length, r.id).toBeGreaterThan(0);
    }
  });

  it('only marks formatting rules as auto-fixable', () => {
    expect(RULES.filter((r) => r.autoFixable).map((r) => r.id)).toEqual([
      'FF-FMT-01',
      'FF-FMT-02',
      'FF-FMT-03',
      'FF-RATE-01',
    ]);
  });

  it('finds a rule by id', () => {
    expect(getRule('BR-FR-11').scope).toBe('buyer');
    expect(() => getRule('BR-XX')).toThrow('Unknown rule BR-XX');
  });
});

describe('golden invoices', () => {
  it('has at least 25 of them', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(25);
  });

  it.each(goldens.map((g) => [g.name, g] as const))('%s raises no error', (_, g) => {
    const issues = validate(computeGolden(g), { today: TODAY, ...g.context });
    expect(issues.map((i) => i.ruleId).sort()).toEqual([...g.warnings].sort());
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('invalid fixtures', () => {
  it('has a failing fixture for every rule checked on the model', () => {
    const covered = new Set(invalidCases.map((c) => c.rule));
    expect(modelRules.map((r) => r.id).filter((id) => !covered.has(id))).toEqual([]);
    expect(invalidCases.length).toBeGreaterThanOrEqual(60);
  });

  it('has a passing golden invoice for every rule checked on the model', () => {
    const silent = (id: string) =>
      goldens.some(
        (g) =>
          !validate(computeGolden(g), { today: TODAY, ...g.context }).some((i) => i.ruleId === id),
      );
    expect(modelRules.map((r) => r.id).filter((id) => !silent(id))).toEqual([]);
  });

  it.each(
    invalidCases.map((c) => [`${c.rule} on ${c.base}${c.why ? ` (${c.why})` : ''}`, c] as const),
  )('%s', (_, c) => {
    const { invoice, context } = buildCase(c);
    expect(validate(invoice, context).map((i) => i.ruleId)).toContain(c.rule);
  });
});

describe('validate', () => {
  const base = goldens[0];
  if (!base) throw new Error('no golden fixture');

  it('writes French messages with labelled parameters', () => {
    const draft = structuredClone(base.draft);
    setPath(draft, 'dueDate', '14/11/2026');
    setPath(draft, 'payment.accounts[0].iban', 'FR7630006000011234567890188');
    setPath(draft, 'lines[0].vat', { category: 'AE', rate: '20' });
    const issues = validate(computeInvoice(InvoiceDraft.parse(draft)), { today: TODAY });
    const byId = (id: string) => issues.find((i) => i.ruleId === id);
    expect(byId('FF-FMT-03')?.messageFr).toBe("La date d'échéance n'est pas dans le bon format.");
    expect(byId('FF-IBAN-01')?.messageFr).toContain('« FR7630006000011234567890188 »');
    expect(byId('BR-AE-05')?.messageFr).toBe(
      'Avec le régime « autoliquidation », le taux de TVA doit être 0 %.',
    );
    expect(byId('BR-FR-05')).toBeUndefined();
  });

  it('gives one message per missing mandatory note', () => {
    const draft = { ...structuredClone(base.draft), notes: [] };
    const issues = validate(computeInvoice(InvoiceDraft.parse(draft)), { today: TODAY });
    expect(issues.filter((i) => i.ruleId === 'BR-FR-05').map((i) => i.messageFr)).toHaveLength(3);
  });

  it('hides other issues on a path that an automatic fix will change', () => {
    const draft = structuredClone(base.draft);
    setPath(draft, 'seller.legalId.id', '100 000 009');
    const ids = validate(computeInvoice(InvoiceDraft.parse(draft)), { today: TODAY })
      .filter((i) => i.path === 'seller.legalId.id')
      .map((i) => i.ruleId);
    expect(ids).toEqual(['FF-FMT-02']);
  });

  it('defaults the context to today in Paris and no customer settings', () => {
    const ctx = ruleContext();
    expect(ctx.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.history).toBeUndefined();
    expect(ctx.seller.vatOnDebits).toBe(false);
    expect(ctx.buyer).toEqual({
      requiresPurchaseOrder: false,
      deliversElsewhere: false,
      publicEntity: false,
    });
  });
});
