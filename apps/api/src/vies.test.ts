// EU customers' VAT numbers in VIES (plan §6 PartyAgent `vies.check`): the client against answers
// as VIES gave them on 2026-10-24, then the sweep against the stand-in of apps/mock-pdp — what it
// asks, keeps, writes on the timeline and checks again, and what the RGPD export and a deletion do.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type InvoiceDraft, parisToday, viesNumber } from '@fi/core';
import { and, auditEvents, type Database, eq, validationResults, vatChecks } from '@fi/db';
import { VIES_CASES, viesStandIn } from '@fi/mock-pdp';
import { REPO_ROOT } from '@fi/shared/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_TOKEN,
  deliveredInvoice,
  draft,
  fakeAdapter,
  inProcess,
  newTenant,
  testApi,
  testDatabase,
} from './test-helpers';
import { runVatChecks, VAT_CHECKS_PER_SWEEP } from './vat-checks';
import { RememberingVies, VIES_FAILURE_MEMORY_MS, ViesClient, ViesUnavailable } from './vies';

const number = (vatId: string) => {
  const n = viesNumber(vatId);
  if (!n) throw new Error(`not a VIES number: ${vatId}`);
  return n;
};

/** A reply other than HTTP 200 with a JSON body. */
class Http {
  constructor(
    readonly status: number,
    readonly body: string | object,
  ) {}
}

/** A fetch that answers each call with the next scripted body, and keeps what was sent. */
function scripted(...answers: unknown[]) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    const reply = next instanceof Http ? next : new Http(200, next as object);
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { sent, fetcher };
}

const refusal = (error: string) => ({ actionSucceed: false, errorWrappers: [{ error }] });

describe('the VIES client', () => {
  const base = 'https://ec.europa.eu/taxation_customs/vies/rest-api';

  it('asks with our number as requester and reads the answer, Ireland as VIES gave it', async () => {
    const { sent, fetcher } = scripted({
      countryCode: 'IE',
      vatNumber: '6388047V',
      requestDate: '2026-10-24T11:26:17.003Z',
      valid: true,
      requestIdentifier: 'WAPIAAAAZ1234567',
      name: 'GOOGLE IRELAND LIMITED',
      address: '3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4',
      traderName: '---',
      traderNameMatch: 'NOT_PROCESSED',
    });
    const answer = await new ViesClient(base, fetcher).check(number('IE6388047V'), 'FR88100000009');
    expect(sent).toEqual([
      {
        url: `${base}/check-vat-number`,
        body: {
          countryCode: 'IE',
          vatNumber: '6388047V',
          requesterMemberStateCode: 'FR',
          requesterNumber: '88100000009',
        },
      },
    ]);
    expect(answer).toEqual({
      valid: true,
      name: 'GOOGLE IRELAND LIMITED',
      address: '3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4',
      requestIdentifier: 'WAPIAAAAZ1234567',
      requestDate: new Date('2026-10-24T11:26:17.003Z'),
    });
  });

  it('reads « --- » and an empty consultation number as nothing, and a « not valid »', async () => {
    const { fetcher } = scripted({
      countryCode: 'DE',
      vatNumber: '129273398',
      requestDate: '2026-10-24T11:26:17.148Z',
      valid: false,
      requestIdentifier: '',
      name: '---',
      address: '---',
    });
    const answer = await new ViesClient(base, fetcher).check(number('DE129273398'), null);
    expect(answer).toMatchObject({
      valid: false,
      name: null,
      address: null,
      requestIdentifier: null,
    });
  });

  it('takes a number VIES finds malformed as not valid', async () => {
    const now = new Date('2026-10-24T09:00:00Z');
    const { fetcher } = scripted(refusal('INVALID_INPUT'));
    const answer = await new ViesClient(base, fetcher, () => now).check(number('ES00'), null);
    expect(answer).toEqual({
      valid: false,
      name: null,
      address: null,
      requestIdentifier: null,
      requestDate: now,
    });
  });

  it('asks again without requester when VIES refuses ours', async () => {
    const { sent, fetcher } = scripted(refusal('INVALID_REQUESTER_INFO'), {
      countryCode: 'DE',
      vatNumber: '129273398',
      requestDate: '2026-10-24T11:26:17.148Z',
      valid: true,
      requestIdentifier: '',
      name: '---',
      address: '---',
    });
    const answer = await new ViesClient(base, fetcher).check(
      number('DE129273398'),
      'FR00000000000',
    );
    expect(answer.valid).toBe(true);
    expect(sent.map((s) => s.body)).toEqual([
      expect.objectContaining({ requesterNumber: '00000000000' }),
      { countryCode: 'DE', vatNumber: '129273398' },
    ]);
  });

  it('says it could not answer when VIES is busy, down, out of reach or unreadable', async () => {
    const cases: [unknown, string][] = [
      [refusal('MS_MAX_CONCURRENT_REQ'), 'MS_MAX_CONCURRENT_REQ'],
      [refusal('SERVICE_UNAVAILABLE'), 'SERVICE_UNAVAILABLE'],
      [refusal('VAT_BLOCKED'), 'VAT_BLOCKED'],
      [new TypeError('fetch failed'), 'network'],
      [new Http(502, '<html>Bad Gateway</html>'), 'network'],
      [new Http(500, { errorWrappers: [{ error: 'VOW-ERR-1' }] }), 'http_500'],
      [{ valid: 'yes' }, 'http_200'],
    ];
    for (const [reply, code] of cases) {
      const { fetcher } = scripted(reply);
      const asked = new ViesClient(base, fetcher).check(number('DE129273398'), null);
      await expect(asked).rejects.toEqual(new ViesUnavailable(code));
    }
  });
});

