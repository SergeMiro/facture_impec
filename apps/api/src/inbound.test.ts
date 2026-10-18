import { readFileSync } from 'node:fs';
import { type Invoice, parisToday, toCii } from '@fi/core';
import { checkFec, checkFecName, readCsv } from '@fi/core/export-check';
import { computeGolden, FIXTURES, golden } from '@fi/core/testing';
import {
  and,
  auditEvents,
  type Database,
  eq,
  inboundExports,
  inboundQueue,
  type PdpProvider,
} from '@fi/db';
import type { InboundInvoice, PdpAdapter } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SUPPLIER, type inboundView } from './inbound';
import { fakeAdapter, newTenant, testAi, testApi, testDatabase } from './test-helpers';
import { runInboundPoll, type WorkerDeps } from './workers';

type View = ReturnType<typeof inboundView>;
/** An answer: an inbound invoice, a list, an export or an error. */
type Body = Record<string, unknown> &
  Partial<View> & {
    error?: { code: string; message: string };
    inbound?: View[];
    exports?: unknown[];
  };
const BUYER = {
  siren: '200000008',
  name: 'Boulangerie Martin SAS',
  vatId: 'FR37200000008',
  address: { line1: '3 place du Marché', city: 'Beaune', postCode: '21200', country: 'FR' },
};
const goldenXml = (name: string) =>
  readFileSync(new URL(`golden/${name}.cii.xml`, FIXTURES), 'utf8');
const editedXml = (name: string, edit: (invoice: Invoice) => Invoice) =>
  toCii(edit(computeGolden(golden(name))));

let database: Database;
let api: ReturnType<typeof testApi>;
/** What each platform delivers, per account; `since` records what polling asked. */
const delivered: Record<PdpProvider, Map<string, InboundInvoice[]>> = {
  mock: new Map(),
  b2brouter: new Map(),
};
const asked: { provider: PdpProvider; account: string; since: Date }[] = [];
const platform = (provider: PdpProvider): PdpAdapter =>
  fakeAdapter({
    provider,
    listInbound: async ({ account, since }) => {
      asked.push({ provider, account, since });
      return (delivered[provider].get(account) ?? []).filter(
        (i) => Date.parse(i.receivedAt) >= since.getTime(),
      );
    },
  });
const pdp = { mock: platform('mock'), b2brouter: platform('b2brouter') };

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, pdp);
});
afterAll(async () => {
  await database.close();
});

const worker = (test: WorkerDeps['test'] = null): WorkerDeps => ({
  db: database.db,
  pdp,
  test,
  jobs: api.jobs,
  ai: testAi(database),
  mailer: null,
  now: () => new Date(),
});

let refs = 0;
async function company() {
  const tenant = await newTenant(api.request, BUYER);
  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await api.request(path, { ...init, token: tenant.apiKey });
    return { status: res.status, body: (await res.json()) as Body };
  };
  return {
    ...tenant,
    call,
    /** The platform delivers `xml` (a second later than the previous one) and the sweep polls. */
    async deliver(xml: string, provider: PdpProvider = 'mock') {
      const list = delivered[provider].get(tenant.account) ?? [];
      const receivedAt = new Date(Date.now() + ++refs * 1000).toISOString();
      list.push({ pdpRef: `ref-${refs}`, receivedAt, xml });
      delivered[provider].set(tenant.account, list);
      return runInboundPoll(worker());
    },
    async list(test = false): Promise<View[]> {
      return (await call(`/inbound?test=${test}`)).body.inbound ?? [];
    },
    download: (path: string) => api.request(path, { token: tenant.apiKey }),
  };
}

