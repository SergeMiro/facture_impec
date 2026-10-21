// The real MicrosoftPort (R4, docs/MICROSOFT365.md, Learn read 2026-10-21). Nested app authentication
// signs the person in with the account Office already has; OneDrive's own picker (v8) runs in a frame
// over the pane and talks through a MessageChannel. MSAL loads only when the person connects: the pane
// does not carry its 290 KB otherwise.
import type { IPublicClientApplication } from '@azure/msal-browser';
import { z } from 'zod';
import { type MicrosoftPort, MicrosoftPortError, type PickedFile } from './port';

/** Learn (NAA): `common` serves personal and work accounts alike. */
const AUTHORITY = 'https://login.microsoftonline.com/common';

/** Learn (NAA): Office answers with requirement set NestedAppAuth 1.1 where it works. */
function supported(): boolean {
  return (
    typeof Office !== 'undefined' &&
    Office.context?.requirements?.isSetSupported('NestedAppAuth', '1.1') === true
  );
}

/** The picker's first message on the window, with the port of its channel. */
const Initialize = z.object({ type: z.literal('initialize'), channelId: z.string() });
/** Then every request on that port: acknowledged, then answered with a `result`. */
const Command = z.object({
  type: z.literal('command'),
  id: z.string(),
  data: z.object({ command: z.string() }).loose(),
});
const Authenticate = z.object({ resource: z.string().optional() }).loose();
const Pick = z.object({
  items: z.array(
    z
      .object({ id: z.string().min(1), parentReference: z.object({ driveId: z.string().min(1) }) })
      .loose(),
  ),
});

export function officeMicrosoftPort(): MicrosoftPort {
  let app: Promise<IPublicClientApplication> | null = null;
  let appFor = '';

  function client(clientId: string): Promise<IPublicClientApplication> {
    if (!app || appFor !== clientId) {
      appFor = clientId;
      const created = import('@azure/msal-browser').then((msal) =>
        msal.createNestablePublicClientApplication({ auth: { clientId, authority: AUTHORITY } }),
      );
      // A failed load is tried again at the next click.
      created.catch(() => {
        if (app === created) app = null;
      });
      app = created;
    }
    return app;
  }

  /** Learn (NAA): silently when Office already holds consent, else Microsoft's own window. */
  async function token(clientId: string, scope: string): Promise<string> {
    if (!supported()) throw new MicrosoftPortError('unsupported');
    let pca: IPublicClientApplication;
    try {
      pca = await client(clientId);
    } catch (e) {
      throw new MicrosoftPortError('failed', String(e));
    }
    const request = { scopes: [scope] };
    try {
      return (await pca.acquireTokenSilent(request)).accessToken;
    } catch {
      // Consent or a fresh sign-in is needed: the window below asks the person.
    }
    try {
      return (await pca.acquireTokenPopup(request)).accessToken;
    } catch (e) {
      const code = e instanceof Error && 'errorCode' in e ? String(e.errorCode) : '';
      throw new MicrosoftPortError(code === 'user_cancelled' ? 'cancelled' : 'failed', String(e));
    }
  }

  return {
    signIn: ({ clientId, scope }) => token(clientId, scope),

    /**
     * Learn (File Picker v8): a form POST of the token into a frame, the options in `filePicker`, then
     * `initialize` → `activate`, and commands `authenticate` / `pick` / `close` on the channel.
     * TODO(verify): with the owner's app registration, personal and work (docs/MICROSOFT365.md).
     */
    async pick({ clientId, picker, labels }) {
      const first = await token(clientId, picker.scope);
      const channelId = crypto.randomUUID();
      const options = {
        sdk: '8.0',
        entry: { oneDrive: { files: {} } },
        authentication: {},
        messaging: { origin: window.location.origin, channelId },
        selection: { mode: 'multiple' },
        typesAndSources: { mode: 'files', filters: ['.xlsx', '.xlsm', '.csv'] },
      };
      const url = `${picker.baseUrl}?${new URLSearchParams({
        filePicker: JSON.stringify(options),
        locale: 'fr-fr',
      })}`;

      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', labels.title);
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;background:#fff';
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = labels.close;
      close.style.cssText = 'align-self:flex-end;margin:4px';
      const frame = document.createElement('iframe');
      frame.name = `fi-picker-${channelId}`;
      frame.title = labels.title;
      frame.style.cssText = 'flex:1;border:0;width:100%';
      overlay.append(close, frame);
      document.body.append(overlay);

      return new Promise<PickedFile[]>((resolve) => {
        let port: MessagePort | null = null;
        const finish = (files: PickedFile[]) => {
          window.removeEventListener('message', onWindow);
          port?.close();
          overlay.remove();
          resolve(files);
        };
        const reply = (id: string, data: unknown) =>
          port?.postMessage({ type: 'result', id, data });
        const onPort = async (event: MessageEvent) => {
          const message = Command.safeParse(event.data);
          if (!message.success) return; // notifications: nothing to do
          const { id, data } = message.data;
          port?.postMessage({ type: 'acknowledge', id });
          switch (data.command) {
            case 'authenticate': {
              const { resource } = Authenticate.parse(data);
              // A work account's picker may ask for another SharePoint host than the drive's.
              const scope = resource?.startsWith('https://')
                ? `${new URL(resource).origin}/.default`
                : picker.scope;
              try {
                reply(id, { result: 'token', token: await token(clientId, scope) });
              } catch (e) {
                reply(id, {
                  result: 'error',
                  error: { code: 'unableToObtainToken', message: String(e) },
                });
              }
              break;
            }
            case 'pick': {
              const picked = Pick.safeParse(data);
              reply(id, { result: 'success' });
              finish(
                picked.success
                  ? picked.data.items.map((i) => ({
                      driveId: i.parentReference.driveId,
                      itemId: i.id,
                    }))
                  : [],
              );
              break;
            }
            case 'close':
              finish([]);
              break;
            default:
              reply(id, {
                result: 'error',
                error: { code: 'unsupportedCommand', message: data.command },
                isExpected: true,
              });
          }
        };
        const onWindow = (event: MessageEvent) => {
          if (event.source !== frame.contentWindow) return;
          const message = Initialize.safeParse(event.data);
          const channel = event.ports[0];
          if (!message.success || message.data.channelId !== channelId || !channel) return;
          port = channel;
          port.addEventListener('message', (e) => void onPort(e));
          port.start();
          port.postMessage({ type: 'activate' });
        };
        close.addEventListener('click', () => finish([]));
        window.addEventListener('message', onWindow);

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = url;
        form.target = frame.name;
        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = 'access_token';
        field.value = first;
        form.append(field);
        document.body.append(form);
        form.submit();
        form.remove();
      });
    },
  };
}
