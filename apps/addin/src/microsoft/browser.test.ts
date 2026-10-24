// Real authentication adapter, scripted MSAL clients. No token call reaches Microsoft.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserMicrosoftPort, isPickerInitialization, officeMicrosoftPort } from './office';

const msal = vi.hoisted(() => ({
  standard: vi.fn(),
  nested: vi.fn(),
  silent: vi.fn(),
  popup: vi.fn(),
  sso: vi.fn(),
  active: vi.fn(),
}));
vi.mock('@azure/msal-browser', () => ({
  createStandardPublicClientApplication: msal.standard,
  createNestablePublicClientApplication: msal.nested,
}));
const client = {
  acquireTokenSilent: msal.silent,
  acquireTokenPopup: msal.popup,
  ssoSilent: msal.sso,
  setActiveAccount: msal.active,
};
const signIn = { clientId: 'local-app', scope: 'api://local-app/access_as_user' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', { location: { href: 'https://addin.example.test/google-sheets.html' } });
  vi.stubGlobal('Office', undefined);
  msal.standard.mockResolvedValue(client);
  msal.nested.mockResolvedValue(client);
  msal.silent.mockRejectedValue(new Error('no cached account'));
  msal.sso.mockRejectedValue(new Error('not signed in'));
  msal.popup.mockResolvedValue({
    accessToken: 'ephemeral-test-token',
    account: { homeAccountId: 'chosen-account' },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('OneDrive browser authentication for Google Sheets', () => {
  it('uses the standard client without Office and the existing same-origin relay', async () => {
    const port = browserMicrosoftPort();
    expect(await port.signIn(signIn)).toBe('ephemeral-test-token');
    expect(msal.nested).not.toHaveBeenCalled();
    expect(msal.standard).toHaveBeenCalledWith({
      auth: {
        clientId: 'local-app',
        authority: 'https://login.microsoftonline.com/common',
        redirectUri: 'https://addin.example.test/auth.html',
        popupRelayUri: 'https://addin.example.test/auth.html',
      },
    });
    expect(msal.popup).toHaveBeenCalledWith(expect.objectContaining({ scopes: [signIn.scope] }));
    expect(msal.sso).not.toHaveBeenCalled();
    expect(msal.active).toHaveBeenCalledWith({ homeAccountId: 'chosen-account' });
    msal.silent.mockResolvedValue({ accessToken: 'cached-token' });
    expect(await port.signIn(signIn)).toBe('cached-token');
    expect(msal.standard).toHaveBeenCalledTimes(1);
    expect(msal.popup).toHaveBeenCalledTimes(1);
  });

  it('keeps Office nested authentication and its account hint', async () => {
    await expect(officeMicrosoftPort().signIn(signIn)).rejects.toMatchObject({
      reason: 'unsupported',
    });
    expect(msal.standard).not.toHaveBeenCalled();
    expect(msal.nested).not.toHaveBeenCalled();
    vi.stubGlobal('Office', {
      context: { requirements: { isSetSupported: () => true } },
      auth: {
        getAuthContext: async () => ({ userPrincipalName: 'camille@example.test' }),
      },
    });
    await officeMicrosoftPort().signIn(signIn);
    expect(msal.nested).toHaveBeenCalledTimes(1);
    expect(msal.sso).toHaveBeenCalledWith(
      expect.objectContaining({ loginHint: 'camille@example.test' }),
    );
    expect(msal.standard).not.toHaveBeenCalled();
  });

  it('reports popup cancellation without retrying it', async () => {
    msal.popup.mockRejectedValue(
      Object.assign(new Error('cancelled'), { errorCode: 'user_cancelled' }),
    );
    await expect(browserMicrosoftPort().signIn(signIn)).rejects.toMatchObject({
      reason: 'cancelled',
    });
    expect(msal.popup).toHaveBeenCalledTimes(1);
  });

  it('retries a failed SDK load on the next click and separates different client ids', async () => {
    const port = browserMicrosoftPort();
    msal.standard.mockRejectedValueOnce(new Error('load failed'));
    await expect(port.signIn(signIn)).rejects.toMatchObject({ reason: 'failed' });
    expect(await port.signIn(signIn)).toBe('ephemeral-test-token');
    expect(await port.signIn({ ...signIn, clientId: 'another-app' })).toBe('ephemeral-test-token');
    expect(msal.standard).toHaveBeenCalledTimes(3);
  });
});

describe('OneDrive picker initialization', () => {
  it('requires the exact picker frame, origin and channel before accepting its port', () => {
    const frame = {};
    const event = {
      source: frame,
      origin: 'https://onedrive.live.com',
      data: { type: 'initialize', channelId: 'our-channel' },
    };
    expect(isPickerInitialization(event, frame, 'our-channel', event.origin)).toBe(true);
    expect(
      isPickerInitialization({ ...event, source: {} }, frame, 'our-channel', event.origin),
    ).toBe(false);
    expect(
      isPickerInitialization(
        { ...event, origin: 'https://other.test' },
        frame,
        'our-channel',
        event.origin,
      ),
    ).toBe(false);
    expect(isPickerInitialization(event, frame, 'other-channel', event.origin)).toBe(false);
    expect(
      isPickerInitialization(
        { ...event, data: { type: 'initialize' } },
        frame,
        'our-channel',
        event.origin,
      ),
    ).toBe(false);
  });
});
