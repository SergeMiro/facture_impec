// The customer directory (plan §4 parties, §6 PartyAgent): search, confirm, refusals, and the sync
// filling what the sheet leaves empty, against the directory stand-in and a scripted platform.
import { detectMapping, type GridCell, grid } from '@fi/core';
import type { Database } from '@fi/db';
import { agentRuns, auditEvents, desc, eq, invoices } from '@fi/db';
import { namesFor, SIRENE_CASES, sirenFor } from '@fi/mock-pdp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';
import type { SyncResult } from './workbooks';

const MARTIN = 'Boulangerie Martin SAS';
const [MARTIN_LEGAL, MARTIN_SONS] = namesFor(MARTIN) as [string, string, string];
const MARTIN_SIREN = sirenFor(MARTIN_LEGAL);

/** The platform's directory knows Martin, not its namesakes. */
const routable = new Set([MARTIN_SIREN, SIRENE_CASES.noVat]);
const adapter = fakeAdapter({
  lookupRecipient: async ({ siren }) => (routable.has(siren) ? { siren } : null),
});

let database: Database;
let request: ReturnType<typeof testApi>['request'];

beforeAll(async () => {
  database = await testDatabase();
  ({ request } = testApi(database, { mock: adapter }));
});
afterAll(async () => {
  await database.close();
});

interface Candidate {
  siren: string;
  name: string;
  vatId: string | null;
  vatSource: string;
  routing: boolean | null;
  refusal: string | null;
  exactName: boolean;
  partyId: string | null;
}
interface Party {
  id: string;
  legalName: string;
  siren: string;
  vatId: string | null;
  address: { line1?: string; postCode?: string; city?: string } | null;
  email: string | null;
  names: string[];
  routing: { found: boolean } | null;
  autopilot: boolean;
  requiresPurchaseOrder: boolean;
  publicEntity: boolean;
  subcontracting: boolean;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const SELLER = {
  vatId: 'FR88100000009',
  address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
};

async function tenant() {
  const t = await newTenant(request, SELLER);
  const res = await request('/settings', {
    method: 'PATCH',
    token: t.apiKey,
    body: {
      invoiceDefaults: {
        siret: '10000000900017',
        iban: 'FR7630006000011234567890189',
        paymentDays: 30,
        operationCategory: 'services',
      },
    },
  });
  expect(res.status).toBe(200);
  return t;
}

async function search(apiKey: string, query: Record<string, string>) {
  const res = await request('/parties/search', { method: 'POST', token: apiKey, body: query });
  return {
    status: res.status,
    body: (await res.json()) as { question: string; candidates: Candidate[] } & ErrorBody,
  };
}

async function confirm(apiKey: string, siren: string, name?: string) {
  const res = await request('/parties', {
    method: 'POST',
    token: apiKey,
    body: { siren, ...(name && { name }) },
  });
  return { status: res.status, body: (await res.json()) as Party & ErrorBody };
}

describe('« Trouver ce client » (PartyAgent)', () => {
  it('finds companies by name, the exact name first, with whether the platform can deliver', async () => {
    const t = await tenant();
    const { status, body } = await search(t.apiKey, { name: 'boulangerie martin sas' });
    expect(status).toBe(200);
    expect(body.question).toMatch(/^3 entreprises correspondent\./);
    expect(body.candidates.map((c) => c.name)).toEqual(namesFor(MARTIN));
    expect(body.candidates[0]).toMatchObject({
      siren: MARTIN_SIREN,
      exactName: true,
      routing: true,
      refusal: null,
      vatSource: 'dgfip',
      partyId: null,
    });
    expect(body.candidates[1]).toMatchObject({ name: MARTIN_SONS, routing: false });
    // A deterministic agent run, no model and no tokens.
    const [run] = await database.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.tenantId, t.id))
      .orderBy(desc(agentRuns.id));
    expect(run).toMatchObject({ agent: 'party', model: 'deterministic', status: 'ok' });
    expect(run?.inputTokens).toBe(0);
  });

