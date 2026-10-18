// The same task pane inside Excel on the web (plan §11, M3). Skipped unless an account is given:
//   FI_E2E_EXCEL_URL  a workbook in OneDrive / SharePoint, opened in Excel on the web
//   FI_E2E_STORAGE    a Playwright storage state signed in to that Microsoft account
// (docs/RUNBOOK.md § Add-in explains how to record both). The manifest is uploaded with « Charger mon
// complément », pointed at this run's dev server.
// TODO(verify): Excel's own buttons and frames below follow Microsoft's sideloading guide
// (docs/OFFICE.md §6); they were not yet run against a live session, as this server has no account.
import { readFileSync, writeFileSync } from 'node:fs';
import { t } from '@fi/shared';
import { expect, test } from '@playwright/test';
import { seedDemo } from '../src/harness/seed';
import { E2E } from './env';

const workbook = process.env.FI_E2E_EXCEL_URL;
const storage = process.env.FI_E2E_STORAGE;

test.skip(!workbook || !storage, 'FI_E2E_EXCEL_URL and FI_E2E_STORAGE are not set');
test.use({ storageState: storage ?? { cookies: [], origins: [] } });

test('Excel on the web opens the pane from the ribbon and signs in with the key', async ({
  page,
}, info) => {
  const company = await seedDemo({
    api: `http://localhost:${E2E.api}`,
    adminToken: E2E.adminToken,
    account: `e2e-web-${Date.now()}`,
  });
  const manifest = info.outputPath('manifest.xml');
  writeFileSync(
    manifest,
    readFileSync(new URL('../manifest.xml', import.meta.url), 'utf8').replaceAll(
      'https://localhost:3000',
      `https://localhost:${E2E.addin}`,
    ),
  );

  await page.goto(workbook ?? '');
  await page.getByRole('tab', { name: /Accueil|Home/ }).click();
  // Home > Add-ins > More Settings > Upload My Add-in > Browse > Upload (docs/OFFICE.md §6).
  await page.getByRole('button', { name: /Compléments|Add-ins/ }).click();
  await page.getByText(/Plus de paramètres|More Settings/).click();
  await page.getByText(/Charger mon complément|Upload My Add-in/i).click();
  await page.locator('input[type="file"]').setInputFiles(manifest);
  await page.getByRole('button', { name: /^(Charger|Upload)$/ }).click();

  await page.getByRole('button', { name: 'Ouvrir' }).click();
  const pane = page.frameLocator(`iframe[src^="https://localhost:${E2E.addin}/taskpane.html"]`);
  await expect(pane.getByText(t('addin.login.title'))).toBeVisible({ timeout: 60_000 });
  await pane.getByLabel(t('addin.login.key')).fill(company.apiKey);
  await pane.getByRole('button', { name: t('addin.login.withKey') }).click();
  await expect(pane.getByText(t('addin.detect.intro'))).toBeVisible({ timeout: 60_000 });
});
