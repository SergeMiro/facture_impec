// M3 acceptance on the harness page (plan §11): a new user signs in with the e-mailed link, maps
// the demo sheet, fixes its two errors from the « Corriger dans la feuille » buttons, rehearses and
// sees « Prêt à envoyer »; then sends a test invoice and plays « Simuler un rejet PDP ». Since M4
// the test platform is B2Brouter's stand-in (a test_ key), which cannot play scenarios: the API
// writes the rejection as the platform would have (apps/api/src/sandbox.ts). Since M6 it also
// receives test supplier invoices on « Réception » and exports them for the accountant. Since R1 it
// includes the « Commandes » sheet in the « Registre », and an edit there reaches the registry. Since R2
// it shows the checks across documents; since R3 the « Achats » sheet gives the purchase price: a sale
// under it blocks, a margin under the one of « Réglages » warns. Since R8 « Corriger pour moi » writes
// the order's price into the cell on « Appliquer » and puts it back on « Annuler la correction », and the
// assistant proposes the same card in the chat; its two answers are played by the page (no model in the
// E2E stack), everything else is the real API. Since R4 an order in a OneDrive file, picked through
// Microsoft's stand-in, gives a finding once it changes there, the file never opened; since R5 the same
// from Google Drive, picked in Google's window (its stand-in).
// browser: local (Chrome of this server; Browserbase cannot reach localhost).

