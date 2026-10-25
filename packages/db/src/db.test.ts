// Every test runs on PGlite: the same Postgres, migrations and triggers as production.
import { computeInvoice } from '@fi/core';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Database, openDatabase, rows } from './client';
import { hashOf, stableJson } from './hash';
import {
  actions,
  auditEvents,
  blobs,
  chantiers,
  documents,
  inboundQueue,
  invoiceArchive,
  invoiceEvents,
  invoices,
  obligations,
  parties,
  tenants,
} from './schema';
import { applyInboundTransition, applyTransition } from './transition';

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
      'action_links',
      'actions',
      'agent_runs',
      'api_keys',
      'audit_events',
      'billing_usage',
      'blobs',
      'chantiers',
      'chase_plans',
      'chats',
      'check_state',
      'connected_files',
      'connected_folders',
      'connections',
      'connector_syncs',
      'doc_lines',
      'docs',
      'documents',
      'edits',
      'findings',
      'folder_items',
      'inbound_exports',
      'inbound_queue',
      'invoice_archive',
      'invoice_events',
      'invoices',
      'item_synonyms',
      'items',
      'layout_profiles',
      'links',
      'magic_links',
      'memory_findings',
      'memory_links',
      'memory_pages',
      'memory_raw',
      'memory_recalls',
      'obligations',
      'parties',
      'payment_reports',
      'pdp_submissions',
      'relay_chats',
      'relay_codes',
      'relay_inbox',
      'relay_licences',
      'rule_exceptions',
      'rule_hits',
      'rule_runs',
      'schedule_runs',
      'sessions',
      'sheet_mappings',
      'signup_requests',
      'sources',
      'stripe_events',
      'telegram_chats',
      'telegram_codes',
      'tenants',
      'uploads',
      'users',
      'validation_results',
      'vat_checks',
      'weekly_reports',
    ]);
  });
});

