// M3 acceptance on the harness page (plan §11): a new user signs in with the e-mailed link, maps
// the demo sheet, fixes its two errors from the « Corriger dans la feuille » buttons, rehearses and
// sees « Prêt à envoyer »; then sends a test invoice and plays « Simuler un rejet PDP ».
// browser: local (Chrome of this server; Browserbase cannot reach localhost).
import { t } from '@fi/shared';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { DEMO_OWNER } from '../src/harness/demo';
import { seedDemo } from '../src/harness/seed';
import { E2E } from './env';

const api = `http://localhost:${E2E.api}`;

/** The sign-in link of the last mail the local outbox kept for this address. */
async function linkFor(email: string): Promise<string> {
  let url: string | undefined;
  await expect
    .poll(async () => {
      const res = await fetch(`${api}/admin/outbox`, {
        headers: { authorization: `Bearer ${E2E.adminToken}` },
      });
      const { mails } = (await res.json()) as { mails: { to: string; text: string }[] };
      const mail = mails.filter((m) => m.to === email).at(-1);
      url = /https?:\/\/\S+\/auth\/magic-link\/confirm\?token=\S+/.exec(mail?.text ?? '')?.[0];
      return url;
    })
    .toBeTruthy();
  return url ?? '';
}

/** Types into a cell the way a user does: select it, type in the formula bar, press Enter. */
async function typeInSelectedCell(page: Page, cell: string, text: string) {
  await expect(page.getByTestId('name-box')).toHaveText(cell);
  const bar = page.getByTestId('formula-bar');
  await bar.fill(text);
  await bar.press('Enter');
}

const row = (pane: Locator, number: string) =>
  pane.locator('[data-testid^="row-"]').filter({ hasText: number });

test('a new user maps the sheet, fixes two errors, rehearses and plays a test scenario', async ({
  page,
  context,
}, info) => {
  await seedDemo({ api, adminToken: E2E.adminToken, account: `e2e-${Date.now()}` });
  await page.goto('/harness.html');
  const pane = page.getByTestId('pane');
  const started = Date.now();

  await test.step('Connexion: the e-mailed link signs the pane in', async () => {
    await pane.getByLabel(t('addin.login.email')).fill(DEMO_OWNER);
    await pane.getByRole('button', { name: t('addin.login.sendLink') }).click();
    await expect(pane.getByTestId('link-waiting')).toBeVisible();
    const mail = await context.newPage();
    await mail.goto(await linkFor(DEMO_OWNER));
    await mail.getByRole('button', { name: t('login.page.button') }).click();
    await expect(mail.getByText(t('login.page.done'))).toBeVisible();
    await mail.close();
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
