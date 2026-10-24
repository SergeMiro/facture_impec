// BTP stage 3A (docs/plans/phase-3.md): the watchers draft a request for each deadline in its
// horizon, a person decides it from the pane, `action.send` checks it and e-mails it once. Plan §12's
// integration test on the e-mail channel, with what must never happen: a second e-mail, an e-mail
// for a deadline that moved or closed, an answer to an older revision, a Mode test e-mail.
import { randomBytes } from 'node:crypto';
import { frDate } from '@fi/core';
import {
  actions,
  auditEvents,
  blobs,
  type Database,
  documents,
  eq,
  obligations,
  parties,
  users,
} from '@fi/db';
import { t } from '@fi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runActionSend } from './actions';
import type { Mailer } from './deps';
import {
  ADMIN_TOKEN,
  fakeAdapter,
  newTenant,
  SIRENE_CASES,
  signIn,
  testApi,
  testDatabase,
} from './test-helpers';
import { runWatchers } from './watchers';

let database: Database;
let api: ReturnType<typeof testApi>;
/** The business clock: Saturday 24 October 2026, 10:00 in Paris. */
let clock = new Date('2026-10-24T08:00:00Z');

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN, { now: () => clock });
});
afterAll(() => database.close());

const watch = () => runWatchers({ db: database.db, jobs: api.jobs, now: () => clock });
const send = (id: string, mailer: Mailer | null = api.mailer) =>
  runActionSend({ db: database.db, mailer, now: () => clock }, id);

interface ActionJson {
  id: string;
  kind: string;
  status: string;
  revision: number;
  error: string | null;
  email: { to: string | null; subject: string; body: string; notSent: boolean } | null;
  siren: string | null;
  party: { id: string; name: string } | null;
  obligation: { id: string; kind: string; dueOn: string } | null;
}
interface ErrorBody {
  error: { code: string; message: string };
}

let files = 0;

