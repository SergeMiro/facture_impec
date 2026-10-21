// The task pane's entry (docs/OFFICE.md §2, §8): wait for Office, register the ribbon commands of
// the shared runtime, then render. Ribbon clicks that arrive before the start wait for it.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { COMMANDS, type Command } from './commands';
import { Controller } from './controller';
import { officeExcelPort } from './excel/office';
import { officeMicrosoftPort } from './microsoft/office';
import { officeOpenUrl } from './pages';
import { tokenStore } from './storage';
import { App } from './ui/App';

/** office.js that never loads (network filter, extension) never resolves onReady. */
const READY_TIMEOUT_MS = 8_000;

function officeReady(): Promise<Office.HostType | null> {
  if (typeof Office === 'undefined') return Promise.resolve(null);
  return Promise.race([
    Office.onReady().then((info) => info.host ?? null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
  ]);
}

async function boot(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root is missing from taskpane.html');
  const host = await officeReady();
  const controller = new Controller({
    port: officeExcelPort(),
    tokens: tokenStore(),
    apiBase: __API_URL__,
    showTaskpane: () => Office.addin.showAsTaskpane(),
    openUrl: officeOpenUrl,
    microsoft: officeMicrosoftPort(),
    documentUrl: () =>
      typeof Office === 'undefined' ? null : Office.context?.document?.url || null,
    // Only Office on iPad ever says false; elsewhere it may be undefined (docs/APPSOURCE.md §3).
    commerceAllowed: typeof Office === 'undefined' || Office.context?.commerceAllowed !== false,
    objectUrl: {
      create: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
    },
  });
  createRoot(root).render(
    <StrictMode>
      <App controller={controller} />
    </StrictMode>,
  );
  if (typeof Office === 'undefined' || host !== Office.HostType.Excel) {
    controller.outside();
    return;
  }

  const started = controller.start();
  const handlers: Record<Command, () => Promise<void>> = {
    verifier: controller.verifyFromRibbon,
    envoyer: controller.sendFromRibbon,
    modeTest: controller.toggleTestModeFromRibbon,
  };
  for (const id of COMMANDS) {
    Office.actions.associate(id, async (event: Office.AddinCommands.Event) => {
      try {
        await started;
        await handlers[id]();
      } catch (e) {
        console.error(e);
      } finally {
        // Without it Excel queues every later click of the ribbon forever (docs/OFFICE.md §2).
        event.completed();
      }
    });
  }
  window.addEventListener('online', controller.online);
}

void boot();
