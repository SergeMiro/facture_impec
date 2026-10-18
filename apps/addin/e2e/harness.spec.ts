// M3 acceptance on the harness page (plan §11): a new user signs in with the e-mailed link, maps
// the demo sheet, fixes its two errors from the « Corriger dans la feuille » buttons, rehearses and
// sees « Prêt à envoyer »; then sends a test invoice and plays « Simuler un rejet PDP ». Since M4
// the test platform is B2Brouter's stand-in (a test_ key), which cannot play scenarios: the API
// writes the rejection as the platform would have (apps/api/src/sandbox.ts).
// browser: local (Chrome of this server; Browserbase cannot reach localhost).
import { t } from '@fi/shared';
import { expect, test } from '@playwright/test';
import { DEMO_OWNER } from '../src/harness/demo';
import { seedDemo } from '../src/harness/seed';
import { E2E, LIVE } from './env';
import { api, row, signIn, typeInSelectedCell } from './helpers';

// The live run is b2brouter.spec.ts alone: this one needs the stand-in's account and SIRENs.
test.skip(LIVE !== null, 'live B2Brouter run');

test('a new user maps the sheet, fixes two errors, rehearses and plays a test scenario', async ({
  page,
  context,
}, info) => {
  await seedDemo({ api, adminToken: E2E.adminToken, account: `e2e-${Date.now()}` });
  await page.goto('/harness.html');
  const pane = page.getByTestId('pane');
  const started = Date.now();

  await test.step('Connexion: the e-mailed link signs the pane in', async () => {
    await signIn(pane, context, DEMO_OWNER);
  });

  await test.step('Détection: the proposed columns are confirmed', async () => {
    await pane.getByRole('button', { name: t('addin.detect.confirm') }).click();
    await expect(pane.getByTestId('counts')).toHaveText(
      t('addin.dash.counts', { total: 3, errors: 2, ready: 1 }),
    );
    await expect(page.getByTestId('cell-M1')).toHaveText('FI_Statut');
    await expect(page.getByTestId('cell-N1')).toHaveText('FI_Détail');
  });

  await test.step('Fiche: the SIREN error is fixed from its cell link', async () => {
    await row(pane, 'F2026-102')
      .getByRole('button', { name: t('addin.dash.view') })
      .click();
    const card = pane.getByTestId('explanation').filter({ hasText: 'Factures!E3' });
    await card.getByRole('button', { name: t('addin.invoice.fix') }).click();
    await typeInSelectedCell(page, 'E3', '400 000 006');
    await expect(pane.getByTestId('no-issues')).toBeVisible();
  });

  await test.step('Fiche: the missing date is fixed the same way', async () => {
    await pane.getByRole('button', { name: t('addin.invoice.back') }).click();
    await row(pane, 'F2026-103')
      .getByRole('button', { name: t('addin.dash.view') })
      .click();
    const card = pane.getByTestId('explanation').filter({ hasText: 'Factures!B4' }).first();
    await card.getByRole('button', { name: t('addin.invoice.fix') }).click();
    await typeInSelectedCell(page, 'B4', '14/10/2026');
    await expect(pane.getByTestId('no-issues')).toBeVisible();
  });

  await test.step('Répétition: « Prêt à envoyer »', async () => {
    await pane.getByRole('button', { name: t('addin.invoice.rehearse') }).click();
    await expect(pane.getByTestId('rehearsal')).toContainText(t('rehearsal.ready'));
    await page.screenshot({ path: info.outputPath('ready.png') });
    console.log(
      `Ready to send ${Math.round((Date.now() - started) / 1000)} s after opening the page`,
    );
  });

  await test.step('Mode test: the ribbon button turns it on, the sheet says Test', async () => {
    await page.getByTestId('ribbon-modetest').click();
    await expect(pane.getByTestId('test-banner')).toHaveText(t('banner.testMode'));
    await expect(row(pane, 'TEST-F2026-101')).toBeVisible();
    await expect(page.getByTestId('cell-M2')).toContainText(
      t('addin.sheet.testLabel', { label: '' }),
    );
  });

  await test.step('Envoyer en test, then « Simuler un rejet PDP »', async () => {
    await row(pane, 'TEST-F2026-101')
      .getByRole('button', { name: t('addin.dash.view') })
      .click();
    await pane.getByRole('button', { name: t('addin.invoice.sendTest') }).click();
    await pane
      .getByTestId('confirm-send')
      .getByRole('button', { name: t('addin.invoice.confirm') })
      .click();
    const status = pane.getByTestId('invoice-status');
    await expect(status).toHaveText(t('invoice.status.deposited'), { timeout: 60_000 });

    await pane
      .getByTestId('scenario-panel')
      .getByRole('button', { name: t('addin.scenario.pdp_reject') })
      .click();
    await expect(status).toHaveText(t('invoice.status.rejected_by_pdp'), { timeout: 60_000 });
    await expect(pane.getByTestId('timeline')).toContainText(
      t('addin.invoice.event.scenario', { scenario: t('addin.scenario.pdp_reject') }),
    );
    await expect(page.getByTestId('cell-M2')).toHaveText(
      t('addin.sheet.testLabel', { label: t('invoice.status.rejected_by_pdp') }),
    );
    await page.screenshot({ path: info.outputPath('rejected.png') });
  });
});