describe('VIES remembering it could not answer', () => {
  /** VIES failing with `codes[vatId]`, else valid; counts the questions. */
  function failing(codes: Record<string, string>) {
    const asked: string[] = [];
    let clock = new Date('2026-10-25T09:00:00Z');
    const vies = new RememberingVies(
      {
        check: async (n) => {
          asked.push(n.vatId);
          const code = codes[n.vatId];
          if (code) throw new ViesUnavailable(code);
          return {
            valid: true,
            name: null,
            address: null,
            requestIdentifier: null,
            requestDate: clock,
          };
        },
      },
      () => clock,
    );
    const later = (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    };
    return { vies, asked, later };
  }

  it('answers a number it could not ask about at once, for a few minutes', async () => {
    const { vies, asked, later } = failing({ DE129273398: 'VAT_BLOCKED' });
    const de = number('DE129273398');
    await expect(vies.check(de, null)).rejects.toEqual(new ViesUnavailable('VAT_BLOCKED'));
    later(VIES_FAILURE_MEMORY_MS - 1);
    await expect(vies.check(de, null)).rejects.toEqual(new ViesUnavailable('VAT_BLOCKED'));
    // Another number of the same country is asked.
    await expect(vies.check(number('DE811115368'), null)).resolves.toMatchObject({ valid: true });
    later(1);
    await expect(vies.check(de, null)).rejects.toEqual(new ViesUnavailable('VAT_BLOCKED'));
    expect(asked).toEqual(['DE129273398', 'DE811115368', 'DE129273398']);
  });

  it("remembers a member state down for all its numbers, and never VIES' answers", async () => {
    const { vies, asked, later } = failing({ IT00743110157: 'MS_UNAVAILABLE' });
    await expect(vies.check(number('IT00743110157'), null)).rejects.toEqual(
      new ViesUnavailable('MS_UNAVAILABLE'),
    );
    await expect(vies.check(number('IT01234567897'), null)).rejects.toEqual(
      new ViesUnavailable('MS_UNAVAILABLE'),
    );
    await vies.check(number('DE129273398'), null);
    await vies.check(number('DE129273398'), null);
    later(VIES_FAILURE_MEMORY_MS);
    await vies.check(number('IT01234567897'), null);
    expect(asked).toEqual(['IT00743110157', 'DE129273398', 'DE129273398', 'IT01234567897']);
  });
});

const golden06 = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'fixtures/golden/06-intra-eu-supply.json'), 'utf8'),
) as { draft: InvoiceDraft };

