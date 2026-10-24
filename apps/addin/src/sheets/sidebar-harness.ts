// Dev-only Google script runner: the real sidebar talks to the real host over native stand-ins.
import type { SheetsRequest } from './protocol';
import { mount, type ScriptRunner } from './sidebar';

const outer = window.parent as Window & { fiSheetsCall(request: SheetsRequest): unknown };
const runner = (
  success: (result: unknown) => void = () => {},
  failure: () => void = () => {},
): ScriptRunner => ({
  withSuccessHandler: (handler) => runner(handler, failure),
  withFailureHandler: (handler) => runner(success, handler),
  fiSheetsCall(request) {
    setTimeout(() => {
      try {
        success(outer.fiSheetsCall(request));
      } catch {
        failure();
      }
    }, 0);
  },
});
mount(
  {
    url: new URL('/google-sheets.html', window.location.href).toString(),
    title: 'Facture Impec',
    failure: 'Host unavailable',
  },
  runner(),
);
