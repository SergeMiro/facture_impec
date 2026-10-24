// Same app and API, through the real Apps Script host adapter and the two-frame sidebar bridge.
// Google services are native stand-ins. A real account installation is G1–G4 in GOOGLE_SHEETS.md.
// browser: local
import { readFile } from 'node:fs/promises';
import { t } from '@fi/shared';
import { expect, test } from '@playwright/test';
import { DEMO_ORDERS, DEMO_SHEET } from '../src/harness/demo';
import { seedDemo } from '../src/harness/seed';
import { E2E, LIVE } from './env';
import { api, row, signIn, typeInCell } from './helpers';

test.skip(LIVE !== null, 'Google Sheets harness uses the stand-in only');

test('Google Sheets signs in, maps, sends, receives, follows sources and corrects/undoes', async ({
  page,
  context,
}, info) => {
  const email = 'gerante-sheets@atelier-dupont.test';
  await seedDemo({ api, adminToken: E2E.adminToken, account: `sheets-${Date.now()}`, email });
  await page.goto('/harness.html?host=sheets');
  const pane = page
    .frameLocator('[data-testid="sheets-sidebar"]')
    .frameLocator('iframe')
    .locator('#root');
  console.log('browser: local; host: Google Sheets native-service stand-in');

  await test.step('Sign-in and mapping through the Google sidebar', async () => {
    await signIn(pane, context, email);
    await pane.getByRole('button', { name: t('addin.detect.confirm') }).click();
    await expect(pane.getByTestId('counts')).toHaveText(
      t('addin.dash.counts', { total: 3, errors: 2, ready: 1 }),
    );
    await expect(page.getByTestId('cell-M1')).toHaveText('FI_Statut');
    await expect(page.getByTestId('cell-N1')).toHaveText('FI_Détail');
    await typeInCell(page, 'E3', '400 000 006');
    await typeInCell(page, 'B4', '14/10/2026');
    await expect(pane.getByTestId('counts')).toHaveText(
      t('addin.dash.counts', { total: 3, errors: 0, ready: 3 }),
    );
  });

  await test.step('Test send and the platform status back in Google cells', async () => {
    await pane.getByRole('button', { name: t('sheets.test'), exact: true }).click();
    await expect(pane.getByTestId('test-banner')).toBeVisible();
    await row(pane, 'TEST-F2026-101')
      .getByRole('button', { name: t('addin.dash.view') })
      .click();
    await pane.getByRole('button', { name: t('addin.invoice.sendTest') }).click();
    await pane
      .getByTestId('confirm-send')
      .getByRole('button', { name: t('addin.invoice.confirm') })
      .click();
    await expect(pane.getByTestId('invoice-status')).toHaveText(t('invoice.status.deposited'), {
      timeout: 60_000,
    });
    await expect(page.getByTestId('cell-M2')).toHaveText(
      t('addin.sheet.testLabel', { label: t('invoice.status.deposited') }),
    );
    await page.screenshot({ path: info.outputPath('sheets-send.png') });
  });

  await test.step('Reception and accounting download inside the nested sidebar', async () => {
    await pane.getByRole('tab', { name: t('addin.nav.reception') }).click();
    await pane.getByRole('button', { name: t('addin.reception.test.normal'), exact: true }).click();
    const incoming = pane.getByTestId('inbound').first();
    await incoming.getByRole('button', { name: t('addin.reception.approve') }).click();
    await expect(incoming).toHaveAttribute('data-status', 'approved');
    await pane.getByRole('button', { name: t('addin.reception.export'), exact: true }).click();
    const exported = pane.getByTestId('export').first();
    await exported.getByRole('button', { name: t('addin.reception.downloadFec') }).click();
    const download = page.waitForEvent('download');
    await exported.getByRole('link', { name: /^TEST-\d{9}FEC\d{8}\.txt$/ }).click();
    const file = await download;
    const target = info.outputPath(file.suggestedFilename());
    await file.saveAs(target);
    expect(await readFile(target, 'utf8')).toMatch(/^JournalCode\tJournalLib\t/);
  });

  await test.step('A source edit reaches checks, then a confirmed correction can be undone', async () => {
    await pane.getByRole('button', { name: t('sheets.test'), exact: true }).click();
    await expect(pane.getByTestId('test-banner')).toHaveCount(0);
    await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
    await pane
      .getByTestId(`other-${DEMO_ORDERS}`)
      .getByRole('button', { name: t('addin.registry.include') })
      .click();
    await pane
      .getByTestId('inclusion')
      .getByRole('button', { name: t('addin.registry.confirm') })
      .click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.registry.included', { sheet: DEMO_ORDERS, docs: 2 }),
    );
    await page.locator('.tabs').getByRole('button', { name: DEMO_ORDERS }).click();
    for (const [cell, value] of [
      ['C4', 'Garage Dupont'],
      ['D4', ''],
      ['E4', 'Audit atelier'],
      ['F4', '1'],
      ['G4', '1200'],
    ] as const) {
      await typeInCell(page, cell, value);
    }
    await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
    const finding = pane
      .getByTestId('finding')
      .filter({ hasText: 'C-42' })
      .filter({ hasText: 'La facture F2026-102' });
    await expect(finding).toContainText('300,00');
    await finding.getByRole('button', { name: t('addin.checks.fixForMe') }).click();
    const card = pane.getByTestId('edit-card');
    await expect(card.getByTestId('edit-before')).toHaveText('900');
    await expect(card.getByTestId('edit-after')).toHaveText('1200');
    await page.locator('.tabs').getByRole('button', { name: DEMO_SHEET }).click();
    await expect(page.getByTestId('cell-K3')).toHaveText('900,00 €');
    await card.getByRole('button', { name: t('addin.edit.apply'), exact: true }).click();
    await expect(page.getByTestId('cell-K3')).toHaveText('1200');
    await expect(finding).toHaveCount(0);
    await pane
      .getByTestId('corrected')
      .getByRole('button', { name: t('addin.edit.undo') })
      .click();
    await pane
      .getByTestId('edit-card')
      .getByRole('button', { name: t('addin.edit.applyUndo') })
      .click();
    await expect(page.getByTestId('cell-K3')).toHaveText('900');
    await expect(finding).toHaveCount(1);
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath('sheets-correction-undone.png') });
  });

  await test.step('Sign-out closes the watchers and preserves the spreadsheet', async () => {
    await pane.getByRole('tab', { name: t('addin.nav.settings') }).click();
    await pane.getByRole('button', { name: t('addin.settings.signOut') }).click();
    await expect(pane.getByLabel(t('addin.login.email'))).toBeVisible();
    await expect(page.getByTestId('cell-K3')).toHaveText('900');
  });
});
