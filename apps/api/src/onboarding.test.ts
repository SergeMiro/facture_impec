// « Créer un compte » against the directory stand-in (synthetic companies): the lookup and its refusals,
// the request, the e-mailed confirmation that creates the company, the session collected once.
import { auditEvents, type Database, eq, signupRequests, tenants, users } from '@fi/db';
import { SIRENE_CASES } from '@fi/mock-pdp';
import { TERMS_VERSION } from '@fi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computedVatId, RechercheEntreprises } from './sirene';
import {
  ADMIN_TOKEN,
  fakeAdapter,
  inProcess,
  linkToken,
  newTenant,
  testApi,
  testDatabase,
} from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() });
});
afterAll(async () => {
  await database.close();
});

/** Luhn-valid SIRENs no case uses: each test its own company. */
let next = 999_100_000;
function freshSiren(): string {
  for (;;) {
    const s = String(++next);
    const sum = [...s].reverse().reduce((acc, c, i) => {
      const d = Number(c) * (i % 2 ? 2 : 1);
      return acc + (d > 9 ? d - 9 : d);
    }, 0);
    if (sum % 10 === 0) return s;
  }
}

const json = async (res: Response) => ({
  status: res.status,
  body: (await res.json()) as Record<string, unknown>,
});

async function ask(siren: string, email: string, extra: Record<string, unknown> = {}) {
  const found = (await (await api.request(`/onboarding/company/${siren}`)).json()) as {
    name: string;
    address: unknown;
    vatId: string;
  };
  return api.request('/onboarding/signup', {
    method: 'POST',
    body: {
      siren,
      email,
      company: { name: found.name, address: found.address, vatId: found.vatId },
      acceptTerms: true,
      termsVersion: TERMS_VERSION,
      ...extra,
    },
  });
}

describe('the company lookup', () => {
  it('prefills the legal name, the head office and the VAT number DGFiP lists', async () => {
    const siren = freshSiren();
    const res = await json(
      await api.request(`/onboarding/company/${siren.slice(0, 3)} ${siren.slice(3)}`),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      siren,
      name: `ENTREPRISE DE DEMONSTRATION ${siren.slice(-4)}`,
      address: { line1: expect.stringMatching(/^\d+ RUE DES EXEMPLES$/), postCode: '21000' },
      vatId: computedVatId(siren),
      vatSource: 'dgfip',
      closed: false,
      masked: false,
    });
    expect(res.body.address).toMatchObject({ city: 'DIJON', country: 'FR' });
  });

  it('leaves withheld fields empty and marks a VAT number not listed as to confirm', async () => {
    const withheld = await json(await api.request(`/onboarding/company/${SIRENE_CASES.withheld}`));
    expect(withheld.body).toMatchObject({ masked: true, address: { city: 'DIJON' } });
    expect(JSON.stringify(withheld.body)).not.toContain('NON-DIFFUSIBLE');
    expect((withheld.body.address as Record<string, unknown>).line1).toBeUndefined();
    const noVat = await json(await api.request(`/onboarding/company/${SIRENE_CASES.noVat}`));
    expect(noVat.body).toMatchObject({
      vatId: computedVatId(SIRENE_CASES.noVat),
      vatSource: 'computed',
    });
  });

  it.each([
    ['123456789', 400, 'siren_invalid'],
    [SIRENE_CASES.unknown, 404, 'company_not_found'],
    [SIRENE_CASES.closed, 409, 'company_closed'],
    [SIRENE_CASES.duplicate, 409, 'company_duplicate'],
    [SIRENE_CASES.busy, 503, 'directory_unavailable'],
  ])('refuses %s with %i %s', async (siren, status, code) => {
    const res = await json(await api.request(`/onboarding/company/${siren}`));
    expect(res).toMatchObject({ status, body: { error: { code } } });
  });

  it('names the SIREN to use instead of a duplicate', async () => {
    const res = await json(await api.request(`/onboarding/company/${SIRENE_CASES.duplicate}`));
    expect((res.body.error as { message: string }).message).toContain(SIRENE_CASES.kept);
  });

  it('refuses a company that already has an account', async () => {
    const t = await newTenant(api.request, { siren: freshSiren() });
    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    const res = await json(await api.request(`/onboarding/company/${row?.siren}`));
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'company_exists' } } });
  });

  it('reads the real directory’s answer shape (EDF, as fetched 2026-10-18)', async () => {
    const edf = {
      results: [
        {
          siren: '552081317',
          siren_conserve: null,
          nom_complet: 'ELECTRICITE DE FRANCE (EDF)',
          nom_raison_sociale: 'ELECTRICITE DE FRANCE',
          etat_administratif: 'A',
          statut_diffusion: 'O',
          tva: ['FR03552081317'],
          siege: {
            complement_adresse: '22-30',
            numero_voie: '22',
            indice_repetition: null,
            type_voie: 'AVENUE',
            libelle_voie: 'DE WAGRAM',
            distribution_speciale: null,
            code_postal: '75008',
            libelle_commune: 'PARIS',
            cedex: null,
            libelle_cedex: null,
            code_pays_etranger: null,
            libelle_commune_etranger: null,
          },
        },
      ],
      total_results: 1,
    };
    let asked = '';
    const directory = new RechercheEntreprises('https://recherche-entreprises.api.gouv.fr', (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      asked = String(url);
      expect(new Headers(init?.headers).get('user-agent')).toMatch(/^FactureImpec\//);
      return Response.json(edf);
    }) as typeof fetch);
    expect(await directory.lookup('552081317')).toEqual({
      siren: '552081317',
      name: 'ELECTRICITE DE FRANCE',
      address: {
        line1: '22 AVENUE DE WAGRAM',
        line2: '22-30',
        postCode: '75008',
        city: 'PARIS',
        country: 'FR',
      },
      vatId: 'FR03552081317',
      vatSource: 'dgfip',
      closed: false,
      keptSiren: null,
      masked: false,
    });
    expect(asked).toBe(
      'https://recherche-entreprises.api.gouv.fr/search?q=552081317&per_page=1&minimal=true&include=siege%2Ctva',
    );
    expect(computedVatId('552081317')).toBe('FR03552081317');
  });
});

