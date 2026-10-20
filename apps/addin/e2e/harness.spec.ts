// M3 acceptance on the harness page (plan §11): a new user signs in with the e-mailed link, maps
// the demo sheet, fixes its two errors from the « Corriger dans la feuille » buttons, rehearses and
// sees « Prêt à envoyer »; then sends a test invoice and plays « Simuler un rejet PDP ». Since M4
// the test platform is B2Brouter's stand-in (a test_ key), which cannot play scenarios: the API
// writes the rejection as the platform would have (apps/api/src/sandbox.ts). Since M6 it also
// receives test supplier invoices on « Réception » and exports them for the accountant. Since R1 it
// includes the « Commandes » sheet in the « Registre », and an edit there reaches the registry. Since R2
// it shows the checks across documents; since R3 the « Achats » sheet gives the purchase price: a sale
// under it blocks, a margin under the one of « Réglages » warns.
// browser: local (Chrome of this server; Browserbase cannot reach localhost).

import { readFile } from 'node:fs/promises';
import { frMoney } from '@fi/core';
import { t } from '@fi/shared';
import { expect, test } from '@playwright/test';
import { DEMO_ORDERS, DEMO_OWNER, DEMO_PURCHASES, DEMO_SHEET } from '../src/harness/demo';
import { seedDemo } from '../src/harness/seed';
import { E2E, LIVE } from './env';
import { api, row, signIn, typeInCell, typeInSelectedCell } from './helpers';

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

  await test.step('Réception: test supplier invoices, the duplicate and the new IBAN flagged, export', async () => {
    await pane.getByRole('tab', { name: t('addin.nav.reception') }).click();
    await expect(pane.getByText(t('addin.reception.emptyTest'))).toBeVisible();
    for (const kind of ['normal', 'duplicate', 'iban_change'] as const) {
      const before = await pane.getByTestId('inbound').count();
      await pane
        .getByRole('button', { name: t(`addin.reception.test.${kind}`), exact: true })
        .click();
      await expect(pane.getByTestId('inbound')).toHaveCount(before + 1);
    }
    // Newest first: the IBAN change, the duplicate, then the first invoice.
    const [changed, twin, first] = [0, 1, 2].map((n) => pane.getByTestId('inbound').nth(n));
    if (!changed || !twin || !first) throw new Error('three cards expected');
    await expect(first.getByTestId('flag-new_supplier')).toBeVisible();
    await expect(twin.getByTestId('flag-duplicate')).toBeVisible();
    await expect(twin.getByRole('button', { name: t('addin.reception.approve') })).toHaveCount(0);
    await expect(changed.getByTestId('flag-iban_changed')).toBeVisible();

    await first.getByRole('button', { name: t('addin.reception.approve') }).click();
    await expect(first).toHaveAttribute('data-status', 'approved');
    const approveChanged = changed.getByRole('button', { name: t('addin.reception.approve') });
    await expect(approveChanged).toBeDisabled();
    await changed.getByLabel(t('addin.reception.ibanCheck')).check();
    await approveChanged.click();
    await expect(changed).toHaveAttribute('data-status', 'approved');
    await twin.getByRole('button', { name: t('addin.reception.dispute') }).click();
    await twin.getByLabel(t('addin.reception.disputeReason')).fill('Doublon');
    await twin.getByRole('button', { name: t('addin.reception.disputeConfirm') }).click();
    await expect(twin).toHaveAttribute('data-status', 'disputed');
    await page.screenshot({ path: info.outputPath('reception.png') });

    await pane.getByRole('button', { name: t('addin.reception.export'), exact: true }).click();
    await expect(pane.getByTestId('notice')).toHaveText(
      new RegExp(t('addin.reception.exported', { count: 2 }).replace(/[()]/g, '\\$&')),
    );
    const made = pane.getByTestId('export').first();
    await made.getByRole('button', { name: t('addin.reception.downloadFec') }).click();
    const download = page.waitForEvent('download');
    await made.getByRole('link', { name: /^TEST-\d{9}FEC\d{8}\.txt$/ }).click();
    // Kept next to the screenshots: `pnpm accounting:check <file>` imports it into Paheko.
    const fec = info.outputPath((await download).suggestedFilename());
    await (await download).saveAs(fec);
    expect((await readFile(fec, 'utf8')).split('\r\n')[0]).toMatch(/^JournalCode\tJournalLib\t/);
    await page.screenshot({ path: info.outputPath('exported.png') });
  });

  await test.step('Registre: « Commandes » is included, and an edit there reaches the registry', async () => {
    await pane.getByRole('tab', { name: t('addin.nav.dashboard') }).click();
    await expect(pane.getByTestId('registry-hint')).toContainText(DEMO_ORDERS);
    await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
    await expect(pane.getByTestId('invoice-sheet')).toContainText(DEMO_SHEET);
    await pane
      .getByTestId(`other-${DEMO_ORDERS}`)
      .getByRole('button', { name: t('addin.registry.include') })
      .click();
    const inclusion = pane.getByTestId('inclusion');
    await expect(inclusion).toContainText(t('addin.registry.confirmTitle', { sheet: DEMO_ORDERS }));
    await expect(inclusion.getByLabel(t('layout.field.quantity'))).toHaveValue('F');
    await page.screenshot({ path: info.outputPath('registry-confirm.png') });
    await inclusion.getByRole('button', { name: t('addin.registry.confirm') }).click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.registry.included', { sheet: DEMO_ORDERS, docs: 2 }),
    );
    const order = pane.locator('[data-testid^="doc-"]').filter({ hasText: 'C-41' });
    await expect(order).toContainText(frMoney(4 * 8_500 + 14_000, 'EUR'));

    // The pane stays on the registry while the user edits « Commandes »: the order follows.
    await page.locator('.tabs').getByRole('button', { name: DEMO_ORDERS }).click();
    await typeInCell(page, 'F2', '5');
    await expect(order).toContainText(frMoney(5 * 8_500 + 14_000, 'EUR'));
    // « Voir dans la feuille » selects where the order starts.
    await page.locator('.tabs').getByRole('button', { name: DEMO_SHEET }).click();
    await order.getByText(t('addin.registry.showDoc')).click();
    await expect(page.getByTestId('name-box')).toHaveText('E2');
    await page.screenshot({ path: info.outputPath('registry.png') });
    // Every screen fits the pane's width: nothing scrolls sideways.
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });

  await test.step('Contrôles: the order says 1 200 €, the invoice 900 €; « Envoyer quand même »', async () => {
    // C-42 becomes the order F2026-102 bills: same customer, same article, no number to tie them.
    await page.locator('.tabs').getByRole('button', { name: DEMO_ORDERS }).click();
    await typeInCell(page, 'C4', 'Garage Dupont');
    await typeInCell(page, 'D4', '');
    await typeInCell(page, 'E4', 'Audit atelier');
    await typeInCell(page, 'F4', '1');
    await typeInCell(page, 'G4', '1200');
    await page.locator('.tabs').getByRole('button', { name: DEMO_SHEET }).click();

    await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
    await expect(pane.getByTestId('checks-summary')).toHaveText(
      t('addin.checks.atStake', { amount: frMoney(30_000, 'EUR'), count: 1 }),
    );
    const finding = pane
      .getByTestId('finding')
      .filter({ hasText: 'C-42' })
      // The real invoice's, not the one on TEST-F2026-102.
      .filter({ hasText: 'La facture F2026-102' });
    await expect(finding).toContainText(
      t('addin.checks.amount', { amount: frMoney(30_000, 'EUR') }),
    );
    await finding.getByRole('button', { name: t('addin.checks.see.order') }).click();
    await expect(page.getByTestId('name-box')).toHaveText('E4');
    await finding.getByRole('button', { name: t('addin.checks.fixLine') }).click();
    await expect(page.getByTestId('name-box')).toHaveText('K3');
    await page.screenshot({ path: info.outputPath('checks.png') });
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

    await finding.getByRole('button', { name: t('addin.checks.openInvoice') }).click();
    await pane.getByRole('button', { name: t('addin.invoice.sendDespite') }).click();
    await expect(pane.getByTestId('confirm-despite')).toContainText(
      t('addin.invoice.confirmSendDespite', { count: 1, amount: frMoney(30_000, 'EUR') }),
    );
    await page.screenshot({ path: info.outputPath('send-despite.png') });
  });

  await test.step('Achats: « Audit atelier » sold 900 €, bought 1 000 €; then a 20 % margin', async () => {
    await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
    await pane
      .getByTestId(`other-${DEMO_PURCHASES}`)
      .getByRole('button', { name: t('addin.registry.include') })
      .click();
    await pane
      .getByTestId('inclusion')
      .getByRole('button', { name: t('addin.registry.confirm') })
      .click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.registry.included', { sheet: DEMO_PURCHASES, docs: 2 }),
    );

    await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
    const loss = pane.getByTestId('finding').filter({ hasText: 'Sur la facture F2026-102,' });
    await expect(loss).toContainText("l'achat A-7 de la feuille « Achats »");
    await expect(loss).toContainText(t('addin.checks.blocking'));
    await loss.getByRole('button', { name: t('addin.checks.see.purchase') }).click();
    await expect(page.getByTestId('name-box')).toHaveText('D3');
    await page.screenshot({ path: info.outputPath('purchase.png') });

    // Not the same audit: A-6, bought 800 €, gives the cost; 900 € is no loss.
    await loss.getByRole('button', { name: t('addin.checks.notSameItem') }).click();
    await expect(pane.getByTestId('notice')).toContainText(t('addin.checks.decided.notSameItem'));
    await expect(loss).toHaveCount(0);

    await pane.getByRole('tab', { name: t('addin.nav.settings') }).click();
    await pane.getByTestId('min-margin').fill('20');
    await pane
      .getByTestId('min-margin')
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: t('addin.settings.save') })
      .click();
    await expect(pane.getByTestId('notice')).toContainText(t('addin.settings.saved'));
    await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
    const margin = pane.getByTestId('finding').filter({ hasText: 'Sur la facture F2026-102,' });
    await expect(margin).toContainText('votre marge est de 11,1 %, sous les 20 %');
    await expect(margin).toContainText(t('addin.checks.warning'));
    await margin.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('margin.png') });
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });
});
