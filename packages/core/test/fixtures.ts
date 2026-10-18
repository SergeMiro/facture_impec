// Loads fixtures/golden and fixtures/invalid (repository root) for the tests. Node only.
import { readdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { computeInvoice } from '../src/compute';
import { type Invoice, InvoiceDraft } from '../src/model';
import { ContextInput } from '../src/rules';

export const FIXTURES = new URL('../../../fixtures/', import.meta.url);
/** The date the fixtures were written against: BR-FR-CO-01 compares the issue date with it. */
export const TODAY = '2026-10-17';

const Golden = z.object({
  description: z.string(),
  context: ContextInput.optional(),
  /** Warnings the invoice is expected to raise; any other issue fails the test. */
  warnings: z.array(z.string()).default([]),
  draft: z.record(z.string(), z.unknown()),
});
export type Golden = z.infer<typeof Golden> & { name: string };

const Case = z.object({
  rule: z.string(),
  base: z.string(),
  why: z.string().optional(),
  /** 'draft' (default): mutate the golden draft, then compute. 'invoice': mutate the computed invoice. */
  on: z.enum(['draft', 'invoice']).default('draft'),
  set: z.record(z.string(), z.unknown()).default({}),
  unset: z.array(z.string()).default([]),
  context: ContextInput.optional(),
});
export type InvalidCase = z.infer<typeof Case> & { file: string };

const json = (path: URL): unknown => JSON.parse(readFileSync(path, 'utf8'));
const files = (dir: string) =>
  readdirSync(new URL(dir, FIXTURES))
    .filter((f) => f.endsWith('.json'))
    .sort();

export const goldens: Golden[] = files('golden/').map((f) => ({
  name: f.replace(/\.json$/, ''),
  ...Golden.parse(json(new URL(`golden/${f}`, FIXTURES))),
}));

export const invalidCases: InvalidCase[] = files('invalid/').flatMap((f) =>
  z
    .object({ cases: z.array(Case) })
    .parse(json(new URL(`invalid/${f}`, FIXTURES)))
    .cases.map((c) => ({ ...c, file: f })),
);

export function golden(name: string): Golden {
  const found = goldens.find((g) => g.name === name);
  if (!found) throw new Error(`No golden fixture ${name}`);
  return found;
}

type Json = Record<string | number, unknown>;
const segments = (path: string) =>
  path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));

/** Sets `lines[0].price.net`, creating objects and arrays on the way. */
export function setPath(target: object, path: string, value: unknown): void {
  const keys = segments(path);
  let node = target as Json;
  keys.slice(0, -1).forEach((key, i) => {
    if (typeof node[key] !== 'object' || node[key] === null)
      node[key] = typeof keys[i + 1] === 'number' ? [] : {};
    node = node[key] as Json;
  });
  node[keys.at(-1) ?? ''] = value;
}

export function unsetPath(target: object, path: string): void {
  const keys = segments(path);
  let node: unknown = target;
  for (const key of keys.slice(0, -1)) {
    if (typeof node !== 'object' || node === null) return;
    node = (node as Json)[key];
  }
  if (typeof node === 'object' && node !== null) delete (node as Json)[keys.at(-1) ?? ''];
}

const mutate = <T extends object>(value: T, c: InvalidCase): T => {
  const copy = structuredClone(value);
  for (const [path, v] of Object.entries(c.set)) setPath(copy, path, v);
  for (const path of c.unset) unsetPath(copy, path);
  return copy;
};

export const computeGolden = (g: Golden): Invoice => computeInvoice(InvoiceDraft.parse(g.draft));

/** The invoice and context of an invalid case. */
export function buildCase(c: InvalidCase): { invoice: Invoice; context: ContextInput } {
  const base = golden(c.base);
  const invoice =
    c.on === 'draft'
      ? computeInvoice(InvoiceDraft.parse(mutate(base.draft, c)))
      : mutate(computeGolden(base), c);
  return { invoice, context: { today: TODAY, ...base.context, ...c.context } };
}

/** The date written in the golden PDFs, so their bytes (and fixtures/golden/pdf-sha256.json) are stable. */
export const PDF_DATE = new Date(`${TODAY}T10:00:00Z`);