describe('signing up', () => {
  it('creates the company only when the e-mailed link is confirmed, then signs the pane in', async () => {
    const siren = freshSiren();
    const email = `owner-${siren}@example.test`;
    const asked = await ask(siren, email);
    expect(asked.status).toBe(202);
    const { requestId } = (await asked.json()) as { requestId: string };
    const poll = () =>
      Promise.resolve(
        api.request('/onboarding/poll', { method: 'POST', body: { requestId } }),
      ).then(json);
    expect((await poll()).body).toEqual({ status: 'pending' });

    const token = linkToken(api.mailer, email);
    // Opening the link (or a mail scanner opening it) creates nothing.
    const opened = await api.request(`/onboarding/confirm?token=${token}`);
    expect(await opened.text()).toContain('Créer mon compte');
    expect(await database.db.select().from(tenants).where(eq(tenants.siren, siren))).toHaveLength(
      0,
    );

    const confirmed = await api.request(`/onboarding/confirm?token=${token}`, { method: 'POST' });
    expect(confirmed.status).toBe(200);
    const [tenant] = await database.db.select().from(tenants).where(eq(tenants.siren, siren));
    expect(tenant).toMatchObject({
      name: `ENTREPRISE DE DEMONSTRATION ${siren.slice(-4)}`,
      vatId: computedVatId(siren),
      billingStatus: 'trial',
      termsVersion: TERMS_VERSION,
      pdpProvider: 'mock',
      pdpAccount: siren,
    });
    expect(tenant?.trialEndsAt).toBeInstanceOf(Date);
    expect(tenant?.termsAcceptedAt).toBeInstanceOf(Date);
    const owners = await database.db
      .select()
      .from(users)
      .where(eq(users.tenantId, tenant?.id ?? ''));
    expect(owners).toMatchObject([{ email, role: 'owner' }]);
    const events = await database.db
      .select({ actor: auditEvents.actor, action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenant?.id ?? ''));
    expect(events).toEqual(
      expect.arrayContaining([
        { actor: 'signup', action: 'tenant.create' },
        { actor: 'signup', action: 'user.create' },
      ]),
    );

    const done = await poll();
    expect(done.body).toMatchObject({ status: 'ok', user: { email, role: 'owner' } });
    const session = done.body.token as string;
    const me = await json(await api.request('/tenant', { token: session }));
    expect(me).toMatchObject({ status: 200, body: { siren, terms: { version: TERMS_VERSION } } });
    // Collected once.
    expect(await poll()).toMatchObject({
      status: 410,
      body: { error: { code: 'signup_expired' } },
    });
    // The link still says it is done.
    expect(await (await api.request(`/onboarding/confirm?token=${token}`)).text()).toContain(
      'Votre compte est créé',
    );
  });

  it('makes one company of two requests for one SIREN', async () => {
    const siren = freshSiren();
    expect((await ask(siren, `a-${siren}@example.test`)).status).toBe(202);
    expect((await ask(siren, `b-${siren}@example.test`)).status).toBe(202);
    const first = linkToken(api.mailer, `a-${siren}@example.test`);
    const second = linkToken(api.mailer, `b-${siren}@example.test`);
    const [a, b] = await Promise.all([
      api.request(`/onboarding/confirm?token=${first}`, { method: 'POST' }),
      api.request(`/onboarding/confirm?token=${second}`, { method: 'POST' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await database.db.select().from(tenants).where(eq(tenants.siren, siren))).toHaveLength(
      1,
    );
  });

  it('accepts a company typed while the directory is down, and checks what it can', async () => {
    const res = await api.request('/onboarding/signup', {
      method: 'POST',
      body: {
        siren: SIRENE_CASES.busy,
        email: 'typed@example.test',
        company: {
          name: 'Menuiserie Exemple',
          address: { line1: '3 rue des Essais', postCode: '21000', city: 'Dijon', country: 'FR' },
          vatId: null,
        },
        acceptTerms: true,
        termsVersion: TERMS_VERSION,
      },
    });
    expect(res.status).toBe(202);
    const [row] = await database.db
      .select()
      .from(signupRequests)
      .where(eq(signupRequests.email, 'typed@example.test'));
    expect(row?.company).toEqual({
      name: 'Menuiserie Exemple',
      address: { line1: '3 rue des Essais', postCode: '21000', city: 'Dijon', country: 'FR' },
      vatId: null,
    });
  });

  it('refuses old terms, unaccepted terms, a VAT number of another company and a closed one', async () => {
    const siren = freshSiren();
    const email = `checks-${siren}@example.test`;
    expect(await ask(siren, email, { termsVersion: '2020-01-01' }).then(json)).toMatchObject({
      status: 409,
      body: { error: { code: 'terms_changed' } },
    });
    expect((await ask(siren, email, { acceptTerms: false })).status).toBe(400);
    const other = await ask(siren, email, {
      company: { name: 'X', address: null, vatId: computedVatId(freshSiren()) },
    });
    expect(await json(other)).toMatchObject({
      status: 400,
      body: { error: { code: 'vat_mismatch' } },
    });
    const closed = await api.request('/onboarding/signup', {
      method: 'POST',
      body: {
        siren: SIRENE_CASES.closed,
        email,
        company: { name: 'Fermée', address: null, vatId: null },
        acceptTerms: true,
        termsVersion: TERMS_VERSION,
      },
    });
    expect(closed.status).toBe(409);
  });

  it(`allows 3 requests an hour per address`, async () => {
    const email = 'eager@example.test';
    for (let i = 0; i < 3; i++) expect((await ask(freshSiren(), email)).status).toBe(202);
    expect(await ask(freshSiren(), email).then(json)).toMatchObject({
      status: 429,
      body: { error: { code: 'too_many_signups' } },
    });
  });
});

describe('where sign-up is offered', () => {
  it('in local, with the terms version the pane must send', async () => {
    const options = await json(await api.request('/auth/options'));
    expect(options.body).toEqual({
      magicLink: true,
      signup: { termsVersion: TERMS_VERSION, termsUrl: null },
    });
  });

  it('nowhere else until the terms are published, nor without mail', async () => {
    const sandbox = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN, {});
    sandbox.deps.env.FI_ENV = 'sandbox';
    expect((await json(await sandbox.request('/auth/options'))).body.signup).toBeNull();
    expect(await json(await sandbox.request(`/onboarding/company/${freshSiren()}`))).toMatchObject({
      status: 503,
      body: { error: { code: 'signup_disabled' } },
    });
    sandbox.deps.env.TERMS_URL = 'https://example.test/conditions';
    expect((await json(await sandbox.request('/auth/options'))).body.signup).toEqual({
      termsVersion: TERMS_VERSION,
      termsUrl: 'https://example.test/conditions',
    });
    const mute = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN, { mailer: null });
    expect((await json(await mute.request('/auth/options'))).body.signup).toBeNull();
  });
});

describe('the directory client', () => {
  it('waits as asked on 429 and treats a 200 without result as not found', async () => {
    const answers = [
      new Response('{}', { status: 429, headers: { 'retry-after': '3' } }),
      Response.json({ results: [], total_results: 0 }),
    ];
    const directory = new RechercheEntreprises(
      'http://d.test',
      inProcess({ request: () => answers.shift() as Response }),
    );
    await expect(directory.lookup('552081317')).rejects.toMatchObject({ retryAfter: 3 });
    expect(await directory.lookup('552081317')).toBeNull();
  });

  it('searches active companies by name, at most 25, narrowed by a post code (docs/ONBOARDING.md §1.4)', async () => {
    const asked: URL[] = [];
    const directory = new RechercheEntreprises(
      'http://d.test',
      inProcess({
        request: (path) => {
          asked.push(new URL(path, 'http://d.test'));
          return Response.json({ results: [], total_results: 0 });
        },
      }),
    );
    expect(await directory.search({ name: 'ab' }, 5)).toEqual([]);
    expect(asked).toEqual([]);
    await directory.search({ name: ' Électricité de France ', postCode: '75008' }, 100);
    await directory.search({ name: 'EDF', postCode: 'Paris' }, 5);
    expect(asked.map((u) => Object.fromEntries(u.searchParams))).toEqual([
      {
        q: 'Électricité de France',
        per_page: '25',
        etat_administratif: 'A',
        code_postal: '75008',
        minimal: 'true',
        include: 'siege,tva',
      },
      { q: 'EDF', per_page: '5', etat_administratif: 'A', minimal: 'true', include: 'siege,tva' },
    ]);
  });
});