/** A company with a sous-traitant (`email` or none) and one of its documents. */
async function company(email: string | null = 'contact@platrerie-dumas.example') {
  const tenant = await newTenant(api.request);
  const db = database.db;
  const [sub] = await db
    .insert(parties)
    .values({
      tenantId: tenant.id,
      kind: 'supplier',
      legalName: 'Plâtrerie Dumas',
      siren: '200000009',
      email,
      subcontracting: true,
      source: 'invoice',
    })
    .returning();
  if (!sub) throw new Error('no supplier');
  const file = async (
    kind: (typeof documents.$inferInsert)['kind'],
    more: Partial<typeof documents.$inferInsert> = {},
  ) => {
    const sha256 = (++files).toString(16).padStart(64, '0');
    const storageKey = `${tenant.id}/${sha256}`;
    await db.insert(blobs).values({
      key: storageKey,
      tenantId: tenant.id,
      sha256,
      size: 3,
      mime: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const [row] = await db
      .insert(documents)
      .values({
        tenantId: tenant.id,
        source: 'mail',
        sourceRef: `<${sha256}@example>`,
        name: `${kind}.pdf`,
        mime: 'application/pdf',
        size: 3,
        sha256,
        storageKey,
        kind,
        stage: 'done',
        partyId: sub.id,
        isTest: false,
        receivedAt: clock,
        ...more,
      })
      .returning();
    if (!row) throw new Error('no document');
    return row;
  };
  const deadline = async (more: Partial<typeof obligations.$inferInsert> & { dueOn: string }) => {
    const doc = await file('attestation_vigilance', { isTest: more.isTest ?? false });
    const [row] = await db
      .insert(obligations)
      .values({
        tenantId: tenant.id,
        kind: 'attestation_vigilance_renouvellement',
        key: `attestation_vigilance_renouvellement:${randomBytes(4).toString('hex')}`,
        partyId: sub.id,
        sourceDocumentId: doc.id,
        isTest: false,
        ...more,
      })
      .returning();
    if (!row) throw new Error('no deadline');
    return row;
  };
  const list = async (query = '') => {
    const res = await api.request(`/actions${query}`, { token: tenant.apiKey });
    expect(res.status).toBe(200);
    return ((await res.json()) as { actions: ActionJson[] }).actions;
  };
  const decide = (id: string, input: Record<string, unknown>, token = tenant.apiKey) =>
    api.request(`/actions/${id}/decide`, { method: 'POST', token, body: input });
  return { tenant, sub, file, deadline, list, decide };
}

const actionRow = async (id: string) => {
  const [row] = await database.db.select().from(actions).where(eq(actions.id, id));
  if (!row) throw new Error('no action');
  return row;
};
const mailsTo = (to: string) => api.mailer.sent.filter((m) => m.to === to);
const auditOf = async (id: string) =>
  (await database.db.select().from(auditEvents).where(eq(auditEvents.objectId, id))).map(
    (e) => e.action,
  );

describe('the watchers', () => {
  it('draft one request per deadline in its horizon, once, with what it will send', async () => {
    const c = await company();
    const soon = await c.deadline({ dueOn: '2026-11-10' });
    await c.deadline({ dueOn: '2027-04-24' });
    const first = await watch();
    expect(first.drafted).toBeGreaterThanOrEqual(1);
    expect((await watch()).drafted).toBe(0);
    const drafts = await c.list();
    expect(drafts).toHaveLength(1);
    const [d] = drafts;
    expect(d).toMatchObject({
      kind: 'demande_attestation_vigilance',
      status: 'draft',
      revision: 0,
      party: { id: c.sub.id, name: 'Plâtrerie Dumas' },
      obligation: { id: soon.id, dueOn: '2026-11-10' },
      email: { to: 'contact@platrerie-dumas.example', notSent: false },
    });
    expect(d?.email?.body).toContain(frDate('2026-11-10'));
    expect(d?.email?.body).toContain('Atelier Dupont SARL');
    expect(await auditOf(d?.id ?? '')).toEqual(['action.draft']);
  });

  it('ask for a retenue on its day and remind an invoice only once it is overdue', async () => {
    const c = await company();
    const [customer] = await database.db
      .insert(parties)
      .values({
        tenantId: c.tenant.id,
        kind: 'customer',
        legalName: 'SCI Les Tilleuls',
        siren: '300000008',
      })
      .returning();
    const pv = await c.file('pv_reception', { partyId: customer?.id });
    const sale = await c.file('facture_vente', {
      partyId: customer?.id,
      extracted: {
        invoice: {
          number: 'F2026-104',
          currency: 'EUR',
          buyer: { contact: { email: 'compta@tilleuls.example' } },
        },
      },
    });
    const add = (
      kind: 'retenue_garantie_liberation' | 'facture_echeance',
      dueOn: string,
      doc: string,
    ) =>
      database.db.insert(obligations).values({
        tenantId: c.tenant.id,
        kind,
        dueOn,
        key: `${kind}:${randomBytes(4).toString('hex')}`,
        partyId: customer?.id,
        sourceDocumentId: doc,
        amount: kind === 'facture_echeance' ? 180_000 : null,
        isTest: false,
      });
    await add('retenue_garantie_liberation', '2026-10-30', pv.id);
    await add('facture_echeance', '2026-10-24', sale.id);
    await watch();
    expect(await c.list()).toHaveLength(0);
    clock = new Date('2026-10-31T08:00:00Z');
    try {
      await watch();
      const drafts = await c.list();
      expect(drafts.map((d) => d.kind).sort()).toEqual([
        'demande_liberation_retenue',
        'relance_facture',
      ]);
      const reminder = drafts.find((d) => d.kind === 'relance_facture');
      // The customer has no address of its own: the invoice's buyer contact is used.
      expect(reminder?.email?.to).toBe('compta@tilleuls.example');
      expect(reminder?.email?.subject).toContain('F2026-104');
    } finally {
      clock = new Date('2026-10-24T08:00:00Z');
    }
  });

  it("withdraw a draft whose deadline moved, and « C'est fait » withdraws the next", async () => {
    const c = await company();
    const due = await c.deadline({ dueOn: '2026-11-10' });
    await watch();
    const [old] = await c.list();
    // A newer attestation came: the deadline moves on, and is still in the horizon.
    await database.db
      .update(obligations)
      .set({ dueOn: '2026-11-20' })
      .where(eq(obligations.id, due.id));
    const run = await watch();
    expect(run.withdrawn).toBeGreaterThanOrEqual(1);
    expect(await actionRow(old?.id ?? '')).toMatchObject({
      status: 'rejected',
      comment: 'deadline_moved',
      decidedBy: 'agent:watch',
      revision: 1,
    });
    const [next] = await c.list();
    expect(next?.obligation?.dueOn).toBe('2026-11-20');
    const closed = await api.request(`/obligations/${due.id}/close`, {
      method: 'POST',
      token: c.tenant.apiKey,
      body: { status: 'done' },
    });
    expect(await closed.json()).toEqual({ id: due.id, status: 'done', withdrawn: 1 });
    expect(await c.list()).toHaveLength(0);
    expect(await watch()).toMatchObject({ drafted: 0 });
    const again = await api.request(`/obligations/${due.id}/close`, {
      method: 'POST',
      token: c.tenant.apiKey,
      body: { status: 'dismissed' },
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorBody).error.code).toBe('obligation_closed');
  });
});

describe('a decision', () => {
  it('approved in the pane sends one e-mail, once, with answers going to the person', async () => {
    const c = await company('dumas@example.test');
    const due = await c.deadline({ dueOn: '2026-11-10' });
    const email = `gerant${randomBytes(4).toString('hex')}@example.test`;
    await database.db.insert(users).values({ tenantId: c.tenant.id, email, role: 'member' });
    const session = await signIn(api.request, api.mailer, email);
    await watch();
    const [d] = await c.list();
    const id = d?.id ?? '';
    const res = await c.decide(
      id,
      { revision: 0, decision: 'approve', channel: 'telegram' },
      session,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'approved', revision: 1, channel: 'excel' });
    expect(api.jobs.actions).toContain(id);
    // A second answer, from wherever, sends nothing more.
    const twice = await c.decide(id, { revision: 1, decision: 'approve' });
    expect(twice.status).toBe(409);
    expect(((await twice.json()) as ErrorBody).error.code).toBe('action_already_decided');
    await send(id);
    await send(id);
    const mails = mailsTo('dumas@example.test');
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ replyTo: email, subject: d?.email?.subject });
    expect(await actionRow(id)).toMatchObject({ status: 'sent', error: null });
    const [row] = await database.db.select().from(obligations).where(eq(obligations.id, due.id));
    expect(row?.lastRemindedAt).not.toBeNull();
    expect(await auditOf(id)).toEqual(['action.draft', 'action.decide', 'action.sent']);
    expect(await c.list('?status=sent')).toHaveLength(1);
  });

  it('to an older revision or to another company is refused in plain French', async () => {
    const c = await company();
    await c.deadline({ dueOn: '2026-11-10' });
    await watch();
    const [d] = await c.list();
    const id = d?.id ?? '';
    const edited = await c.decide(id, { revision: 0, decision: 'edit', comment: 'Bonjour, …' });
    expect(edited.status).toBe(200);
    const stale = await c.decide(id, { revision: 0, decision: 'approve' });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as ErrorBody;
    expect(body.error.code).toBe('action_revision_changed');
    expect(body.error.message).toBe(t('api.error.action_revision_changed'));
    const other = await company();
    const foreign = await other.decide(id, { revision: 1, decision: 'approve' });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as ErrorBody).error.code).toBe('action_not_found');
    const bad = await c.decide('not-an-id', { revision: 1, decision: 'approve' });
    expect(bad.status).toBe(404);
    const wrong = await c.decide(id, { revision: 1, decision: 'approve', to: 'x@example.test' });
    expect(wrong.status).toBe(400);
  });

  it('without an address asks for one; « Modifier » adds it, and the company keeps it', async () => {
    const c = await company(null);
    await c.deadline({ dueOn: '2026-11-10' });
    await watch();
    const [d] = await c.list();
    const id = d?.id ?? '';
    expect(d?.email?.to).toBeNull();
    const refused = await c.decide(id, { revision: 0, decision: 'approve' });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as ErrorBody).error.code).toBe('action_needs_recipient');
    const text = 'Bonjour,\n\nPourriez-vous nous adresser votre attestation ?\n\nMerci.';
    const edited = await c.decide(id, {
      revision: 0,
      decision: 'edit',
      comment: text,
      to: 'jean@dumas.example',
    });
    expect(await edited.json()).toMatchObject({
      status: 'draft',
      revision: 1,
      email: { to: 'jean@dumas.example', body: text },
    });
    const [party] = await database.db.select().from(parties).where(eq(parties.id, c.sub.id));
    expect(party?.email).toBe('jean@dumas.example');
    expect((await c.decide(id, { revision: 1, decision: 'approve' })).status).toBe(200);
    await send(id);
    expect(mailsTo('jean@dumas.example').map((m) => m.text)).toEqual([text]);
  });

  it('snoozed comes back on its day, within thirty days only', async () => {
    const c = await company();
    await c.deadline({ dueOn: '2026-11-10' });
    await watch();
    const [d] = await c.list();
    const id = d?.id ?? '';
    const far = await c.decide(id, {
      revision: 0,
      decision: 'snooze',
      snoozeUntil: '2026-12-24T08:00:00Z',
    });
    expect(far.status).toBe(400);
    expect(((await far.json()) as ErrorBody).error.code).toBe('action_snooze_range');
    const later = await c.decide(id, {
      revision: 0,
      decision: 'snooze',
      snoozeUntil: '2026-10-27T07:00:00Z',
    });
    expect(await later.json()).toMatchObject({ status: 'snoozed', revision: 1 });
    expect(await c.list()).toHaveLength(0);
    expect((await watch()).woken).toBe(0);
    clock = new Date('2026-10-27T08:00:00Z');
    try {
      expect((await watch()).woken).toBeGreaterThanOrEqual(1);
    } finally {
      clock = new Date('2026-10-24T08:00:00Z');
    }
    expect(await c.list()).toMatchObject([{ id, status: 'draft', revision: 1 }]);
  });

  it('approved for a deadline closed meanwhile is not sent', async () => {
    const c = await company('closed@dumas.example');
    const due = await c.deadline({ dueOn: '2026-11-10' });
    await watch();
    const [d] = await c.list();
    const id = d?.id ?? '';
    await c.decide(id, { revision: 0, decision: 'approve' });
    await database.db.update(obligations).set({ status: 'done' }).where(eq(obligations.id, due.id));
    await send(id);
    expect(mailsTo('closed@dumas.example')).toHaveLength(0);
    expect(await actionRow(id)).toMatchObject({ status: 'failed', error: 'no_longer_needed' });
  });
});

