// The pilot of plan §11 M7, rehearsed in prod mode: three companies sign up through the wizard's calls,
// rehearse in Mode test on the platform's sandbox, wait for the operator, and the one switched live
// sends for real. The pilot itself (real companies, five days without a P1) is docs/RUNBOOK.md § Pilot.
import { auditEvents, type Database, eq } from '@fi/db';
import { TERMS_VERSION } from '@fi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computedVatId } from './sirene';
import {
  ADMIN_TOKEN,
  draft,
  fakeAdapter,
  linkToken,
  recordedJobs,
  runSend,
  testApi,
  testDatabase,
  type WorkerDeps,
} from './test-helpers';

/**
 * What each platform received, account and XML: B2Brouter's sandbox, where Mode test goes from prod, and
 * B2Brouter itself. Both are the B2Brouter adapter (src/runtime.ts).
 */
interface Deposit {
  account: string;
  xml: string;
}
const deposits = { sandbox: [] as Deposit[], real: [] as Deposit[] };
const platform = (into: Deposit[], prefix: string) =>
  fakeAdapter({
    provider: 'b2brouter',
    sendInvoice: async ({ account, xml }) => {
      into.push({ account, xml });
      return { outcome: 'deposited', pdpRef: `${prefix}_${into.length}` };
    },
    // The go-live check reads the account's inbox.
    listInbound: async () => [],
  });
const sandbox = platform(deposits.sandbox, 'sbx');
const real = platform(deposits.real, 'live');

let database: Database;
let api: ReturnType<typeof testApi>;
const worker = (): WorkerDeps => ({
  env: api.deps.env,
  db: database.db,
  pdp: api.deps.pdp,
  test: api.deps.test,
  jobs: recordedJobs(),
  ai: api.deps.ai,
  mailer: null,
  now: () => new Date(),
});

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { b2brouter: real, b2brouter_test: sandbox }, ADMIN_TOKEN, {
    test: { provider: 'b2brouter_test', scenarios: null },
    env: { FI_ENV: 'prod', TERMS_URL: 'https://facture-impec.test/conditions' },
  });
});
afterAll(async () => {
  await database.close();
});

/** A SIRET of the company: its SIREN, then a NIC that makes the 14 digits pass the Luhn check. */
function siretOf(siren: string): string {
  for (let k = 0; k < 10; k++) {
    const siret = `${siren}0001${k}`;
    const sum = [...siret]
      .reverse()
      .reduce((s, c, i) => s + ((d) => (d > 9 ? d - 9 : d))(Number(c) * (i % 2 ? 2 : 1)), 0);
    if (sum % 10 === 0) return siret;
  }
  throw new Error(`no SIRET for ${siren}`);
}

/** « Créer un compte » as the pane does it; returns the company and its owner's session. */
async function signUp(siren: string) {
  const email = `gerance-${siren}@pilote.test`;
  const looked = await api.request(`/onboarding/company/${siren}`);
  expect(looked.status).toBe(200);
  const company = (await looked.json()) as {
    name: string;
    address: unknown;
    vatId: string | null;
  };
  const asked = await api.request('/onboarding/signup', {
    method: 'POST',
    body: {
      siren,
      email,
      company: { name: company.name, address: company.address, vatId: company.vatId },
      acceptTerms: true,
      termsVersion: TERMS_VERSION,
    },
  });
  expect(asked.status).toBe(202);
  const { requestId } = (await asked.json()) as { requestId: string };
  const token = linkToken(api.mailer, email);
  expect((await api.request(`/onboarding/confirm?token=${token}`, { method: 'POST' })).status).toBe(
    200,
  );
  const polled = await api.request('/onboarding/poll', { method: 'POST', body: { requestId } });
  const session = (await polled.json()) as { token: string; tenant: { id: string } };
  return { siren, name: company.name, session: session.token, id: session.tenant.id };
}