describe('inbound_queue.status', () => {
  it('changes only through applyInboundTransition, with an audit event', async () => {
    const t = await tenant();
    const other = await tenant();
    const values = {
      tenantId: t.id,
      provider: 'mock' as const,
      receivedAt: new Date(),
      xml: '<x/>',
    };
    const [row] = await db()
      .insert(inboundQueue)
      .values({ ...values, pdpRef: 'inb-1' })
      .returning();
    if (!row) throw new Error('no inbound row');
    const direct = db()
      .update(inboundQueue)
      .set({ status: 'approved' })
      .where(eq(inboundQueue.id, row.id));
    await expect(direct).rejects.toSatisfy((e) => message(e).includes('applyInboundTransition'));
    const insert = db()
      .insert(inboundQueue)
      .values({ ...values, pdpRef: 'inb-2', status: 'exported' });
    await expect(insert).rejects.toSatisfy((e) => message(e).includes('applyInboundTransition'));

    const move = (event: 'approve' | 'export', tenantId = t.id) =>
      db().transaction((tx) =>
        applyInboundTransition(tx, {
          id: row.id,
          tenantId,
          event,
          actor: 'user',
          patch: { decidedBy: 'api' },
          audit: { ibanChecked: false },
        }),
      );
    expect(await move('approve', other.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await move('export')).toEqual({ ok: false, reason: 'not_allowed', from: 'new' });
    const approved = await move('approve');
    expect(approved).toMatchObject({
      ok: true,
      from: 'new',
      row: { status: 'approved', decidedBy: 'api' },
    });
    const trail = await db()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.objectId, row.id), eq(auditEvents.action, 'inbound.approve')));
    expect(trail[0]).toMatchObject({
      actor: 'user',
      beforeHash: hashOf({ status: 'new' }),
      afterHash: hashOf({ status: 'approved', ibanChecked: false }),
    });
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

describe('BTP tables (docs/DECISIONS.md D2)', () => {
  const sha = (c: string) => c.repeat(64);
  const file = (tenantId: string, sha256: string, isTest = false) => ({
    tenantId,
    source: 'mail' as const,
    sourceRef: '<m1@example.fr>',
    name: 'attestation.pdf',
    mime: 'application/pdf',
    size: 3,
    sha256,
    storageKey: `${tenantId}/${sha256}`,
    isTest,
    receivedAt: new Date('2026-10-24T08:00:00Z'),
  });

  it('keeps bytes as they were, and one document per file, company and mode', async () => {
    const t = await tenant();
    const bytes = new Uint8Array([0x25, 0x50, 0x00, 0xff]);
    await db()
      .insert(blobs)
      .values({
        key: `${t.id}/${sha('a')}`,
        tenantId: t.id,
        sha256: sha('a'),
        size: 4,
        mime: 'application/pdf',
        bytes,
      });
    const [blob] = await db().select().from(blobs).where(eq(blobs.tenantId, t.id));
    expect([...(blob?.bytes ?? [])]).toEqual([...bytes]);
    const [doc] = await db()
      .insert(documents)
      .values(file(t.id, sha('a')))
      .returning();
    expect(doc).toMatchObject({ stage: 'ingested', kind: null, hints: {} });
    await expect(
      db()
        .insert(documents)
        .values(file(t.id, sha('a'))),
    ).rejects.toThrow();
    await db()
      .insert(documents)
      .values(file(t.id, sha('a'), true));
    await db()
      .insert(documents)
      .values(file((await tenant()).id, sha('a')));
  });

  it('refuses a kind, a stage or a status outside its list, and a retenue over 5 %', async () => {
    const t = await tenant();
    const refused = (name: string) => (e: unknown) => message(e).includes(name);
    await expect(
      db()
        .insert(documents)
        .values({ ...file(t.id, sha('b')), kind: 'facture' as 'avoir' }),
    ).rejects.toSatisfy(refused('documents_kind'));
    await expect(
      db()
        .insert(documents)
        .values({ ...file(t.id, sha('b')), stage: 'lost' as 'done' }),
    ).rejects.toSatisfy(refused('documents_stage'));
    await expect(
      db().insert(chantiers).values({ tenantId: t.id, name: 'Les Tilleuls', retenueBps: 600 }),
    ).rejects.toSatisfy(refused('chantiers_retenue'));
    const [doc] = await db()
      .insert(documents)
      .values(file(t.id, sha('b')))
      .returning();
    await expect(
      db()
        .insert(actions)
        .values({
          tenantId: t.id,
          kind: 'relance_facture',
          key: 'k',
          payload: {},
          isTest: false,
          status: 'done' as 'sent',
        }),
    ).rejects.toSatisfy(refused('actions_status'));
    await db().insert(actions).values({
      tenantId: t.id,
      kind: 'confirmer_tiers',
      key: 'k',
      payload: {},
      isTest: false,
      documentId: doc?.id,
    });
  });

  it('derives an obligation only from a document or an invoice, once per key', async () => {
    const t = await tenant();
    const [doc] = await db()
      .insert(documents)
      .values(file(t.id, sha('c')))
      .returning();
    const due = {
      tenantId: t.id,
      kind: 'attestation_vigilance_renouvellement' as const,
      dueOn: '2027-04-24',
      isTest: false,
    };
    await expect(
      db()
        .insert(obligations)
        .values({ ...due, key: 'a' }),
    ).rejects.toSatisfy((e: unknown) => message(e).includes('obligations_source'));
    await db()
      .insert(obligations)
      .values({ ...due, key: 'a', sourceDocumentId: doc?.id });
    await expect(
      db()
        .insert(obligations)
        .values({ ...due, key: 'a', sourceDocumentId: doc?.id }),
    ).rejects.toThrow();
    const sent = await invoice(t.id, 'F-9');
    await db()
      .insert(obligations)
      .values({ ...due, kind: 'facture_echeance', key: 'b', invoiceId: sent.id, amount: 120_000 });
  });

  it('forgets a deleted company or chantier on what pointed to it', async () => {
    const t = await tenant();
    const [sub] = await db()
      .insert(parties)
      .values({
        tenantId: t.id,
        kind: 'supplier',
        legalName: 'Plâtrerie Dumas',
        siren: '200000009',
        subcontracting: true,
      })
      .returning();
    const [site] = await db()
      .insert(chantiers)
      .values({ tenantId: t.id, name: 'Les Tilleuls', customerId: sub?.id })
      .returning();
    const [doc] = await db()
      .insert(documents)
      .values({ ...file(t.id, sha('d')), partyId: sub?.id, chantierId: site?.id })
      .returning();
    await db().delete(chantiers).where(eq(chantiers.tenantId, t.id));
    await db().delete(parties).where(eq(parties.tenantId, t.id));
    const [after] = await db()
      .select()
      .from(documents)
      .where(eq(documents.id, doc?.id ?? ''));
    expect(after).toMatchObject({ partyId: null, chantierId: null });
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

describe('invoice_archive', () => {
  it('refuses any change, and any deletion before keep_until', async () => {
    const t = await tenant();
    const row = (keepUntil: string) => ({
      tenantId: t.id,
      direction: 'out' as const,
      xml: '<x/>',
      xmlSha256: 'h',
      chain: 'c',
      archivedAt: new Date(),
      keepUntil,
    });
    await db()
      .insert(invoiceArchive)
      .values([row('2036-10-18'), row('2020-01-01')]);
    const refused = (e: unknown) => message(e).includes('kept unchanged until keep_until');
    await expect(db().update(invoiceArchive).set({ xml: '<y/>' })).rejects.toSatisfy(refused);
    await expect(
      db().delete(invoiceArchive).where(eq(invoiceArchive.keepUntil, '2036-10-18')),
    ).rejects.toSatisfy(refused);
    await expect(db().execute(sql`truncate invoice_archive`)).rejects.toSatisfy(refused);
    // Ten years on, the row may go.
    const gone = await db()
      .delete(invoiceArchive)
      .where(eq(invoiceArchive.keepUntil, '2020-01-01'))
      .returning();
    expect(gone).toHaveLength(1);
  });
});

describe('hashes', () => {
  it('do not depend on key order', () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