describe('supplier invoices the platform delivers', () => {
  it('appear triaged; a second copy is a duplicate that cannot be approved', async () => {
    const c = await company();
    expect(await c.deliver(goldenXml('01-services-standard-rate'))).toMatchObject({
      stored: 1,
      triaged: 1,
    });
    const [first] = await c.list();
    expect(first).toMatchObject({
      status: 'new',
      statusLabel: 'Nouvelle',
      isTest: false,
      triaged: true,
      supplierName: 'Atelier Dupont SARL',
      number: 'F2026-0042',
      iban: 'FR76 •••• •••• 0189',
      canApprove: true,
      needsIbanCheck: false,
      flags: [{ code: 'new_supplier', level: 'info', details: [], relatedId: null }],
    });
    expect(first?.flags[0]?.message).toMatch(/Premier envoi/);

    await c.deliver(goldenXml('01-services-standard-rate'));
    const [copy] = await c.list();
    expect(copy?.flags.map((f) => [f.code, f.level])).toEqual([['duplicate', 'block']]);
    expect(copy?.flags[0]?.relatedId).toBe(first?.id);
    expect(copy?.flags[0]?.message).toMatch(/F2026-0042/);
    expect(copy?.canApprove).toBe(false);

    const refused = await c.call(`/inbound/${copy?.id}/approve`, { method: 'POST', body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'inbound_blocked' });
    expect(refused.body.error?.message).toMatch(/Doublon/);

    const disputed = await c.call(`/inbound/${copy?.id}/dispute`, {
      method: 'POST',
      body: { reason: '  Déjà reçue  ' },
    });
    expect(disputed.body).toMatchObject({
      status: 'disputed',
      disputeReason: 'Déjà reçue',
      decidedBy: 'api',
      canDispute: false,
    });
    const triaged = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, c.id), eq(auditEvents.action, 'inbound.triage')));
    expect(triaged).toHaveLength(2);
  });

  it('asks the user to confirm a new IBAN before « Bon pour paiement »', async () => {
    const c = await company();
    await c.deliver(goldenXml('01-services-standard-rate'));
    await c.deliver(
      editedXml('02-goods-two-rates', (inv) => ({
        ...inv,
        payment: { ...inv.payment, accounts: [{ iban: 'FR7630004000031234567890143' }] },
      })),
    );
    const [changed] = await c.list();
    expect(changed?.flags.map((f) => f.code)).toEqual(['iban_changed']);
    expect(changed?.flags[0]?.message).toMatch(/FR76 •••• •••• 0189 → FR76 •••• •••• 0143/);
    expect(changed).toMatchObject({ canApprove: true, needsIbanCheck: true });

    const path = `/inbound/${changed?.id}/approve`;
    const unchecked = await c.call(path, { method: 'POST', body: {} });
    expect(unchecked.status).toBe(409);
    expect(unchecked.body.error).toMatchObject({ code: 'inbound_iban_unchecked' });
    const approved = await c.call(path, { method: 'POST', body: { ibanChecked: true } });
    expect(approved.body).toMatchObject({ status: 'approved', decidedBy: 'api' });
    expect(
      (await c.call(path, { method: 'POST', body: { ibanChecked: true } })).body.error,
    ).toMatchObject({
      code: 'inbound_not_now',
    });
  });

  it('blocks a file that cannot be read, and an invoice for another company', async () => {
    const c = await company();
    await c.deliver('<html>not an invoice</html>');
    await c.deliver(
      editedXml('01-services-standard-rate', (inv) => ({
        ...inv,
        number: 'F2026-0099',
        buyer: { ...inv.buyer, legalId: { id: '300000007', scheme: '0002' }, vatId: undefined },
      })),
    );
    const [other, unreadable] = await c.list();
    expect(unreadable).toMatchObject({
      supplierName: 'Fournisseur non identifié',
      canApprove: false,
      flags: [{ code: 'unreadable', level: 'block' }],
    });
    expect(other?.flags[0]).toMatchObject({ code: 'other_buyer', level: 'block' });
    expect(other?.flags[0]?.message).toMatch(/300000007/);
    expect((await c.call('/inbound/not-a-uuid')).body.error).toMatchObject({
      code: 'inbound_not_found',
    });
  });
});