describe('sending', () => {
  it('in Mode test e-mails nobody', async () => {
    const c = await company('test@dumas.example');
    await c.deadline({ dueOn: '2026-11-10', isTest: true });
    await watch();
    expect(await c.list()).toHaveLength(0);
    const [d] = await c.list('?test=true');
    expect(d?.email?.subject.startsWith(t('chase.testPrefix'))).toBe(true);
    const id = d?.id ?? '';
    await c.decide(id, { revision: 0, decision: 'approve' });
    await send(id);
    expect(mailsTo('test@dumas.example')).toHaveLength(0);
    const [sent] = await c.list('?test=true&status=sent');
    expect(sent?.email?.notSent).toBe(true);
  });

  it('that never finished goes back to a person instead of going out twice', async () => {
    const c = await company('unsure@dumas.example');
    await c.deadline({ dueOn: '2026-11-10' });
    await watch();
    const [d] = await c.list();
    const id = d?.id ?? '';
    await c.decide(id, { revision: 0, decision: 'approve' });
    const row = await actionRow(id);
    const eleven = new Date(Date.now() - 11 * 60_000).toISOString();
    await database.db
      .update(actions)
      .set({ payload: { ...row.payload, sendingAt: eleven } })
      .where(eq(actions.id, id));
    await send(id);
    expect(mailsTo('unsure@dumas.example')).toHaveLength(0);
    expect((await watch()).unclaimed).toBeGreaterThanOrEqual(1);
    const back = await actionRow(id);
    expect(back).toMatchObject({ status: 'draft', error: 'send_unknown', revision: 2 });
    expect(back.payload.sendingAt).toBeUndefined();
  });

  it('tries a failing mail three times, then leaves it failed', async () => {
    const c = await company('down@dumas.example');
    await c.deadline({ dueOn: '2026-11-10' });
    await watch();
    const [d] = await c.list();
    const id = d?.id ?? '';
    await c.decide(id, { revision: 0, decision: 'approve' });
    const down: Mailer = {
      send: async () => {
        throw new Error('smtp down');
      },
    };
    await expect(send(id, down)).rejects.toThrow('smtp down');
    expect(await actionRow(id)).toMatchObject({ status: 'approved', error: 'mail_failed' });
    await expect(send(id, down)).rejects.toThrow('smtp down');
    await send(id, down);
    expect(await actionRow(id)).toMatchObject({ status: 'failed', error: 'mail_failed' });
    expect((await actionRow(id)).payload.tries).toBe(3);
  });
});

