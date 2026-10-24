// Building-trade rules (BTP plan §6 ruleset `btp`), run only when the caller gives the context `btp`:
// what the company knows and the invoice cannot say (the other party is its sous-traitant or its
// donneur d'ordre, the retenue de garantie, the situation's place in its chantier). Sources and what
// is verified: docs/research/BTP_RULES.md. BTP-DATE-01 of the plan is BR-FR-CO-07 + FF-DUE-02, and
// the « Autoliquidation » mention is FF-TVA-02 (docs/DECISIONS.md D4).
import type { Rule } from './types';
import { each, finding, rule, when } from './util';

const btp = { source: 'FF', autoFixable: false } as const;

const euros = (cents: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);

/** Loi n° 71-584 du 16 juillet 1971, art. 1: at most 5 % of the payments (basis points). */
export const RETENUE_MAX_BPS = 500;

export const BTP_RULES: Rule[] = [
  rule({
    ...btp,
    id: 'BTP-AUTOLIQ-01',
    severity: 'error',
    scope: 'vat',
    bt: ['BT-110', 'BT-118'],
    summary:
      "Between a sous-traitant and its donneur d'ordre (the company said so), construction works are invoiced without VAT, under reverse charge (CGI art. 283, 2 nonies).",
    check: (inv, ctx) => {
      if (ctx.btp?.subcontracting !== true) return [];
      const taxed = each(inv.vatBreakdown, 'vatBreakdown', (b) => b.category !== 'AE').map((f) => ({
        ...f,
        path: `${f.path}.category`,
      }));
      if (taxed.length > 0) return taxed;
      return when((inv.totals.taxTotal ?? 0) !== 0, 'totals.taxTotal');
    },
  }),
  rule({
    ...btp,
    id: 'BTP-AUTOLIQ-02',
    severity: 'warning',
    scope: 'vat',
    bt: ['BT-118', 'BT-121'],
    summary:
      "French reverse charge (VATEX-FR-AE) with a company the building firm has not marked as its sous-traitant or donneur d'ordre.",
    check: (inv, ctx) =>
      ctx.btp?.subcontracting === false
        ? each(
            inv.vatBreakdown,
            'vatBreakdown',
            (b) => b.category === 'AE' && b.exemptionCode === 'VATEX-FR-AE',
          ).map((f) => ({ ...f, path: `${f.path}.category` }))
        : [],
  }),
  rule({
    ...btp,
    id: 'BTP-RG-01',
    severity: 'error',
    scope: 'totals',
    bt: ['BT-112'],
    summary:
      'The retenue de garantie is at most 5 % of the amount invoiced, TTC (loi n° 71-584, art. 1).',
    check: (inv, ctx) => {
      const retenue = ctx.btp?.retenue;
      if (!retenue) return [];
      const total = inv.totals.taxInclusive;
      const over =
        (retenue.rateBps !== undefined && retenue.rateBps > RETENUE_MAX_BPS) ||
        (retenue.amount !== undefined &&
          total !== undefined &&
          total > 0 &&
          retenue.amount * 10_000 > total * RETENUE_MAX_BPS);
      return when(over, 'totals.taxInclusive');
    },
  }),
  rule({
    ...btp,
    id: 'BTP-RG-02',
    severity: 'warning',
    scope: 'notes',
    bt: ['BT-22'],
    summary: 'A retenue de garantie on an invoice of a chantier whose contract agreed none.',
    check: (_inv, ctx) => {
      const retenue = ctx.btp?.retenue;
      const held = (retenue?.rateBps ?? 0) > 0 || (retenue?.amount ?? 0) > 0;
      return when(held && ctx.btp?.chantier?.retenueBps === null, 'notes');
    },
  }),
  rule({
    ...btp,
    id: 'BTP-RG-03',
    severity: 'warning',
    scope: 'notes',
    bt: ['BT-21', 'BT-22'],
    summary:
      'A retenue de garantie the invoice does not show: XP Z12-014 annex A case 26 writes it as a note with subject ABU.',
    check: (inv, ctx) => {
      const retenue = ctx.btp?.retenue;
      const held = (retenue?.rateBps ?? 0) > 0 || (retenue?.amount ?? 0) > 0;
      return when(held && !inv.notes.some((n) => n.subjectCode === 'ABU'), 'notes');
    },
  }),
  rule({
    ...btp,
    id: 'BTP-SIT-01',
    severity: 'error',
    scope: 'document',
    bt: ['BT-1'],
    summary: "A situation's number follows the previous situation of the same chantier.",
    check: (_inv, ctx) => {
      const situation = ctx.btp?.situation;
      const previous = situation?.previous;
      if (!situation || !previous || situation.number === previous.number + 1) return [];
      return [
        finding('number', {
          numero: situation.number,
          precedent: previous.number,
          attendu: previous.number + 1,
        }),
      ];
    },
  }),
  rule({
    ...btp,
    id: 'BTP-SIT-02',
    severity: 'error',
    scope: 'totals',
    bt: ['BT-109'],
    summary:
      "A situation's cumulative works are not below the previous situation's of the same chantier.",
    check: (_inv, ctx) => {
      const situation = ctx.btp?.situation;
      const before = situation?.previous?.cumulative;
      if (situation?.cumulative === undefined || before === undefined) return [];
      return situation.cumulative < before
        ? [
            finding('totals.taxExclusive', {
              cumul: euros(situation.cumulative),
              precedent: euros(before),
            }),
          ]
        : [];
    },
  }),
];
