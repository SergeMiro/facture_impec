// Every test runs on PGlite: the same Postgres, migrations and triggers as production.
import { computeInvoice } from '@fi/core';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Database, openDatabase, rows } from './client';
import { hashOf, stableJson } from './hash';
import { auditEvents, invoiceEvents, invoices, tenants } from './schema';
import { applyTransition } from './transition';

let database: Database;
const db = () => database.db;

beforeAll(async () => {
  database = await openDatabase();
  await database.migrate();
});
afterAll(() => database.close());

async function tenant() {
  const [row] = await db()
    .insert(tenants)
    .values({ name: 'Atelier Dupont', siren: '100000009', pdpProvider: 'mock', pdpAccount: 'acc' })
    .returning();
  if (!row) throw new Error('no tenant');
  return row;
}

async function invoice(tenantId: string, number = 'F-1', isTest = false) {
  const document = computeInvoice({ number, seller: {}, buyer: {} });
  const [row] = await db()
    .insert(invoices)
    .values({ tenantId, number, isTest, draft: document, document, fingerprint: hashOf(document) })
    .returning();
  if (!row) throw new Error('no invoice');
  return row;
}

const message = (e: unknown) => String((e as { cause?: unknown }).cause ?? e);

describe('migrations', () => {
  it('create the tables and run once', async () => {
    await database.migrate();
    const tables = await rows<{ table_name: string }>(
      db(),
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(tables.map((r) => r.table_name)).toEqual([
      'agent_runs',
      'api_keys',
      'audit_events',
      'invoice_events',
      'invoices',
      'magic_links',
      'pdp_submissions',
      'sessions',
      'sheet_mappings',
      'tenants',
      'users',
      'validation_results',
    ]);
  });
});

describe('invoices.status', () => {
  it('cannot be written directly, on insert or update', async () => {
    const t = await tenant();
    const inv = await invoice(t.id);
    expect(inv.status).toBe('draft');
    const update = db().update(invoices).set({ status: 'paid' }).where(eq(invoices.id, inv.id));
    await expect(update).rejects.toSatisfy((e) => message(e).includes('applyTransition'));
    const doc = inv.document;
    const insert = db()
      .insert(invoices)
      .values({ tenantId: t.id, status: 'paid', draft: doc, document: doc, fingerprint: 'x' });
    await expect(insert).rejects.toSatisfy((e) => message(e).includes('applyTransition'));
    // Other columns stay writable.
    await db().update(invoices).set({ buyerName: 'Martin' }).where(eq(invoices.id, inv.id));
  });

  it('changes through applyTransition, with a timeline event and an audit event', async () => {
    const t = await tenant();
    const inv = await invoice(t.id);
    const result = await db().transaction((tx) =>
      applyTransition(tx, {
        invoiceId: inv.id,
        event: 'validation_passed',
        actor: 'system',
        payload: { issues: 0 },
        patch: { xmlCii: '<x/>' },
      }),
    );
    expect(result).toEqual({
      ok: true,
      from: 'draft',
      to: 'validated',
      event: 'validation_passed',
      actor: 'system',
    });
    const [row] = await db().select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row?.status).toBe('validated');
    expect(row?.xmlCii).toBe('<x/>');
    const events = await db()
      .select()
      .from(invoiceEvents)
      .where(eq(invoiceEvents.invoiceId, inv.id));
    expect(events).toMatchObject([
      {
        type: 'transition',
        event: 'validation_passed',
        fromStatus: 'draft',
        toStatus: 'validated',
      },
    ]);
    const [entry] = await db()
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.objectId, inv.id), eq(auditEvents.action, 'invoice.validation_passed')),
      );
    expect(entry?.beforeHash).toBe(hashOf({ status: 'draft', fingerprint: inv.fingerprint }));
    expect(entry?.afterHash).toBe(hashOf({ status: 'validated', fingerprint: inv.fingerprint }));
    // The guard is back on after the transition, inside the same transaction too.
    await expect(
      db().transaction(async (tx) => {
        await applyTransition(tx, { invoiceId: inv.id, event: 'approve', actor: 'user' });
        await tx.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, inv.id));
      }),
    ).rejects.toSatisfy((e) => message(e).includes('applyTransition'));
  });

  it('refuses a transition the state machine refuses, and writes nothing', async () => {
    const t = await tenant();
    const inv = await invoice(t.id);
    const refused = await db().transaction((tx) =>
      applyTransition(tx, { invoiceId: inv.id, event: 'paid', actor: 'pdp' }),
    );
    expect(refused).toEqual({ ok: false, reason: 'not_allowed_from_state' });
    const byActor = await db().transaction((tx) =>
      applyTransition(tx, { invoiceId: inv.id, event: 'validation_passed', actor: 'user' }),
    );
    expect(byActor).toEqual({ ok: false, reason: 'actor_not_allowed' });
    const missing = await db().transaction((tx) =>
      applyTransition(tx, {
        invoiceId: '00000000-0000-0000-0000-000000000000',
        event: 'cancel',
        actor: 'user',
      }),
    );
    expect(missing).toEqual({ ok: false, reason: 'not_found' });
    const events = await db()
      .select()
      .from(invoiceEvents)
      .where(eq(invoiceEvents.invoiceId, inv.id));
    expect(events).toEqual([]);
  });

  it('applies one platform event once', async () => {
    const t = await tenant();
    const inv = await invoice(t.id);
    const note = { invoiceId: inv.id, type: 'pdp_event' as const, actor: 'pdp', pdpEventId: 'e1' };
    await db().insert(invoiceEvents).values(note);
    await expect(db().insert(invoiceEvents).values(note)).rejects.toThrow();
  });
});

describe('invoice numbers', () => {
  it('are unique per tenant, apart from test invoices and cancelled ones', async () => {
    const t = await tenant();
    const first = await invoice(t.id, 'F-7');
    await expect(invoice(t.id, 'F-7')).rejects.toThrow();
    await invoice(t.id, 'F-7', true);
    await invoice((await tenant()).id, 'F-7');
    await db().transaction((tx) =>
      applyTransition(tx, { invoiceId: first.id, event: 'cancel', actor: 'user' }),
    );
    await invoice(t.id, 'F-7');
  });
});

describe('audit_events', () => {
  it('is append-only', async () => {
    const t = await tenant();
    await db().insert(auditEvents).values({
      tenantId: t.id,
      actor: 'system',
      action: 'test',
      objectType: 'tenant',
      objectId: t.id,
    });
    const refused = (e: unknown) => message(e).includes('append-only');
    await expect(db().update(auditEvents).set({ action: 'x' })).rejects.toSatisfy(refused);
    await expect(db().delete(auditEvents)).rejects.toSatisfy(refused);
    await expect(db().execute(sql`truncate audit_events`)).rejects.toSatisfy(refused);
  });
});

describe('hashes', () => {
  it('do not depend on key order', () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