describe('« Ajouter comme fournisseur »', () => {
  it('adds the company from the directory and links its documents and deadlines', async () => {
    const c = await company();
    const siren = '400000006';
    const doc = await c.file('attestation_vigilance', { partyId: null, extracted: { siren } });
    const [due] = await database.db
      .insert(obligations)
      .values({
        tenantId: c.tenant.id,
        kind: 'attestation_vigilance_renouvellement',
        dueOn: '2026-11-05',
        key: `attestation_vigilance_renouvellement:${siren}`,
        sourceDocumentId: doc.id,
        isTest: false,
      })
      .returning();
    const [ask] = await database.db
      .insert(actions)
      .values({
        tenantId: c.tenant.id,
        kind: 'confirmer_tiers',
        key: `confirmer_tiers:${siren}`,
        documentId: doc.id,
        payload: { siren, documentKind: 'attestation_vigilance' },
        isTest: false,
      })
      .returning();
    const id = ask?.id ?? '';
    expect(await watch()).toMatchObject({ drafted: 0 });
    const [listed] = await c.list();
    expect(listed).toMatchObject({ kind: 'confirmer_tiers', siren, email: null });
    const edit = await c.decide(id, { revision: 0, decision: 'edit', comment: 'x' });
    expect(edit.status).toBe(422);
    expect(((await edit.json()) as ErrorBody).error.code).toBe('action_not_editable');
    const res = await c.decide(id, { revision: 0, decision: 'approve' });
    expect(await res.json()).toMatchObject({ status: 'approved', revision: 1 });
    expect(api.jobs.actions).not.toContain(id);
    const [added] = await database.db.select().from(parties).where(eq(parties.siren, siren));
    expect(added).toMatchObject({ kind: 'supplier', source: 'sirene', tenantId: c.tenant.id });
    expect(added?.verifiedAt).not.toBeNull();
    const [linked] = await database.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(linked?.partyId).toBe(added?.id);
    const [row] = await database.db
      .select()
      .from(obligations)
      .where(eq(obligations.id, due?.id ?? ''));
    expect(row?.partyId).toBe(added?.id);
    // Its deadline now has a company to ask: the request is there at once (no address yet).
    const [request] = await c.list();
    expect(request).toMatchObject({
      kind: 'demande_attestation_vigilance',
      party: { id: added?.id },
      email: { to: null },
    });
  });

  it('refuses a company the directory says is closed', async () => {
    const c = await company();
    const siren = SIRENE_CASES.closed;
    const [ask] = await database.db
      .insert(actions)
      .values({
        tenantId: c.tenant.id,
        kind: 'confirmer_tiers',
        key: `confirmer_tiers:${siren}`,
        payload: { siren, documentKind: 'kbis' },
        isTest: false,
      })
      .returning();
    const res = await c.decide(ask?.id ?? '', { revision: 0, decision: 'approve' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('supplier_closed');
    expect(await actionRow(ask?.id ?? '')).toMatchObject({ status: 'draft', revision: 0 });
  });
});
