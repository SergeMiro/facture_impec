// The ten-year archive (plan §10): what goes in and when, « Voir le PDF » from it, the chain the
// operator checks, and what the RGPD export and a deletion do with it.
import { computeInvoice, toCii } from '@fi/core';
import type { Database } from '@fi/db';
import { eq, invoiceArchive, invoices, sql } from '@fi/db';
import type { InboundInvoice } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keepUntil, runArchive, verifyArchive } from './archive';
import {
  ADMIN_TOKEN,
  deliveredInvoice,
  draft,
  fakeAdapter,
  newTenant,
  testApi,
  testDatabase,
} from './test-helpers';
import { runInboundPoll, type WorkerDeps } from './workers';

const received = new Map<string, InboundInvoice[]>();
const adapter = fakeAdapter({ listInbound: async ({ account }) => received.get(account) ?? [] });

let database: Database;
let api: ReturnType<typeof testApi>;

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: adapter });
});
afterAll(async () => {
  await database.close();
});

const worker = (): WorkerDeps => ({
  db: database.db,
  pdp: { mock: adapter },
  test: null,
  jobs: api.jobs,
  ai: api.deps.ai,
  mailer: null,
  now: () => new Date(),
});

const archiveOf = (tenantId: string) =>
  database.db
    .select()
    .from(invoiceArchive)
    .where(eq(invoiceArchive.tenantId, tenantId))
    .orderBy(invoiceArchive.id);

describe('what is archived', () => {
  it('keeps a real sent invoice as the platform got it, with its PDF, for ten years', async () => {
    const t = await newTenant(api.request);
    const { id } = await deliveredInvoice(api, t, draft(1));
    const [row] = await archiveOf(t.id);
    const [invoice] = await database.db.select().from(invoices).where(eq(invoices.id, id));
    expect(row).toMatchObject({
      direction: 'out',
      invoiceId: id,
      number: invoice?.number,
      xml: invoice?.xmlCii,
      keepUntil: keepUntil(new Date()),
    });
    expect(row?.pdf).toBeTruthy();
    // « Voir le PDF » shows the archived PDF, the same bytes every time.
    const pdf = async () =>
      Buffer.from(
        await (await api.request(`/invoices/${id}/pdf`, { token: t.apiKey })).arrayBuffer(),
      );
    const first = await pdf();
    expect(first.toString('base64')).toBe(row?.pdf);
    expect((await pdf()).equals(first)).toBe(true);
    expect(Number(keepUntil(new Date()).slice(0, 4))).toBe(new Date().getUTCFullYear() + 10);
  });

  it('keeps no test invoice and no draft', async () => {
    const t = await newTenant(api.request);
    await api.request('/settings', {
      method: 'PATCH',
      token: t.apiKey,
      body: { sandboxEnabled: true },
    });
    await api.request('/invoices', { method: 'POST', token: t.apiKey, body: { draft: draft(2) } });
    const res = await api.request('/invoices', {
      method: 'POST',
      token: t.apiKey,
      body: { draft: draft(3), test: true },
    });
    const { id, document } = (await res.json()) as { id: string; document: never };
    // Even a test invoice the test platform took.
    await database.db
      .update(invoices)
      .set({ pdpRef: 'inv_test', xmlCii: toCii(document) })
      .where(eq(invoices.id, id));
    await runArchive(api.deps);
    expect(await archiveOf(t.id)).toEqual([]);
  });

  it('keeps a real supplier invoice as received, and the sweep catches up on a missed send', async () => {
    const t = await newTenant(api.request);
    const supplier = computeInvoice({
      ...draft(7),
      seller: { name: 'Fournisseur SAS', legalId: { id: '200000008', scheme: '0002' } },
      buyer: { name: 'Atelier Dupont SARL', legalId: { id: '100000009', scheme: '0002' } },
    });
    received.set(t.account, [
      { pdpRef: 'in-1', receivedAt: new Date().toISOString(), xml: toCii(supplier) },
    ]);
    await runInboundPoll(worker());
    const [kept] = await archiveOf(t.id);
    expect(kept).toMatchObject({ direction: 'in', number: supplier.number, pdf: null });

    // A deposit whose archiving failed: the sweep archives it.
    const res = await api.request('/invoices', {
      method: 'POST',
      token: t.apiKey,
      body: { draft: draft(3) },
    });
    const { id, document } = (await res.json()) as { id: string; document: never };
    await database.db
      .update(invoices)
      .set({ pdpRef: 'inv_missed', xmlCii: toCii(document) })
      .where(eq(invoices.id, id));
    expect(await runArchive(api.deps)).toBe(1);
    expect(await runArchive(api.deps)).toBe(0);
    expect((await archiveOf(t.id)).map((r) => r.direction)).toEqual(['in', 'out']);
  });
});

describe('the chain', () => {
  it('lets the operator check the archive, and shows a row changed behind the trigger', async () => {
    const t = await newTenant(api.request);
    await deliveredInvoice(api, t, draft(1));
    await deliveredInvoice(api, t, draft(2));
    const check = async () =>
      (await api.request(`/admin/tenants/${t.id}/archive`, { token: ADMIN_TOKEN })).json();
    expect(await check()).toMatchObject({ rows: 2, ok: true, broken: null });
    const [first] = await archiveOf(t.id);
    await database.db.execute(
      sql`alter table invoice_archive disable trigger invoice_archive_guard`,
    );
    try {
      await database.db
        .update(invoiceArchive)
        .set({ number: 'F-FAUX' })
        .where(eq(invoiceArchive.id, first?.id ?? 0));
    } finally {
      await database.db.execute(
        sql`alter table invoice_archive enable trigger invoice_archive_guard`,
      );
    }
    expect(await verifyArchive(database.db, t.id)).toMatchObject({
      ok: false,
      broken: { id: first?.id, problem: 'chain' },
    });
  });
});

describe('RGPD', () => {
  it('lists the register in the export, and a deletion leaves the archive whole', async () => {
    const t = await newTenant(api.request);
    const { id } = await deliveredInvoice(api, t, draft(1));
    const exported = (await (await api.request('/tenant/export', { token: t.apiKey })).json()) as {
      archive: { invoiceId: string; xmlSha256: string }[];
      customers: unknown[];
    };
    expect(exported.archive).toEqual([
      expect.objectContaining({ invoiceId: id, xmlSha256: expect.any(String) }),
    ]);
    expect(exported.customers).toEqual([]);
    const deleted = await api.request('/tenant', {
      method: 'DELETE',
      token: t.apiKey,
      body: { confirmSiren: '100000009' },
    });
    expect(deleted.status).toBe(200);
    expect(await verifyArchive(database.db, t.id)).toMatchObject({ rows: 1, ok: true });
  });
});
