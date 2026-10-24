// `pnpm org` against the whole API in this process (PGlite, the mock platform): BTP stage 7C.
import { once } from 'node:events';
import { type AddressInfo, createServer } from 'node:net';
import { type Stack, startStack } from '@fi/api/scenarios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runOrg } from './org';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack({ webhooks: false });
}, 60_000);
afterAll(async () => {
  await stack?.close();
});

/** One command: its exit code and what it printed. */
async function org(...argv: string[]) {
  const lines: string[] = [];
  const code = await runOrg(argv, {
    env: { FI_API_URL: stack.apiUrl, ADMIN_TOKEN: stack.adminToken },
    out: (line) => lines.push(line),
  });
  return { code, text: lines.join('\n') };
}

// A valid SIREN (Luhn), and a second one.
const SIREN = '732829320';
const OTHER = '552100554';
/** The key `create` handed over. */
let firstKey = '';
const tenantStatus = async (key: string) =>
  (await fetch(`${stack.apiUrl}/tenant`, { headers: { authorization: `Bearer ${key}` } })).status;

describe('pnpm org', () => {
  it('creates a pilot company and hands its API key over once', async () => {
    const created = await org(
      'create',
      '--name',
      'Maçonnerie Durand',
      '--siren',
      '732 829 320',
      '--owner',
      'gerant@example.fr',
      '--city',
      'Dijon',
      '--postcode',
      '21000',
    );
    expect(created.code).toBe(0);
    expect(created.text).toMatch(
      /^732829320 {2}Maçonnerie Durand {2}pilot {2}test only {2}mock:732829320 /,
    );
    const key = /shown this once.*: (\S+)$/m.exec(created.text)?.[1];
    expect(key).toBeTruthy();
    firstKey = key ?? '';
    const me = await fetch(`${stack.apiUrl}/tenant`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      siren: SIREN,
      address: { city: 'Dijon', postCode: '21000' },
    });

    const shown = await org('show', SIREN);
    expect(JSON.parse(shown.text)).toMatchObject({ siren: SIREN, billing: { status: 'pilot' } });
    expect(shown.text).not.toContain(key);
    expect((await org('list')).text).toMatch(/732829320 {2}Maçonnerie Durand/);
  });

  it('sets billing, the platform account, live and offline by SIREN', async () => {
    const trial = await org('pilot', SIREN, '--trial');
    expect(trial.text).toMatch(/ trial until \d{4}-\d{2}-\d{2} /);
    expect((await org('pilot', SIREN)).text).toMatch(/ pilot /);
    expect((await org('platform', SIREN, 'acct-42')).text).toMatch(/ mock:acct-42 /);

    const wrong = await org('live', SIREN, '--confirm', OTHER);
    expect(wrong.code).toBe(1);
    expect(wrong.text).toMatch(/409 .*confirm_mismatch/);
    expect((await org('live', SIREN, '--confirm', SIREN)).text).toMatch(/ live since \d{4}-/);
    // Once live, the account is fixed.
    expect((await org('platform', SIREN, 'acct-43')).text).toMatch(/409 .*tenant_live/);
    expect((await org('offline', SIREN, '--confirm', SIREN)).text).toMatch(/ test only /);
  });

  it('replaces the API key with the SIREN typed again: the old one stops', async () => {
    expect((await org('key', SIREN)).text).toMatch(/key needs --confirm <SIREN>/);
    expect((await org('key', SIREN, '--confirm', OTHER)).text).toMatch(/409 .*confirm_mismatch/);
    expect(await tenantStatus(firstKey)).toBe(200);
    const replaced = await org('key', SIREN, '--confirm', SIREN);
    expect(replaced.code).toBe(0);
    expect(replaced.text).toMatch(/^1 older key\(s\) revoked/m);
    const key = /shown this once.*: (\S+)$/m.exec(replaced.text)?.[1] ?? '';
    expect([await tenantStatus(firstKey), await tenantStatus(key)]).toEqual([401, 200]);
  });

  it('asks for the id when a SIREN has two companies, and takes it', async () => {
    expect((await org('create', '--name', 'Second', '--siren', SIREN)).code).toBe(0);
    const twice = await org('show', SIREN);
    expect(twice.code).toBe(1);
    expect(twice.text).toMatch(/2 companies have the SIREN 732829320; give the id:/);
    const id = /([0-9a-f-]{36})$/m.exec(twice.text)?.[1] ?? '';
    expect(JSON.parse((await org('show', id)).text)).toMatchObject({ id });
  });

  it('says what is missing rather than calling the API wrongly', async () => {
    expect((await org()).text).toMatch(/^pnpm org <command>/);
    expect((await org('create', '--name', 'X')).text).toMatch(/create needs --name and --siren/);
    expect((await org('show', OTHER)).text).toBe(`No company ${OTHER}.`);
    expect((await org('create', '--name', 'X', '--siren', '123456789')).text).toMatch(/400/);
    const lines: string[] = [];
    const code = await runOrg(['list'], {
      env: { FI_API_URL: stack.apiUrl },
      out: (l) => lines.push(l),
    });
    expect([code, lines]).toEqual([
      1,
      ['ADMIN_TOKEN is not set (the operator token of that API).'],
    ]);
    // A port nothing listens on any more.
    const server = createServer().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    server.close();
    const away: string[] = [];
    const env = { FI_API_URL: `http://127.0.0.1:${port}`, ADMIN_TOKEN: stack.adminToken };
    expect(await runOrg(['list'], { env, out: (l) => away.push(l) })).toBe(1);
    expect(away).toHaveLength(1);
    expect(away[0]).toContain(`No answer from http://127.0.0.1:${port} (FI_API_URL): `);
    expect(away[0]).toMatch(/ECONNREFUSED/);
  });
});
