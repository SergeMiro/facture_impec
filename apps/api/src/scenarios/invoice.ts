// The invoices scenarios send: golden invoice 01 (fixtures/golden) dated today, Europe/Paris.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InvoiceDraft } from '@fi/core';
import { parisToday } from '@fi/core';
import { REPO_ROOT } from '@fi/shared/env';

const golden = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'fixtures/golden/01-services-standard-rate.json'), 'utf8'),
) as { draft: InvoiceDraft };

/** The seller of golden invoice 01: scenario tenants use its SIREN. */
export const SCENARIO_SELLER = { name: 'Atelier Dupont SARL', siren: '100000009' };

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function scenarioDraft(index: number, now = new Date()): InvoiceDraft {
  const today = parisToday(now);
  const draft = structuredClone(golden.draft);
  draft.number = `F${today.slice(0, 4)}-${String(index).padStart(4, '0')}`;
  draft.issueDate = today;
  draft.dueDate = addDays(today, 30);
  draft.delivery = { ...draft.delivery, date: today };
  return draft;
}
