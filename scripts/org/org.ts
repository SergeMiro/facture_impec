// `pnpm org`: a company set up and looked after from the command line, over the operator's routes
// (apps/api/src/admin.ts, Bearer ADMIN_TOKEN). docs/RUNBOOK.md § Pilot. The token and the company's
// API key are never written anywhere but the one line that hands the key over, once.
import { parseArgs } from 'node:util';

export const USAGE = `pnpm org <command>                FI_API_URL (default http://localhost:4000), ADMIN_TOKEN
  list                                        every company: SIREN, name, billing, live
  show <SIREN|id>                             one company, all it says
  create --name <name> --siren <SIREN>        a new company (pilot, never billed); prints its API key once
         [--owner <e-mail>] [--vat <FR…>] [--account <platform account>] [--trial] [--vat-on-debits]
         [--line1 <street>] [--postcode <code>] [--city <city>]
  pilot <SIREN|id> [--trial]                  never billed (or back to a fresh trial month)
  platform <SIREN|id> <account>               its account id at the platform, when it is not the SIREN
  live <SIREN|id> --confirm <SIREN>           real sends open (the platform must answer for the account)
  offline <SIREN|id> --confirm <SIREN>        real sends closed again
  key <SIREN|id> --confirm <SIREN>            a new API key, every older one revoked; prints it once`;

export interface OrgIo {
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  fetch?: typeof fetch;
}

interface Tenant {
  id: string;
  name: string;
  siren: string;
  pdpProvider: string;
  pdpAccount: string;
  liveAt: string | null;
  billing: { status: string; plan: string | null; trialEndsAt: string | null };
  createdAt: string;
}

class OrgError extends Error {}

/** Runs one command; the exit code. */
export async function runOrg(argv: string[], io: OrgIo): Promise<number> {
  try {
    await run(argv, io);
    return 0;
  } catch (e) {
    if (!(e instanceof OrgError)) throw e;
    io.out(e.message);
    return 1;
  }
}

async function run(argv: string[], io: OrgIo) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      siren: { type: 'string' },
      owner: { type: 'string' },
      vat: { type: 'string' },
      account: { type: 'string' },
      trial: { type: 'boolean', default: false },
      'vat-on-debits': { type: 'boolean', default: false },
      line1: { type: 'string' },
      postcode: { type: 'string' },
      city: { type: 'string' },
      confirm: { type: 'string' },
    },
  });
  const [command, ...rest] = positionals;
  const api = (io.env.FI_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const token = io.env.ADMIN_TOKEN;
  if (!command || command === 'help') {
    io.out(USAGE);
    return;
  }
  if (!token) throw new OrgError('ADMIN_TOKEN is not set (the operator token of that API).');

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await (io.fetch ?? fetch)(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }).catch((e: unknown) => {
      const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : String(e);
      throw new OrgError(`No answer from ${api} (FI_API_URL): ${cause}`);
    });
    const text = await res.text();
    if (!res.ok) throw new OrgError(`${method} ${path}: ${res.status} ${text}`);
    return JSON.parse(text) as T;
  };
  /** A company by its SIREN (one company only) or its id. */
  const find = async (ref: string | undefined): Promise<Tenant> => {
    if (!ref) throw new OrgError(`Which company? A SIREN or an id.\n${USAGE}`);
    const siren = ref.replace(/\s/g, '');
    const { tenants } = await call<{ tenants: Tenant[] }>(
      'GET',
      /^\d{9}$/.test(siren) ? `/admin/tenants?siren=${siren}` : '/admin/tenants',
    );
    const found = tenants.filter((t) => t.id === ref || t.siren === siren);
    if (found.length === 0) throw new OrgError(`No company ${ref}.`);
    if (found.length > 1) {
      throw new OrgError(
        `${found.length} companies have the SIREN ${siren}; give the id:\n${found.map(line).join('\n')}`,
      );
    }
    return found[0] as Tenant;
  };

  switch (command) {
    case 'list': {
      const { tenants } = await call<{ tenants: Tenant[] }>('GET', '/admin/tenants');
      for (const t of tenants) io.out(line(t));
      io.out(`${tenants.length} companies`);
      return;
    }
    case 'show': {
      io.out(JSON.stringify(await find(rest[0]), null, 2));
      return;
    }
    case 'create': {
      if (!values.name || !values.siren)
        throw new OrgError(`create needs --name and --siren.\n${USAGE}`);
      const address =
        values.line1 || values.postcode || values.city
          ? {
              ...(values.line1 && { line1: values.line1 }),
              ...(values.postcode && { postCode: values.postcode }),
              ...(values.city && { city: values.city }),
              country: 'FR',
            }
          : undefined;
      const { tenant, apiKey } = await call<{ tenant: Tenant; apiKey: string }>(
        'POST',
        '/admin/tenants',
        {
          name: values.name,
          siren: values.siren.replace(/\s/g, ''),
          ...(values.vat && { vatId: values.vat }),
          ...(values.account && { pdpAccount: values.account }),
          ...(values.owner && { ownerEmail: values.owner }),
          ...(address && { address }),
          vatOnDebits: values['vat-on-debits'],
          billing: values.trial ? 'trial' : 'pilot',
        },
      );
      io.out(line(tenant));
      io.out(`API key (shown this once, give it to the company and keep no copy): ${apiKey}`);
      return;
    }
    case 'pilot': {
      const t = await find(rest[0]);
      const status = values.trial ? 'trial' : 'pilot';
      io.out(line(await call<Tenant>('PUT', `/admin/tenants/${t.id}/billing`, { status })));
      return;
    }
    case 'platform': {
      const t = await find(rest[0]);
      const account = rest[1] ?? values.account;
      if (!account)
        throw new OrgError('platform needs the account id: pnpm org platform <SIREN|id> <account>');
      io.out(line(await call<Tenant>('PUT', `/admin/tenants/${t.id}/platform`, { account })));
      return;
    }
    case 'live':
    case 'offline': {
      const t = await find(rest[0]);
      if (!values.confirm)
        throw new OrgError(`${command} needs --confirm <SIREN>, the company's SIREN typed again.`);
      const body = { live: command === 'live', confirmSiren: values.confirm };
      io.out(line(await call<Tenant>('PUT', `/admin/tenants/${t.id}/live`, body)));
      return;
    }
    case 'key': {
      const t = await find(rest[0]);
      if (!values.confirm)
        throw new OrgError("key needs --confirm <SIREN>, the company's SIREN typed again.");
      const { tenant, apiKey, revoked } = await call<{
        tenant: Tenant;
        apiKey: string;
        revoked: number;
      }>('POST', `/admin/tenants/${t.id}/api-keys`, { confirmSiren: values.confirm });
      io.out(line(tenant));
      io.out(`${revoked} older key(s) revoked: whatever used them stops at its next call.`);
      io.out(`API key (shown this once, give it to the company and keep no copy): ${apiKey}`);
      return;
    }
    default:
      throw new OrgError(`Unknown command ${command}.\n${USAGE}`);
  }
}

/** One company on one line: what the operator checks every morning. */
function line(t: Tenant): string {
  const live = t.liveAt ? `live since ${t.liveAt.slice(0, 10)}` : 'test only';
  const billing =
    t.billing.status === 'trial' && t.billing.trialEndsAt
      ? `trial until ${t.billing.trialEndsAt.slice(0, 10)}`
      : t.billing.status;
  return `${t.siren}  ${t.name}  ${billing}  ${live}  ${t.pdpProvider}:${t.pdpAccount}  ${t.id}`;
}