describe('the export for the accountant', () => {
  it('writes a FEC and a CSV of what was approved, and numbering continues from one export to the next', async () => {
    const c = await company();
    await c.deliver(goldenXml('01-services-standard-rate'));
    await c.deliver(goldenXml('02-goods-two-rates'));
    await c.deliver(goldenXml('16-foreign-currency'));
    const nothing = await c.call('/inbound/export', { method: 'POST', body: {} });
    expect(nothing.body.error).toMatchObject({ code: 'nothing_to_export' });
    for (const row of await c.list()) {
      const res = await c.call(`/inbound/${row.id}/approve`, { method: 'POST', body: {} });
      expect(res.status).toBe(200);
    }

    const made = await c.call('/inbound/export', { method: 'POST', body: {} });
    expect(made.status).toBe(201);
    const day = parisToday().replaceAll('-', '');
    expect(made.body).toMatchObject({
      isTest: false,
      count: 3,
      // The dollar invoice is in the CSV only: the FEC is kept in euros.
      skipped: 1,
      firstEntry: 1,
      lastEntry: 2,
      fecName: `200000008FEC${day}.txt`,
    });
    const fec = await c.download(`/inbound/exports/${made.body.id}/fec`);
    expect(fec.headers.get('content-disposition')).toBe(
      `attachment; filename="200000008FEC${day}.txt"`,
    );
    const fecText = await fec.text();
    expect(checkFecName(String(made.body.fecName))).toEqual([]);
    expect(checkFec(fecText).problems).toEqual([]);
    const csv = await c.download(`/inbound/exports/${made.body.id}/csv`);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const { problems, rows } = readCsv(await csv.text());
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(4);

    expect((await c.list()).map((r) => r.status)).toEqual(['exported', 'exported', 'exported']);
    expect((await c.list())[0]?.exportId).toBe(made.body.id);
    const again = await c.call('/inbound/export', { method: 'POST', body: {} });
    expect(again.body.error).toMatchObject({ code: 'nothing_to_export' });

    await c.deliver(
      editedXml('01-services-standard-rate', (inv) => ({ ...inv, number: 'F2026-0050' })),
    );
    const [next] = await c.list();
    await c.call(`/inbound/${next?.id}/approve`, { method: 'POST', body: {} });
    const second = await c.call('/inbound/export', { method: 'POST', body: {} });
    expect(second.body).toMatchObject({ count: 1, skipped: 0, firstEntry: 3, lastEntry: 3 });
    const listed = await c.call('/inbound/exports');
    expect(listed.body.exports).toHaveLength(2);
    // An exported invoice stays exported: the accountant reverses it in the books.
    const late = await c.call(`/inbound/${next?.id}/dispute`, {
      method: 'POST',
      body: { reason: 'x' },
    });
    expect(late.body.error).toMatchObject({ code: 'inbound_not_now' });
    expect((await c.download('/inbound/exports/nope/fec')).status).toBe(404);
  });
});