  it('asks for more before searching, and says when nothing matches', async () => {
    const t = await tenant();
    const short = await search(t.apiKey, { name: 'A.B' });
    expect(short.body).toEqual({
      candidates: [],
      question: expect.stringContaining('au moins 3 lettres'),
    });
    const bad = await search(t.apiKey, { siren: '123456789' });
    expect(bad.body.question).toContain('SIREN');
    expect(bad.body.candidates).toEqual([]);
    const none = await search(t.apiKey, { name: 'Société inconnue' });
    expect(none.body.candidates).toEqual([]);
    expect(none.body.question).toContain('Aucune entreprise');
    expect((await search(t.apiKey, {})).status).toBe(400);
  });

  it('retries without the post code when it narrows to nothing', async () => {
    const t = await tenant();
    const { body } = await search(t.apiKey, { name: MARTIN, postCode: '75001' });
    expect(body.candidates).toHaveLength(3);
  });

  it('lists a closed company last, with the reason, and never asks the platform about it', async () => {
    const t = await tenant();
    const { body } = await search(t.apiKey, { siren: SIRENE_CASES.closed });
    expect(body.candidates).toEqual([
      expect.objectContaining({ siren: SIRENE_CASES.closed, refusal: 'closed', routing: null }),
    ]);
  });

  it('answers calmly when the directory cannot', async () => {
    const t = await tenant();
    const { status, body } = await search(t.apiKey, { siren: SIRENE_CASES.busy });
    expect(status).toBe(503);
    expect(body.error.code).toBe('party_directory_unavailable');
    const [run] = await database.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.tenantId, t.id))
      .orderBy(desc(agentRuns.id));
    expect(run).toMatchObject({ agent: 'party', status: 'failed', reason: 'error' });
  });
});

describe("« C'est ce client »", () => {
  it('saves the company as the directory describes it, looked up again by SIREN', async () => {
    const t = await tenant();
    await search(t.apiKey, { name: MARTIN });
    const { status, body } = await confirm(t.apiKey, MARTIN_SIREN, 'Martin');
    expect(status).toBe(201);
    expect(body).toMatchObject({
      legalName: MARTIN_LEGAL,
      siren: MARTIN_SIREN,
      vatId: expect.stringMatching(new RegExp(`^FR\\d{2}${MARTIN_SIREN}$`)),
      address: { postCode: '21000', city: 'DIJON' },
      email: null,
      names: ['boulangerie martin sas', 'martin'],
      routing: { found: true },
      autopilot: false,
      requiresPurchaseOrder: false,
      publicEntity: false,
    });
    const [event] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.objectId, body.id));
    expect(event).toMatchObject({ action: 'party.confirm', actor: 'user', tenantId: t.id });
    // The next search says it is already a customer.
    const again = await search(t.apiKey, { siren: MARTIN_SIREN });
    expect(again.body.candidates[0]?.partyId).toBe(body.id);
    // Confirming again refreshes it and keeps its names.
    const twice = await confirm(t.apiKey, MARTIN_SIREN);
    expect(twice.status).toBe(201);
    expect(twice.body).toMatchObject({ id: body.id, names: ['boulangerie martin sas', 'martin'] });
    const list = await request('/parties', { token: t.apiKey });
    expect(((await list.json()) as { parties: Party[] }).parties).toHaveLength(1);
  });

  it('refuses a company the directory does not know, a closed one and a duplicate', async () => {
    const t = await tenant();
    const unknown = await confirm(t.apiKey, SIRENE_CASES.unknown);
    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'party_not_found']);
    const closed = await confirm(t.apiKey, SIRENE_CASES.closed);
    expect([closed.status, closed.body.error.code]).toEqual([409, 'party_closed']);
    const duplicate = await confirm(t.apiKey, SIRENE_CASES.duplicate);
    expect(duplicate.body.error.code).toBe('party_duplicate');
    expect(duplicate.body.error.message).toContain(SIRENE_CASES.kept);
    const invalid = await confirm(t.apiKey, '123456789');
    expect(invalid.body.error.code).toBe('siren_invalid');
    const list = await request('/parties', { token: t.apiKey });
    expect(((await list.json()) as { parties: Party[] }).parties).toEqual([]);
  });

  it('keeps no computed VAT number: only one DGFiP lists', async () => {
    const t = await tenant();
    const { body } = await confirm(t.apiKey, SIRENE_CASES.noVat);
    expect(body.vatId).toBeNull();
  });

  it('gives a name to one customer only', async () => {
    const t = await tenant();
    await search(t.apiKey, { name: MARTIN });
    const martin = await confirm(t.apiKey, MARTIN_SIREN, 'Martin');
    const sons = await confirm(t.apiKey, sirenFor(MARTIN_SONS), 'Martin');
    expect(sons.body.names).toContain('martin');
    const list = (await (await request('/parties', { token: t.apiKey })).json()) as {
      parties: Party[];
    };
    const first = list.parties.find((p) => p.id === martin.body.id);
    expect(first?.names).toEqual(['boulangerie martin sas']);
  });

  it('changes the e-mail and « Envoi automatique », forgets a customer, and stays within the company', async () => {
    const t = await tenant();
    const other = await tenant();
    const { body } = await confirm(t.apiKey, MARTIN_SIREN);
    const patch = (apiKey: string, change: unknown) =>
      request(`/parties/${body.id}`, { method: 'PATCH', token: apiKey, body: change });
    const changed = await patch(t.apiKey, { email: ' Compta@Martin.test ', autopilot: true });
    expect(await changed.json()).toMatchObject({ email: 'compta@martin.test', autopilot: true });
    expect((await patch(t.apiKey, {})).status).toBe(400);
    const stranger = await patch(other.apiKey, { autopilot: false });
    expect([stranger.status, ((await stranger.json()) as ErrorBody).error.code]).toEqual([
      404,
      'party_missing',
    ]);
    expect((await request('/parties/nope', { method: 'DELETE', token: t.apiKey })).status).toBe(
      404,
    );
    const gone = await request(`/parties/${body.id}`, { method: 'DELETE', token: t.apiKey });
    expect(gone.status).toBe(200);
    const actions = (
      await database.db.select().from(auditEvents).where(eq(auditEvents.objectId, body.id))
    ).map((e) => e.action);
    expect(actions).toEqual(['party.confirm', 'party.update', 'party.delete']);
  });
});

