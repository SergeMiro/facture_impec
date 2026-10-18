// The harness page (dev only, never built): the task pane next to an in-memory sheet, with the
// ribbon's buttons. Same controller and screens as in Excel; the E2E tests and quick demos run here.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Controller } from '../controller';
import { FakeWorkbook } from '../excel/fake';
import { tokenStore } from '../storage';
import { App } from '../ui/App';
import { DEMO_SHEET, demoSheet } from './demo';
import { Grid } from './Grid';

const workbook = new FakeWorkbook({ [DEMO_SHEET]: demoSheet(), Feuil2: {} });
const controller = new Controller({
  port: workbook,
  tokens: tokenStore(),
  apiBase: __API_URL__,
  objectUrl: {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  },
});

function Harness() {
  return (
    <div className="harness">
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
        <App controller={controller} />
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
void controller.start();