import { readFile } from 'node:fs/promises';
import { frMoney } from '@fi/core';
import { xlsxOf } from '@fi/core/testing/xlsx';
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
  // The workbook plays one opened from OneDrive: the Scout suggests « Fichiers OneDrive » once.
  await page.goto(
    `/harness.html?document=${encodeURIComponent('https://d.docs.live.net/4f1c0a2b9d/Documents/Factures.xlsx')}`,
  );
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

  const cell = `${DEMO_SHEET}!K3`;
  const missing = pane.getByTestId('finding').filter({ hasText: 'C-42' });
  // In Mode test the row feeds TEST-F2026-102: that one is corrected from the sheet, not the real one.
  const b1 = missing.filter({ hasText: 'La facture TEST-F2026-102' });

  await test.step('Corrections: « Corriger pour moi » writes 1 200 € on « Appliquer », then undoes it', async () => {
    await missing
      .filter({ hasText: 'La facture F2026-102' })
      .getByRole('button', { name: t('addin.checks.fixForMe') })
      .click();
    await expect(pane.getByTestId('notice')).toContainText(t('addin.edit.otherMode.test'));
    await expect(pane.getByTestId('edit-card')).toHaveCount(0);

    await b1.getByRole('button', { name: t('addin.checks.fixForMe') }).click();
    const card = pane.getByTestId('edit-card');
    await expect(card.getByTestId('edit-before')).toHaveText('900');
    await expect(card.getByTestId('edit-after')).toHaveText('1200');
    await expect(card).toContainText(t('addin.edit.safe'));
    // Nothing is written before the click.
    await page.locator('.tabs').getByRole('button', { name: DEMO_SHEET }).click();
    await expect(page.getByTestId('cell-K3')).toHaveText('900,00 €');
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('card.png') });

    await card.getByRole('button', { name: t('addin.edit.apply'), exact: true }).click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.edit.applied', { cell, before: '900', after: '1200' }),
    );
    await expect(page.getByTestId('cell-K3')).toHaveText('1200');
    await expect(page.getByTestId('name-box')).toHaveText('K3');
    await expect(b1).toHaveCount(0);
    const corrected = pane.getByTestId('corrected');
    await expect(corrected).toContainText(
      t('addin.edit.corrected', { cell, before: '900', after: '1200' }),
    );
    await page.screenshot({ path: info.outputPath('applied.png') });

    await corrected.getByRole('button', { name: t('addin.edit.undo') }).click();
    await pane
      .getByTestId('edit-card')
      .getByRole('button', { name: t('addin.edit.applyUndo') })
      .click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.edit.reverted', { cell, value: '900' }),
    );
    await expect(page.getByTestId('cell-K3')).toHaveText('900');
    await expect(b1).toHaveCount(1);
  });

  await test.step('Assistant: the agent proposes the same card in the chat; « Appliquer », then it says so', async () => {
    const ofApi = (path: RegExp) => (url: URL) => path.test(url.pathname);
    const sse = (...chunks: object[]) =>
      `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
    // The two answers of the model, as the API streams them (apps/api/src/chat.test.ts plays them there).
    const answers = [
      sse(
        { type: 'start' },
        { type: 'start-step' },
        { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'proposeFix', input: {} },
        { type: 'finish-step' },
        { type: 'finish' },
      ),
      sse(
        { type: 'start' },
        { type: 'start-step' },
        { type: 'text-start', id: 't1' },
        {
          type: 'text-delta',
          id: 't1',
          delta: 'C’est corrigé : la ligne reprend les 1 200 € de C-42.',
        },
        { type: 'text-end', id: 't1' },
        { type: 'finish-step' },
        { type: 'finish' },
      ),
    ];
    const asked: unknown[] = [];
    await page.route(ofApi(/^\/api\/checks$/), async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), assistant: true } });
    });
    await page.route(ofApi(/^\/api\/findings\/[^/]+\/chat$/), async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), available: true } });
    });
    await page.route(ofApi(/^\/api\/chat$/), async (route) => {
      asked.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
        body: answers.shift() ?? '',
      });
    });

    await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
    await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
    await b1.getByRole('button', { name: t('addin.checks.ask') }).click();
    const chat = pane.getByTestId('chat-messages');
    // It opens on the finding, already read.
    await expect(chat.getByTestId('chat-assistant').first()).toContainText(
      'La facture TEST-F2026-102',
    );
    await pane.getByLabel(t('addin.chat.question')).fill('Corrigez-la pour moi.');
    await pane.getByRole('button', { name: t('addin.chat.send') }).click();
    const card = pane.getByTestId('edit-card');
    await expect(card.getByTestId('edit-after')).toHaveText('1200');
    await expect(pane.getByText(t('addin.chat.cardFirst'))).toBeVisible();
    await expect(page.getByTestId('cell-K3')).toHaveText('900');
    await page.screenshot({ path: info.outputPath('chat-card.png') });

    await card.getByRole('button', { name: t('addin.edit.apply'), exact: true }).click();
    await expect(chat.getByTestId('chat-assistant').last()).toContainText('C’est corrigé');
    await expect(chat).toContainText(t('addin.chat.card.applied'));
    await expect(page.getByTestId('cell-K3')).toHaveText('1200');
    // The second question carried the click to the agent.
    expect(asked).toHaveLength(2);
    expect(JSON.stringify(asked[1])).toContain('"status":"applied"');
    await page.screenshot({ path: info.outputPath('chat.png') });
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.unrouteAll();
  });

  await test.step('OneDrive: C-77 changes in a file nobody opened; Contrôles finds the 300 €', async () => {
    const FILE = 'Commandes OneDrive.xlsx';
    // Camille's personal OneDrive in the stand-in: C-77 orders F2026-103's three days at 300 €.
    const putOrders = async (price: number) => {
      const bytes = xlsxOf({
        Commandes: [
          ['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'],
          ['C-77', { date: 46296 }, 'Fleurs & Co', 'Formation Excel', 3, price],
        ],
      });
      const res = await fetch(
        `http://localhost:${E2E.mock}/microsoft/control/files/msa-camille/cmd-e2e?name=${encodeURIComponent(FILE)}`,
        { method: 'PUT', body: bytes },
      );
      expect(res.status).toBe(204);
    };
    await putOrders(300);

    await pane.getByRole('tab', { name: t('addin.nav.dashboard') }).click();
    const hint = pane.getByTestId('onedrive-hint');
    await expect(hint).toContainText(t('addin.connector.scout.document'));
    await page.screenshot({ path: info.outputPath('onedrive-hint.png') });
    await hint.getByRole('button', { name: t('addin.connector.scout.open') }).click();
    const section = pane.getByTestId('connector');
    await section.getByRole('button', { name: t('addin.connector.connect') }).click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.connector.connected', { account: 'camille.martin@outlook.fr' }),
    );
    await expect(section).toContainText(t('addin.connector.notified'));
    await section.getByRole('button', { name: t('addin.connector.pick') }).click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.connector.picked', { count: 1 }),
    );
    await pane
      .getByTestId(`file-${FILE}`)
      .getByTestId('file-sheet-Commandes')
      .getByRole('button', { name: t('addin.registry.include') })
      .click();
    const inclusion = pane.getByTestId('inclusion');
    await expect(inclusion).toContainText(
      t('addin.connector.confirmTitle', { sheet: 'Commandes', file: FILE }),
    );
    await expect(inclusion.getByLabel(t('layout.field.unitPrice'))).toHaveValue('F');
    await inclusion.getByRole('button', { name: t('addin.registry.confirm') }).click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.connector.included', { sheet: 'Commandes', file: FILE, docs: 1 }),
    );
    await expect(pane.locator('[data-testid^="doc-"]').filter({ hasText: 'C-77' })).toContainText(
      t('addin.connector.fromFile', { file: FILE, sheet: 'Commandes' }),
    );
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('onedrive.png') });
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

    // Someone raises the day to 400 € in OneDrive. Graph notifies the API, whose worker reads it.
    await putOrders(400);
    // The real invoice's; Mode test is on, so TEST-F2026-103 has the same finding.
    const finding = pane
      .getByTestId('finding')
      .filter({ hasText: 'C-77' })
      .filter({ hasText: 'La facture F2026-103' });
    await expect(async () => {
      await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
      await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
      await expect(finding).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(finding).toContainText(
      t('addin.checks.amount', { amount: frMoney(30_000, 'EUR') }),
    );
    await finding.getByRole('button', { name: t('addin.checks.see.order') }).click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.connector.inFile', { file: FILE, sheet: 'Commandes' }),
    );
    await finding.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('onedrive-checks.png') });

    // « Déconnecter OneDrive »: the file's documents and their findings leave.
    await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
    await section.getByRole('button', { name: t('addin.connector.disconnect') }).click();
    await section.getByRole('button', { name: t('addin.connector.disconnectYes') }).click();
    await expect(pane.getByTestId('notice')).toContainText(t('addin.connector.disconnected'));
    await expect(section.getByRole('button', { name: t('addin.connector.connect') })).toBeVisible();
    await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
    await expect(pane.getByTestId('finding').first()).toBeVisible();
    await expect(finding).toHaveCount(0);
  });

  await test.step('Google Drive: the same order in a Google Sheets file, changed there', async () => {
    const FILE = 'Commandes Google.xlsx';
    const google = `http://localhost:${E2E.mock}/google/control`;
    // Camille's Gmail Drive in the stand-in; `sheet=1` stores it as a Google Sheets spreadsheet,
    // which the API exports as .xlsx.
    const putOrders = async (price: number) => {
      const bytes = xlsxOf({
        Commandes: [
          ['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'],
          ['C-77', { date: 46296 }, 'Fleurs & Co', 'Formation Excel', 3, price],
        ],
      });
      const res = await fetch(
        `${google}/files/g-camille/gsheet-e2e?sheet=1&name=${encodeURIComponent(FILE)}`,
        { method: 'PUT', body: bytes },
      );
      expect(res.status).toBe(204);
    };
    await putOrders(300);
    // What the person does in Google's window: signs in as Camille and picks that file.
    const chose = await fetch(`${google}/choose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'g-camille', pick: ['gsheet-e2e'] }),
    });
    expect(chose.status).toBe(204);

    await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
    const section = pane.getByTestId('google');
    await section.scrollIntoViewIfNeeded();
    await section.getByRole('button', { name: t('addin.google.connect') }).click();
    // The harness has no Office browser window: the pane offers the link, as when Office blocks it.
    await expect(pane.getByTestId('notice')).toContainText(t('addin.google.openLink'));
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      section.getByRole('link', { name: t('addin.google.link') }).click(),
    ]);
    await expect(popup.locator('body')).toContainText(
      t('google.page.done', { count: 1, account: 'camille.martin@gmail.com' }),
    );
    await popup.screenshot({ path: info.outputPath('google-window.png') });
    await popup.close();
    // The pane polls while the window is open and sees the file arrive.
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.google.updated', { account: 'camille.martin@gmail.com' }),
      { timeout: 15_000 },
    );
    await section
      .getByTestId(`file-${FILE}`)
      .getByTestId('file-sheet-Commandes')
      .getByRole('button', { name: t('addin.registry.include') })
      .click();
    const inclusion = pane.getByTestId('inclusion');
    await expect(inclusion.getByLabel(t('layout.field.unitPrice'))).toHaveValue('F');
    await inclusion.getByRole('button', { name: t('addin.registry.confirm') }).click();
    await expect(pane.getByTestId('notice')).toContainText(
      t('addin.connector.included', { sheet: 'Commandes', file: FILE, docs: 1 }),
    );
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('google.png') });
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

    // Someone raises the day to 400 € in Google Sheets. Drive notifies the API, whose worker reads it.
    await putOrders(400);
    const finding = pane
      .getByTestId('finding')
      .filter({ hasText: 'C-77' })
      .filter({ hasText: 'La facture F2026-103' });
    await expect(async () => {
      await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
      await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
      await expect(finding).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(finding).toContainText(
      t('addin.checks.amount', { amount: frMoney(30_000, 'EUR') }),
    );
    await page.screenshot({ path: info.outputPath('google-checks.png') });

    // « Déconnecter Google Drive »: access revoked at Google, the file's documents and findings gone.
    await pane.getByRole('tab', { name: t('addin.nav.registry') }).click();
    await section.getByRole('button', { name: t('addin.google.disconnect') }).click();
    await section.getByRole('button', { name: t('addin.connector.disconnectYes') }).click();
    await expect(pane.getByTestId('notice')).toContainText(t('addin.google.disconnected'));
    await expect(section.getByRole('button', { name: t('addin.google.connect') })).toBeVisible();
    await pane.getByRole('tab', { name: t('addin.nav.checks') }).click();
    await expect(pane.getByTestId('finding').first()).toBeVisible();
    await expect(finding).toHaveCount(0);
  });
});
