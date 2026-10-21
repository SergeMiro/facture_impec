// The sheets of the checks tests (R2, R8): an order sheet and an invoice sheet in the 300/400 shape,
// and a company that reads them into its registry through the API.
import { detectMapping, type GridCell, grid } from '@fi/core';
import type { Database } from '@fi/db';
import { and, auditEvents, eq, invoices } from '@fi/db';
import { expect } from 'vitest';
import { newTenant, type testApi } from './test-helpers';
import type { SyncResult } from './workbooks';

type Request = ReturnType<typeof testApi>['request'];

export const d = (serial: number, text: string): GridCell => ({
  v: serial,
  t: text,
  f: 'dd/mm/yyyy',
});
export const SEP1 = d(46266, '01/09/2026');
export const SEP10 = d(46275, '10/09/2026');

export const ORDER_HEADER: GridCell[] = [
  'N° commande',
  'Date',
  'Client',
  'Désignation',
  'Qté',
  'PU HT',
];
export const orders = (...rows: GridCell[][]) => grid('Commandes', [ORDER_HEADER, ...rows]);

export const INVOICE_HEADER: GridCell[] = [
  'N° Facture',
  'Date',
  'Client',
  'SIREN',
  'Adresse',
  'Code postal',
  'Ville',
  'N° commande',
  'Désignation',
  'Qté',
  'P.U. HT',
  'TVA',
];
export const invoiceRow = (
  number: string,
  order: string | null,
  item: string,
  quantity: number,
  price: number,
): GridCell[] => [
  number,
  SEP10,
  'Durand SARL',
  '200000008',
  '3 rue de la Gare',
  '21000',
  'Dijon',
  order,
  item,
  quantity,
  price,
  { v: 0.2, t: '20%', f: '0%' },
];
export const invoiceSheet = (...rows: GridCell[][]) => grid('Factures', [INVOICE_HEADER, ...rows]);

export interface Finding {
  id: string;
  rule: string;
  severity: string;
  message: string;
  amount: number | null;
  invoiceId: string | null;
  fingerprint: string;
  evidence: {
    role: string;
    number: string | null;
    sheet: string | null;
    workbookId: string | null;
    cell: string | null;
  }[];
}
export interface Checks {
  checkedAt: string | null;
  atStake: number;
  blocking: number;
  findings: Finding[];
  links: {
    id: string;
    kind: string;
    score: number;
    from: { number: string | null } | null;
    to: { number: string | null } | null;
  }[];
}
export interface Detail {
  id: string;
  status: string;
  autopilot: { at: string | null; held: boolean };
  findings: Finding[];
  events: { type: string; event: string | null; payload: Record<string, unknown> }[];
}

/** A company with invoice defaults, and the calls a test makes as it (sheets, checks, details). */
export const companies =
  ({ request, database }: { request: Request; database: Database }) =>
  async (workbook: string, extra: Record<string, unknown> = {}) => {
    const t = await newTenant(request, {
      vatId: 'FR88100000009',
      address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
      ...extra,
    });
    await request('/settings', {
      method: 'PATCH',
      token: t.apiKey,
      body: {
        invoiceDefaults: {
          siret: '10000000900017',
          iban: 'FR7630006000011234567890189',
          paymentDays: 30,
          operationCategory: 'goods',
        },
      },
    });
    const call = async (path: string, method = 'GET', body?: unknown, status = 200) => {
      const res = await request(path, {
        method,
        token: t.apiKey,
        ...(body !== undefined && { body }),
      });
      expect(res.status, await res.clone().text()).toBe(status);
      return res.json();
    };
    const includeOrders = async (snapshot: ReturnType<typeof grid>) => {
      const base = `/workbooks/${workbook}/sources`;
      const { layout } = (await call(`${base}/detect`, 'POST', { snapshot })) as {
        layout: unknown;
      };
      return call(`${base}/${encodeURIComponent(snapshot.sheet)}`, 'PUT', { layout, snapshot });
    };
    const syncOrders = (snapshot: ReturnType<typeof grid>) =>
      call(`/workbooks/${workbook}/sources/${encodeURIComponent(snapshot.sheet)}/sync`, 'POST', {
        snapshot,
      });
    const syncInvoices = async (snapshot: ReturnType<typeof grid>) =>
      (await call(`/workbooks/${workbook}/sync`, 'POST', {
        snapshot,
        mapping: detectMapping(snapshot),
      })) as SyncResult;
    const checks = () => call('/checks') as Promise<Checks>;
    const detail = (id: string) => call(`/invoices/${id}`) as Promise<Detail>;
    const audits = async (action: string) =>
      database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.tenantId, t.id), eq(auditEvents.action, action)));
    const invoiceId = async (number: string) => {
      const [row] = await database.db
        .select({ id: invoices.id, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.tenantId, t.id), eq(invoices.number, number)));
      if (!row) throw new Error(`no invoice ${number}`);
      return row.id;
    };
    return {
      ...t,
      call,
      includeOrders,
      syncOrders,
      syncInvoices,
      checks,
      detail,
      audits,
      invoiceId,
    };
  };