describe('the pilot, rehearsed in prod mode', () => {
  const sirens = ['999000128', '999000136', '999000144'];
  let pilots: Awaited<ReturnType<typeof signUp>>[];
  let n = 0;

  /** One invoice of `company`, created and sent; the send job runs when the API accepted it. */
  async function send(company: (typeof pilots)[number], test: boolean) {
    const number = `P${company.siren.slice(-3)}-${++n}`;
    const made = await api.request('/invoices', {
      method: 'POST',
      token: company.session,
      body: {
        test,
        draft: draft(n, (d) => {
          d.number = number;
          d.seller = {
            ...d.seller,
            name: company.name,
            ids: [{ id: siretOf(company.siren), scheme: '0009' }],
            legalId: { id: company.siren, scheme: '0002' },
            vatId: computedVatId(company.siren),
            electronicAddress: { id: company.siren, scheme: '0225' },
          };
        }),
      },
    });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    const sent = await api.request(`/invoices/${id}/send`, {
      method: 'POST',
      token: company.session,
    });
    if (sent.status === 202) await runSend(worker(), id);
    return { number, status: sent.status, code: sent.ok ? null : await code(sent) };
  }
  const code = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  it('signs up three companies, which the operator makes pilots (never billed)', async () => {
    pilots = [];
    for (const siren of sirens) pilots.push(await signUp(siren));
    for (const p of pilots) {
      const made = await api.request(`/admin/tenants/${p.id}/billing`, {
        method: 'PUT',
        token: ADMIN_TOKEN,
        body: { status: 'pilot' },
      });
      expect(made.status).toBe(200);
    }
    // What the operator lists every morning (docs/RUNBOOK.md § Pilot).
    const listed = await api.request('/admin/tenants', { token: ADMIN_TOKEN });
    const { tenants: rows } = (await listed.json()) as {
      tenants: { siren: string; billing: { status: string }; pdpProvider: string; liveAt: null }[];
    };
    expect(rows.map((r) => [r.siren, r.billing.status, r.pdpProvider, r.liveAt])).toEqual(
      sirens.map((s) => [s, 'pilot', 'b2brouter', null]),
    );
    const found = await api.request('/admin/tenants?siren=999 000 136', { token: ADMIN_TOKEN });
    expect(((await found.json()) as { tenants: { id: string }[] }).tenants).toEqual([
      expect.objectContaining({ id: pilots[1]?.id }),
    ]);
  });

  it('lets each rehearse in Mode test on the sandbox; nothing real leaves before the switch', async () => {
    for (const p of pilots) {
      expect(await send(p, true)).toMatchObject({ status: 202 });
      expect(await send(p, false)).toMatchObject({ status: 409, code: 'not_live' });
    }
    // Each company's own account, its SIREN until the operator says otherwise.
    expect(deposits.sandbox.map((d) => d.account)).toEqual(sirens);
    expect(deposits.real).toEqual([]);
  });

  it('switches one company live: only it sends for real, the others keep waiting', async () => {
    const [first, second] = pilots;
    if (!first || !second) throw new Error('three pilots expected');
    const admin = (path: string, body: unknown) =>
      api.request(`/admin/tenants/${first.id}${path}`, { method: 'PUT', token: ADMIN_TOKEN, body });
    // Its account at B2Brouter, when the platform's id is not the SIREN (docs/B2BROUTER.md T22).
    expect((await admin('/platform', { account: 'b2b-4711' })).status).toBe(200);
    const live = await admin('/live', { live: true, confirmSiren: first.siren });
    expect(live.status).toBe(200);
    const sent = await send(first, false);
    expect(sent).toMatchObject({ status: 202 });
    expect(deposits.real.map((d) => d.account)).toEqual(['b2b-4711']);
    expect(deposits.real[0]?.xml).toContain(sent.number);
    expect(await send(second, false)).toMatchObject({ status: 409, code: 'not_live' });
    // Live, its invoices are followed through that account: it no longer changes.
    const moved = await admin('/platform', { account: 'b2b-9999' });
    expect(moved.status).toBe(409);
    expect(await code(moved)).toBe('tenant_live');

    const trail = await database.db
      .select({ action: auditEvents.action, actor: auditEvents.actor })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, first.id));
    expect(trail).toEqual(
      expect.arrayContaining([
        { action: 'tenant.create', actor: 'signup' },
        { action: 'tenant.billing', actor: 'admin' },
        { action: 'tenant.platform', actor: 'admin' },
        { action: 'tenant.live', actor: 'admin' },
      ]),
    );
  });
});