/** Golden invoice 06 (an intra-EU supply, K), numbered and dated as `draft(index)`, sold to `vatId`. */
function euDraft(index: number, vatId: string): InvoiceDraft {
  const dated = draft(index);
  const d = structuredClone(golden06.draft);
  d.number = dated.number;
  d.issueDate = dated.issueDate;
  d.dueDate = dated.dueDate;
  if (d.delivery) d.delivery = { ...d.delivery, date: dated.issueDate };
  const country = vatId.slice(0, 2) === 'EL' ? 'GR' : vatId.slice(0, 2);
  d.buyer = { ...d.buyer, vatId, address: { ...d.buyer.address, country } };
  return d;
}

describe('the sweep asking VIES', () => {
  let database: Database;
  let api: ReturnType<typeof testApi>;
  // A running clock, `shift` ahead: two verdicts never share an instant.
  let shift = 0;
  const standIn = inProcess(viesStandIn());
  const asked: string[] = [];
  const vies = new ViesClient('http://vies.test', async (url, init) => {
    const body = JSON.parse(String(init?.body)) as { countryCode: string; vatNumber: string };
    asked.push(`${body.countryCode}${body.vatNumber}`);
    return standIn(url, init);
  });
  const logged: string[] = [];
  const sweep = () => runVatChecks(api.deps, (m) => logged.push(m));

  beforeAll(async () => {
    database = await testDatabase();
    api = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN, {
      vies,
      now: () => new Date(Date.now() + shift),
    });
  });
  afterAll(async () => {
    await database.close();
  });

  const create = async (apiKey: string, d: InvoiceDraft) => {
    const res = await api.request('/invoices', {
      method: 'POST',
      token: apiKey,
      body: { draft: d },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const detail = async (apiKey: string, id: string) =>
    (await (await api.request(`/invoices/${id}`, { token: apiKey })).json()) as {
      issues: { ruleId: string; severity: string; path: string }[];
      events: { type: string; event: string | null; payload: Record<string, unknown> }[];
    };
  const notes = async (apiKey: string, id: string) =>
    (await detail(apiKey, id)).events.filter((e) => e.event === 'vat_check');
  const verdicts = async (id: string) =>
    (await database.db.select().from(validationResults).where(eq(validationResults.invoiceId, id)))
      .length;

  it('keeps the answer with its proof, notes it, and warns on a number VIES says is not valid', async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    const id = await create(t.apiKey, euDraft(1, VIES_CASES.invalid));
    expect((await detail(t.apiKey, id)).issues.map((i) => i.ruleId)).not.toContain('FF-VIES-01');
    asked.length = 0;

    expect(await sweep()).toBe(1);
    expect(asked).toEqual([VIES_CASES.invalid]);
    const [kept] = await database.db.select().from(vatChecks).where(eq(vatChecks.tenantId, t.id));
    expect(kept).toMatchObject({
      vatId: VIES_CASES.invalid,
      valid: false,
      name: null,
      requestIdentifier: expect.stringMatching(/^WAPIDEMO/),
    });
    const [logged] = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, t.id), eq(auditEvents.action, 'vat.check')));
    expect(logged).toMatchObject({
      actor: 'agent:party',
      objectType: 'vat_check',
      objectId: kept?.id,
    });
    const shown = await detail(t.apiKey, id);
    expect(shown.issues).toContainEqual(
      expect.objectContaining({ ruleId: 'FF-VIES-01', severity: 'warning', path: 'buyer.vatId' }),
    );
    expect(await notes(t.apiKey, id)).toEqual([
      expect.objectContaining({
        type: 'note',
        payload: {
          vatId: VIES_CASES.invalid,
          valid: false,
          requestIdentifier: kept?.requestIdentifier,
          checkedOn: kept?.checkedOn,
        },
      }),
    ]);
  });

  it('asks once a day per number, and notes or re-checks only when VIES changes its mind', async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    const id = await create(t.apiKey, euDraft(2, 'DE811569869'));
    const other = await create(t.apiKey, euDraft(3, 'de 811 569 869'));
    asked.length = 0;
    expect(await sweep()).toBe(1);
    expect(asked).toEqual(['DE811569869']);
    expect(await notes(t.apiKey, id)).toHaveLength(1);
    expect(await notes(t.apiKey, other)).toHaveLength(1);
    expect((await detail(t.apiKey, id)).issues.map((i) => i.ruleId)).not.toContain('FF-VIES-01');
    const before = await verdicts(id);
    const ours = () => asked.filter((n) => n === 'DE811569869');

    await sweep();
    expect(ours()).toHaveLength(1);

    shift = 86_400_000;
    try {
      await sweep();
      expect(ours()).toHaveLength(2);
      expect(await notes(t.apiKey, id)).toHaveLength(1);
      expect(await verdicts(id)).toBe(before);
      expect(
        await database.db.select().from(vatChecks).where(eq(vatChecks.tenantId, t.id)),
      ).toHaveLength(2);
    } finally {
      shift = 0;
    }
  });

  it('never asks about French numbers, standard-rate sales or invoices already sent', async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    await create(t.apiKey, draft(4));
    const taxed = draft(5);
    taxed.buyer = { ...taxed.buyer, vatId: 'DE136695976' };
    await create(t.apiKey, taxed);
    await deliveredInvoice(api, t, euDraft(6, 'ATU13585627'));
    asked.length = 0;
    await sweep();
    expect(asked).toEqual([]);
    expect(await database.db.select().from(vatChecks).where(eq(vatChecks.tenantId, t.id))).toEqual(
      [],
    );
  });

  it('keeps nothing when VIES cannot answer, and goes on with the other member states', async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    const busy = await create(t.apiKey, euDraft(7, VIES_CASES.busy));
    await create(t.apiKey, euDraft(8, 'ESB12345674'));
    asked.length = 0;
    logged.length = 0;
    await sweep();
    expect(asked).toEqual(expect.arrayContaining([VIES_CASES.busy, 'ESB12345674']));
    const kept = await database.db.select().from(vatChecks).where(eq(vatChecks.tenantId, t.id));
    expect(kept.map((k) => k.vatId)).toEqual(['ESB12345674']);
    expect(await notes(t.apiKey, busy)).toEqual([]);
    expect(logged).toContainEqual(expect.stringContaining('MS_MAX_CONCURRENT_REQ'));
  });

  it('stops asking for this sweep when VIES itself is down, and asks at most a batch', async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    for (let i = 0; i <= VAT_CHECKS_PER_SWEEP; i++) {
      await create(t.apiKey, euDraft(100 + i, `NL${String(800000000 + i)}B01`));
    }
    asked.length = 0;
    await sweep();
    expect(asked).toHaveLength(VAT_CHECKS_PER_SWEEP);
    await sweep();
    expect(
      await database.db.select().from(vatChecks).where(eq(vatChecks.tenantId, t.id)),
    ).toHaveLength(VAT_CHECKS_PER_SWEEP + 1);

    const down = new ViesClient('http://vies.test', async () => {
      asked.push('down');
      return new Response(JSON.stringify(refusal('SERVICE_UNAVAILABLE')));
    });
    const u = await newTenant(api.request, { vatId: 'FR88100000009' });
    await create(u.apiKey, euDraft(200, 'PL5260250995'));
    await create(u.apiKey, euDraft(201, 'SE556703748501'));
    asked.length = 0;
    expect(await runVatChecks({ ...api.deps, vies: down })).toBe(0);
    expect(asked).toEqual(['down']);
  });

  // « Vérifier dans VIES » on an invoice's fiche.
  type Fiche = {
    issues: { ruleId: string }[];
    vies: {
      vatId: string;
      answer: {
        valid: boolean;
        name: string | null;
        address: string | null;
        requestIdentifier: string | null;
        checkedOn: string;
      } | null;
    } | null;
  };
  type ErrorBody = { error: { code: string } };
  const checkNow = (apiKey: string, id: string, on = api) =>
    on.request(`/invoices/${id}/vies`, { method: 'POST', token: apiKey });

  it("shows the customer's number on the fiche, and asks VIES now on « Vérifier dans VIES », once a day", async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    const id = await create(t.apiKey, euDraft(20, 'LU26375245'));
    expect(((await detail(t.apiKey, id)) as unknown as Fiche).vies).toEqual({
      vatId: 'LU26375245',
      answer: null,
    });
    asked.length = 0;

    const res = await checkNow(t.apiKey, id);
    expect(res.status).toBe(200);
    expect(asked).toEqual(['LU26375245']);
    const fiche = (await res.json()) as Fiche;
    expect(fiche.vies).toEqual({
      vatId: 'LU26375245',
      answer: {
        valid: true,
        name: 'SOCIETE DE DEMONSTRATION 5245',
        address: '1 RUE DES EXEMPLES\n1000 EXEMPLEVILLE',
        requestIdentifier: expect.stringMatching(/^WAPIDEMO/),
        checkedOn: parisToday(),
      },
    });
    const [logged] = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, t.id), eq(auditEvents.action, 'vat.check')));
    expect(logged).toMatchObject({ actor: 'user', objectType: 'vat_check' });
    expect(await notes(t.apiKey, id)).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ valid: true }) }),
    ]);

    // Asked again the same day, by the user or the sweep: today's answer, VIES is not asked.
    expect((await (await checkNow(t.apiKey, id)).json()) as Fiche).toEqual(fiche);
    await sweep();
    expect(asked.filter((n) => n === 'LU26375245')).toHaveLength(1);

    // An invoice already sent can be checked too: proof of the number on the day.
    const sent = await deliveredInvoice(api, t, euDraft(21, 'PT501964843'));
    const later = (await (await checkNow(t.apiKey, sent.id)).json()) as Fiche;
    expect(later.vies?.answer).toMatchObject({ valid: true });
  });

  it('warns at once on every open invoice naming a number VIES says is not valid', async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    const id = await create(t.apiKey, euDraft(22, VIES_CASES.invalid));
    const other = await create(t.apiKey, euDraft(23, VIES_CASES.invalid));
    const fiche = (await (await checkNow(t.apiKey, id)).json()) as Fiche;
    expect(fiche.vies?.answer).toMatchObject({ valid: false, name: null, address: null });
    expect(fiche.issues.map((i) => i.ruleId)).toContain('FF-VIES-01');
    expect((await detail(t.apiKey, other)).issues.map((i) => i.ruleId)).toContain('FF-VIES-01');
  });

  it('says when VIES does not answer or is off, and refuses an invoice without an EU number', async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    const code = async (res: Response) => ((await res.json()) as ErrorBody).error.code;

    const busy = await create(t.apiKey, euDraft(24, VIES_CASES.busy));
    const res = await checkNow(t.apiKey, busy);
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('vies_unavailable');
    expect(((await detail(t.apiKey, busy)) as unknown as Fiche).vies?.answer).toBeNull();

    const off = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN, { vies: null });
    const eu = await create(t.apiKey, euDraft(25, 'SK2020317068'));
    const unasked = await checkNow(t.apiKey, eu, off);
    expect(unasked.status).toBe(503);
    expect(await code(unasked)).toBe('vies_off');

    const french = await create(t.apiKey, draft(26));
    expect(((await detail(t.apiKey, french)) as unknown as Fiche).vies).toBeNull();
    const refused = await checkNow(t.apiKey, french);
    expect(refused.status).toBe(400);
    expect(await code(refused)).toBe('vat_not_vies');

    const stranger = await newTenant(api.request, { vatId: 'FR88100000009' });
    expect((await checkNow(stranger.apiKey, eu)).status).toBe(404);
    expect(await database.db.select().from(vatChecks).where(eq(vatChecks.tenantId, t.id))).toEqual(
      [],
    );
  });

  it('exports the answers with the company, and a deletion erases them', async () => {
    const t = await newTenant(api.request, { vatId: 'FR88100000009' });
    await create(t.apiKey, euDraft(9, 'FI20774740'));
    await sweep();
    const exported = (await (await api.request('/tenant/export', { token: t.apiKey })).json()) as {
      vatChecks: unknown[];
    };
    expect(exported.vatChecks).toEqual([
      expect.objectContaining({
        vatId: 'FI20774740',
        valid: true,
        name: expect.any(String),
        requestIdentifier: expect.stringMatching(/^WAPIDEMO/),
      }),
    ]);
    const deleted = await api.request('/tenant', {
      method: 'DELETE',
      token: t.apiKey,
      body: { confirmSiren: '100000009' },
    });
    expect(deleted.status).toBe(200);
    expect(await database.db.select().from(vatChecks).where(eq(vatChecks.tenantId, t.id))).toEqual(
      [],
    );
  });
});
