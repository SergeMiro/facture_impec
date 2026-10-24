// The harness page (dev only, never built): the task pane next to an in-memory sheet, with the
// ribbon's buttons. Same controller and screens as in Excel; the E2E tests and quick demos run here.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Controller } from '../controller';
import { FakeWorkbook } from '../excel/fake';
import { standInMicrosoftPort } from '../microsoft/stand-in';
import { fakeGoogleSheets } from '../sheets/fake';
import { tokenStore } from '../storage';
import { App } from '../ui/App';
import {
  DEMO_ORDERS,
  DEMO_PURCHASES,
  DEMO_SHEET,
  demoOrders,
  demoPurchases,
  demoSheet,
} from './demo';
import { Grid } from './Grid';

const workbook = new FakeWorkbook({
  [DEMO_SHEET]: demoSheet(),
  [DEMO_ORDERS]: demoOrders(),
  [DEMO_PURCHASES]: demoPurchases(),
});
const query = new URLSearchParams(window.location.search);
const sheetsHost = query.get('host') === 'sheets';
const native = sheetsHost ? fakeGoogleSheets(workbook) : null;
if (native) {
  Object.assign(window, { fiSheetsCall: native.host.dispatch });
}

const controller = new Controller({
  port: workbook,
  // Microsoft's stand-in in apps/mock-pdp, behind the dev server's proxy; `?microsoft=work` signs in
  // the work account instead of the personal one.
  microsoft: standInMicrosoftPort({
    base: '/microsoft',
    account: query.get('microsoft') === 'work' ? 'aad-camille' : 'msa-camille',
  }),
  // `?document=<address>` plays a workbook opened from there (the Scout's suggestion).
  documentUrl: () => query.get('document'),
  tokens: tokenStore(),
  apiBase: __API_URL__,
  objectUrl: {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  },
});

function Harness() {
  return (
    <div className="harness" style={sheetsHost ? { gridTemplateColumns: '1fr 300px' } : undefined}>
      <div className="ribbon" role="toolbar" aria-label="Ruban Facture Impec">
        <strong>Facture Impec</strong>
        <button
          type="button"
          data-testid="ribbon-verifier"
          onClick={() => void controller.verifyFromRibbon()}
        >
          Vérifier
        </button>
        <button
          type="button"
          data-testid="ribbon-envoyer"
          onClick={() => void controller.sendFromRibbon()}
        >
          Envoyer
        </button>
        <button
          type="button"
          data-testid="ribbon-modetest"
          onClick={() => void controller.toggleTestModeFromRibbon()}
        >
          Mode test
        </button>
      </div>
      <main className="sheet">
        <Grid workbook={workbook} />
      </main>
      <aside className="pane" data-testid="pane">
        {sheetsHost ? (
          <iframe
            title="Google Sheets sidebar stand-in"
            data-testid="sheets-sidebar"
            src="/sheets-sidebar-harness.html"
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        ) : (
          <App controller={controller} />
        )}
      </aside>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from harness.html');
createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
window.addEventListener('online', controller.online);
if (!sheetsHost) void controller.start();
