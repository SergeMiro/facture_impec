// The sheets of the checks tests (R2, R8): an order sheet and an invoice sheet in the 300/400 shape,
// and a company that reads them into its registry through the API.
import {
  computeInvoice,
  detectMapping,
  frenchVatKey,
  type GridCell,
  grid,
  InvoiceDraft,
} from '@fi/core';
import type { Database } from '@fi/db';
import { and, auditEvents, eq, invoices } from '@fi/db';
import { expect } from 'vitest';
import { SCENARIO_SELLER } from './scenarios/invoice';
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

export const SUPPLIER = { siren: '600000004', name: 'Grossiste Martin SAS' };

/**
 * The invoice « Grossiste Martin SAS » sends the company: 10 « Chaise pliante » at 35 € (R3, R6).
 * `parties`: another seller or buyer, for an invoice the company must not take as a purchase.
 */
export function supplierDocument(
  number: string,
  price: string,
  parties: { seller?: string; buyer?: string } = {},
) {
  const seller = parties.seller ?? SUPPLIER.siren;
  const buyer = parties.buyer ?? SCENARIO_SELLER.siren;
  const vatId = (siren: string) => `FR${frenchVatKey(siren)}${siren}`;
  const draft = InvoiceDraft.parse({
    processType: 'M1',
    number,
    issueDate: '2026-09-05',
    typeCode: '380',
    currency: 'EUR',
    dueDate: '2026-10-05',
    paymentTerms: 'Paiement à 30 jours.',
    notes: [],
    seller: {
      name: SUPPLIER.name,
      legalId: { id: seller, scheme: '0002' },
      vatId: vatId(seller),
      electronicAddress: { id: seller, scheme: '0225' },
      address: { line1: '8 avenue du Port', city: 'Lyon', postCode: '69002', country: 'FR' },
    },
    buyer: {
      name: SCENARIO_SELLER.name,
      legalId: { id: buyer, scheme: '0002' },
      vatId: vatId(buyer),
      electronicAddress: { id: buyer, scheme: '0225' },
      address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
    },
    delivery: { date: '2026-09-05' },
    payment: { meansCode: '30', accounts: [{ iban: 'FR7630006000011234567890189' }] },
    lines: [
      {
        id: '1',
        quantity: '10',
        unitCode: 'H87',
        price: { net: price },
        vat: { category: 'S', rate: '20' },
        item: { name: 'Chaise pliante', sellerId: 'GM-CH-01' },
        nature: 'goods',
      },
    ],
  });
  return computeInvoice(draft);
}