describe('sync: the sheet completed from the customer', () => {
  const HEADER: GridCell[] = [
    'N° Facture',
    'Date',
    'Client',
    'SIREN',
    'Désignation',
    'Qté',
    'P.U. HT',
    'TVA',
  ];
  const line = (number: string, client: string, siren: string | null = null): GridCell[] => [
    number,
    { v: 46310, t: '15/10/2026', f: 'dd/mm/yyyy' },
    client,
    siren,
    'Journée de conseil',
    1,
    450,
    { v: 0.2, t: '20%', f: '0%' },
  ];
  const sheet = (...rows: GridCell[][]) => grid('Factures', [HEADER, ...rows]);

  async function sync(apiKey: string, snapshot: ReturnType<typeof sheet>) {
    const res = await request('/workbooks/wb-parties-01/sync', {
      method: 'POST',
      token: apiKey,
      body: { snapshot, mapping: detectMapping(snapshot) },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as SyncResult;
  }

  it('fills only what the sheet leaves empty, finds the customer by name or SIREN, and links it', async () => {
    const t = await tenant();
    const party = (await confirm(t.apiKey, MARTIN_SIREN, 'Martin')).body;
    await request(`/parties/${party.id}`, {
      method: 'PATCH',
      token: t.apiKey,
      body: { email: 'compta@martin.test' },
    });
    const result = await sync(
      t.apiKey,
      sheet(
        line('F-1', 'MARTIN'),
        line('F-2', 'Martin et Cie', MARTIN_SIREN),
        line('F-3', 'Dupont'),
        line('F-4', 'Martin', sirenFor(MARTIN_SONS)),
      ),
    );
    const [byName, bySiren, stranger, otherSiren] = result.rows;
    expect(byName?.detail).toContain(
      "Complété depuis votre fiche client : le SIREN, le numéro de TVA, l'adresse, l'e-mail.",
    );
    // The sheet's name stays; the SIREN found the customer.
    expect(bySiren?.detail).toContain('le numéro de TVA');
    expect(bySiren?.detail).not.toContain('le SIREN');
    expect(stranger?.detail).not.toContain('fiche client');
    expect(otherSiren?.detail).not.toContain('fiche client');

    const row = async (id: string | null | undefined) => {
      const [r] = await database.db
        .select()
        .from(invoices)
        .where(eq(invoices.id, id ?? ''));
      return r;
    };
    const first = await row(byName?.invoiceId);
    expect(first?.partyId).toBe(party.id);
    expect(first?.document.buyer).toMatchObject({
      name: 'MARTIN',
      legalId: { id: MARTIN_SIREN, scheme: '0002' },
      electronicAddress: { id: MARTIN_SIREN, scheme: '0225' },
      vatId: party.vatId,
      address: { postCode: '21000', city: 'DIJON' },
      contact: { email: 'compta@martin.test' },
    });
    expect((await row(bySiren?.invoiceId))?.document.buyer.name).toBe('Martin et Cie');
    expect((await row(stranger?.invoiceId))?.partyId).toBeNull();
    // Another SIREN in the sheet is another customer, whatever the name says.
    expect((await row(otherSiren?.invoiceId))?.partyId).toBeNull();

    // Forgetting the customer unlinks the invoice, which keeps what was filled until the next sync.
    await request(`/parties/${party.id}`, { method: 'DELETE', token: t.apiKey });
    expect((await row(byName?.invoiceId))?.partyId).toBeNull();
    const after = await sync(t.apiKey, sheet(line('F-1', 'MARTIN')));
    expect(after.rows[0]?.detail).not.toContain('fiche client');
    expect((await row(byName?.invoiceId))?.document.buyer.legalId).toBeUndefined();
  });

  it('checks the invoices not yet sent again when the customer requires its order number', async () => {
    const t = await tenant();
    const party = (await confirm(t.apiKey, MARTIN_SIREN, 'Martin')).body;
    const first = await sync(t.apiKey, sheet(line('F-1', 'MARTIN')));
    const id = first.rows[0]?.invoiceId ?? '';
    const state = async () => {
      const [r] = await database.db.select().from(invoices).where(eq(invoices.id, id));
      return r;
    };
    expect((await state())?.status).toBe('validated');
    const patch = async (change: Record<string, boolean>) => {
      const res = await request(`/parties/${party.id}`, {
        method: 'PATCH',
        token: t.apiKey,
        body: change,
      });
      expect(res.status).toBe(200);
      return (await res.json()) as Party;
    };
    expect(await patch({ requiresPurchaseOrder: true })).toMatchObject({
      requiresPurchaseOrder: true,
      publicEntity: false,
    });
    expect((await state())?.status).toBe('needs_fix');
    const again = await sync(t.apiKey, sheet(line('F-1', 'MARTIN')));
    expect(again.rows[0]).toMatchObject({ invoiceId: id, status: 'needs_fix', errors: 1 });
    expect(again.rows[0]?.detail).toContain('bon de commande');
    await patch({ requiresPurchaseOrder: false });
    expect((await state())?.status).toBe('validated');
  });

  it("calls VAT an error on an invoice to a donneur d'ordre, only for a building firm", async () => {
    const t = await tenant();
    const party = (await confirm(t.apiKey, MARTIN_SIREN, 'Martin')).body;
    const first = await sync(t.apiKey, sheet(line('F-1', 'MARTIN')));
    const id = first.rows[0]?.invoiceId ?? '';
    const status = async () =>
      (await database.db.select().from(invoices).where(eq(invoices.id, id)))[0]?.status;
    const send = async (path: string, body: Record<string, boolean>) => {
      const res = await request(path, { method: 'PATCH', token: t.apiKey, body });
      expect(res.status).toBe(200);
      return (await res.json()) as Record<string, unknown>;
    };
    expect(await send(`/parties/${party.id}`, { subcontracting: true })).toMatchObject({
      subcontracting: true,
    });
    // Not a building firm: the BTP rules do not speak.
    expect(await status()).toBe('validated');

    expect(await send('/settings', { btp: true })).toMatchObject({ btp: true });
    expect(await status()).toBe('needs_fix');
    const again = await sync(t.apiKey, sheet(line('F-1', 'MARTIN')));
    expect(again.rows[0]).toMatchObject({ invoiceId: id, status: 'needs_fix', errors: 1 });
    expect(again.rows[0]?.detail).toContain('autoliquidée');
    const me = await request('/me', { token: t.apiKey });
    expect(((await me.json()) as { tenant: { btp: boolean } }).tenant.btp).toBe(true);

    await send(`/parties/${party.id}`, { subcontracting: false });
    expect(await status()).toBe('validated');
    await send(`/parties/${party.id}`, { subcontracting: true });
    await send('/settings', { btp: false });
    expect(await status()).toBe('validated');
  });
});