describe('« Mode test » supplier invoices', () => {
  it('arrive from the test supplier, apart from the real ones: normal, duplicate, new IBAN, export', async () => {
    const c = await company();
    const needsOne = await c.call('/inbound/test', { method: 'POST', body: { kind: 'duplicate' } });
    expect(needsOne.body.error).toMatchObject({ code: 'inbound_test_needs_one' });

    const normal = await c.call('/inbound/test', { method: 'POST', body: { kind: 'normal' } });
    expect(normal.status).toBe(201);
    expect(normal.body).toMatchObject({
      isTest: true,
      supplierName: 'Fournitures Démo SARL (test)',
      number: 'TEST-FD-0001',
      canApprove: true,
      flags: [{ code: 'new_supplier' }],
    });
    expect(await c.list()).toEqual([]);

    const duplicate = await c.call('/inbound/test', {
      method: 'POST',
      body: { kind: 'duplicate' },
    });
    expect((duplicate.body.flags ?? []).map((f) => f.code)).toEqual(['duplicate']);
    const changed = await c.call('/inbound/test', {
      method: 'POST',
      body: { kind: 'iban_change' },
    });
    expect(changed.body).toMatchObject({ number: 'TEST-FD-0003', needsIbanCheck: true });
    expect((changed.body.flags ?? []).map((f) => f.code)).toEqual(['iban_changed']);
    expect(await c.list(true)).toHaveLength(3);

    await c.call(`/inbound/${normal.body.id}/approve`, { method: 'POST', body: {} });
    const made = await c.call('/inbound/export', { method: 'POST', body: { test: true } });
    expect(made.body).toMatchObject({ isTest: true, count: 1, firstEntry: 1 });
    expect(String(made.body.fecName)).toMatch(/^TEST-200000008FEC\d{8}\.txt$/);
    const fec = await (await c.download(`/inbound/exports/${made.body.id}/fec`)).text();
    expect(checkFec(fec).problems).toEqual([]);
    expect(fec).toContain(`F${DEMO_SUPPLIER.siren}`);
    expect((await c.call('/inbound/exports')).body.exports).toEqual([]);
    expect((await c.call('/inbound/exports?test=true')).body.exports).toHaveLength(1);
  });

  it('come from the test platform too, and the API’s own never move the polling point', async () => {
    const c = await company();
    await c.call('/inbound/test', { method: 'POST', body: { kind: 'normal' } });
    asked.length = 0;
    // The tenant is on the mock; B2Brouter plays the test platform.
    const xml = goldenXml('01-services-standard-rate');
    delivered.b2brouter.set(c.account, [
      { pdpRef: 'b2b-1', receivedAt: new Date().toISOString(), xml },
    ]);
    await runInboundPoll(worker({ provider: 'b2brouter', scenarios: null }));
    const [received] = await c.list(true);
    expect(received).toMatchObject({ isTest: true, supplierName: 'Atelier Dupont SARL' });
    const [row] = await database.db
      .select({ provider: inboundQueue.provider })
      .from(inboundQueue)
      .where(eq(inboundQueue.id, received?.id ?? ''));
    expect(row?.provider).toBe('b2brouter');
    // The injected invoice is on the mock; the mock is still asked from the company's start.
    const [injected] = await database.db
      .select({ at: inboundQueue.receivedAt })
      .from(inboundQueue)
      .where(and(eq(inboundQueue.tenantId, c.id), eq(inboundQueue.provider, 'mock')));
    const mockSince = asked
      .filter((a) => a.provider === 'mock' && a.account === c.account)
      .map((a) => a.since.getTime());
    expect(mockSince.length).toBeGreaterThan(0);
    expect(Math.max(...mockSince)).toBeLessThan(injected?.at.getTime() ?? 0);
  });
});

describe('RGPD', () => {
  it('exports supplier invoices and their exports; deletion removes the test ones', async () => {
    const c = await company();
    await c.deliver(goldenXml('01-services-standard-rate'));
    const [real] = await c.list();
    await c.call(`/inbound/${real?.id}/approve`, { method: 'POST', body: {} });
    await c.call('/inbound/export', { method: 'POST', body: {} });
    const test = await c.call('/inbound/test', { method: 'POST', body: { kind: 'normal' } });
    await c.call(`/inbound/${test.body.id}/approve`, { method: 'POST', body: {} });
    await c.call('/inbound/export', { method: 'POST', body: { test: true } });

    const data = (await c.call('/tenant/export')).body as unknown as {
      receivedInvoices: { isTest: boolean; flags: unknown[]; decidedBy: string }[];
      accountantExports: { fec: string; isTest: boolean }[];
    };
    expect(data.receivedInvoices.map((r) => [r.isTest, r.decidedBy]).sort()).toEqual([
      [false, 'api'],
      [true, 'api'],
    ]);
    expect(data.accountantExports.map((e) => e.isTest)).toEqual([false, true]);
    expect(data.accountantExports[0]?.fec).toContain('JournalCode');

    const deleted = await c.call('/tenant', {
      method: 'DELETE',
      body: { confirmSiren: BUYER.siren },
    });
    expect(deleted.status).toBe(200);
    const kept = await database.db
      .select({ isTest: inboundQueue.isTest, decidedBy: inboundQueue.decidedBy })
      .from(inboundQueue)
      .where(eq(inboundQueue.tenantId, c.id));
    expect(kept).toEqual([{ isTest: false, decidedBy: null }]);
    const exports = await database.db
      .select({ isTest: inboundExports.isTest, createdBy: inboundExports.createdBy })
      .from(inboundExports)
      .where(eq(inboundExports.tenantId, c.id));
    expect(exports).toEqual([{ isTest: false, createdBy: 'deleted' }]);
  });
});
