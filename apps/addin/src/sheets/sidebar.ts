// Runs inside Google's HTML-service frame. Only its hosted child can call the bound script.
import { RequestMessage, type SheetsRequest, SheetsResult } from './protocol';

export interface ScriptRunner {
  withSuccessHandler(handler: (result: unknown) => void): ScriptRunner;
  withFailureHandler(handler: () => void): ScriptRunner;
  fiSheetsCall(request: SheetsRequest): void;
}
declare const google: { script: { run: ScriptRunner } };
export interface SidebarConfig {
  url: string;
  title: string;
  failure: string;
}
export function mount(config: SidebarConfig, runner: ScriptRunner = google.script.run) {
  const url = new URL(config.url);
  const channel = crypto.randomUUID();
  url.searchParams.set('fi_parent', window.location.origin);
  url.searchParams.set('fi_channel', channel);
  const frame = document.createElement('iframe');
  frame.title = config.title;
  frame.src = url.toString();
  frame.style.cssText = 'width:100%;height:100vh;border:0;display:block';
  frame.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads',
  );
  document.body.style.margin = '0';
  document.body.append(frame);
  let queue = Promise.resolve();
  let pending = 0;
  const handle = (event: MessageEvent<unknown>) => {
    if (event.source !== frame.contentWindow || event.origin !== url.origin) return;
    const parsed = RequestMessage.safeParse(event.data);
    if (!parsed.success || parsed.data.channel !== channel) return;
    const request = parsed.data;
    const reply = (raw: unknown) => {
      const result = SheetsResult.safeParse(raw);
      frame.contentWindow?.postMessage(
        {
          type: 'fi.sheets.response',
          channel,
          id: request.id,
          result: result.success ? result.data : { ok: false, code: 'Unavailable' },
        },
        url.origin,
      );
    };
    if (pending >= 50) {
      reply({ ok: false, code: 'Unavailable' });
      return;
    }
    pending++;
    // google.script.run calls may otherwise finish in any order. In particular, never race a
    // settings save or a correction with the next read made by the same pane.
    queue = queue.then(
      () =>
        new Promise<void>((resolve) => {
          const finish = (result: unknown) => {
            pending--;
            reply(result);
            resolve();
          };
          try {
            runner
              .withSuccessHandler(finish)
              .withFailureHandler(() => finish({ ok: false, code: 'Unavailable' }))
              .fiSheetsCall(request.request);
          } catch {
            finish({ ok: false, code: 'Unavailable' });
          }
        }),
    );
  };
  window.addEventListener('message', handle);
  frame.addEventListener('error', () => {
    const notice = document.createElement('p');
    notice.textContent = config.failure;
    document.body.prepend(notice);
  });
  return () => {
    window.removeEventListener('message', handle);
    frame.remove();
  };
}
