// The Microsoft client (R4): what it sends to the token endpoint and Graph, and how each refusal
// becomes the MicrosoftError the connector acts on.
import { describe, expect, it } from 'vitest';
import {
  claimsOf,
  createMicrosoftClient,
  MicrosoftError,
  MSA_TENANT,
  tokenTenant,
} from './microsoft';

const jwt = (claims: object) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');

function client(answer: (url: string, init?: RequestInit) => Response) {
  const seen: { url: string; body: string }[] = [];
  const ms = createMicrosoftClient({
    clientId: 'app',
    clientSecret: 'secret',
    loginUrl: 'https://login.test/',
    graphUrl: 'https://graph.test/v1.0',
    fetcher: async (url, init) => {
      seen.push({ url: String(url), body: String(init?.body ?? '') });
      return answer(String(url), init);
    },
  });
  return { ms, seen };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('the on-behalf-of exchange', () => {
  it("asks the account's own directory, `consumers` for a personal account", async () => {
    expect(claimsOf(jwt({ tid: 'abc', oid: 'o' }))).toEqual({ tid: 'abc', oid: 'o' });
    expect(claimsOf('not a token')).toEqual({});
    expect(tokenTenant(MSA_TENANT)).toBe('consumers');

    const { ms, seen } = client(() => json({ access_token: 'at', refresh_token: 'rt' }));
    expect(await ms.exchange(jwt({ tid: MSA_TENANT }))).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      tid: MSA_TENANT,
    });
    expect(seen[0]?.url).toBe('https://login.test/consumers/oauth2/v2.0/token');
    const form = new URLSearchParams(seen[0]?.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('requested_token_use')).toBe('on_behalf_of');
    expect(form.get('scope')).toBe(
      'https://graph.microsoft.com/Files.Read https://graph.microsoft.com/User.Read offline_access',
    );
  });

  it('turns a refused grant into « reconnect », a 429 into a wait, our own mistake into unavailable', async () => {
    const refused = client(() => json({ error: 'invalid_grant' }, 400)).ms;
    await expect(refused.refresh('rt', 'tid')).rejects.toMatchObject({ kind: 'reconnect' });
    const busy = client(() => json({}, 429, { 'retry-after': '7' })).ms;
    await expect(busy.refresh('rt', 'tid')).rejects.toMatchObject({
      kind: 'throttled',
      retryAfter: 7,
    });
    const ours = client(() => json({ error: 'invalid_client' }, 401)).ms;
    await expect(ours.refresh('rt', 'tid')).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(client(() => json({})).ms.exchange('x.e30.y')).rejects.toBeInstanceOf(
      MicrosoftError,
    );
  });
});

describe('Graph', () => {
  it('maps 401, 403, 404 and 503 to what the connector does next', async () => {
    for (const [status, kind] of [
      [401, 'reconnect'],
      [403, 'forbidden'],
      [404, 'missing'],
      [503, 'throttled'],
      [500, 'unavailable'],
    ] as const) {
      const { ms } = client(() => json({ error: { code: 'x' } }, status));
      await expect(ms.item('at', 'd', 'i')).rejects.toMatchObject({ kind });
    }
  });

  it('downloads through the pre-authenticated link, and stops past the size cap', async () => {
    const big = new Uint8Array(2_000);
    const { ms, seen } = client((url) =>
      url.startsWith('https://graph.test/')
        ? new Response(null, { status: 302, headers: { location: 'https://files.test/x' } })
        : new Response(big),
    );
    expect((await ms.content('at', 'd!1', 'i/2', 5_000)).byteLength).toBe(2_000);
    expect(seen.map((s) => s.url)).toEqual([
      'https://graph.test/v1.0/drives/d!1/items/i%2F2/content',
      'https://files.test/x',
    ]);
    await expect(ms.content('at', 'd', 'i', 1_000)).rejects.toMatchObject({ kind: 'too_large' });
  });

  it('lists a folder page by page, and follows a next page only on Graph', async () => {
    const item = (id: string) => ({ id, name: `${id}.pdf`, file: {} });
    const { ms, seen } = client((url) =>
      url.includes('$skiptoken')
        ? json({ value: [item('b')] })
        : json({
            value: [item('a')],
            '@odata.nextLink': 'https://graph.test/v1.0/drives/d/items/f/children?$skiptoken=2',
          }),
    );
    expect((await ms.children('at', 'd', 'f')).map((i) => i.id)).toEqual(['a', 'b']);
    expect(seen.map((s) => s.url)).toEqual([
      'https://graph.test/v1.0/drives/d/items/f/children?$select=id,name,size,eTag,cTag,file,folder,parentReference&$top=200',
      'https://graph.test/v1.0/drives/d/items/f/children?$skiptoken=2',
    ]);

    const elsewhere = client(() =>
      json({ value: [], '@odata.nextLink': 'https://evil.test/v1.0/drives/d/items/f/children' }),
    );
    await expect(elsewhere.ms.children('at', 'd', 'f')).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect(elsewhere.seen).toHaveLength(1);
  });
});
