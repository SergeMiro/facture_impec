// M4 acceptance (plan §11): one invoice goes from the sheet to B2Brouter's sandbox, and its status
// comes back to FI_Statut without a click, the fiche closed. By default against B2Brouter's stand-in
// in apps/mock-pdp (the real adapter, webhooks included); with FI_E2E_B2BROUTER_* against the real
// sandbox (docs/RUNBOOK.md § E2E), where the sweep brings the news.
// browser: local (Chrome of this server; Browserbase cannot reach localhost).
import { type MessageKey, t } from '@fi/shared';
import { expect, test } from '@playwright/test';
import { seedDemo } from '../src/harness/seed';
import { E2E, LIVE } from './env';
import { api, row, signIn, typeInCell } from './helpers';

const mock = `http://localhost:${E2E.mock}`;
/** Its own owner: an e-mail address signs in to the first company that has it. */
const OWNER = 'gerant-b2brouter@atelier-dupont.test';
const control = (path: string, init: RequestInit = {}) =>
  fetch(`${mock}/control${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
  });

const testLabel = (status: string) =>
  t('addin.sheet.testLabel', { label: t(`invoice.status.${status}` as MessageKey) });
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.afterEach(async () => {
  if (!LIVE) await control('/reset', { method: 'POST' });
});

test('an invoice goes to B2Brouter and its status comes back to the sheet by itself', async ({
  page,
  context,
}, info) => {
  console.log(`platform: ${LIVE ? 'B2Brouter sandbox (live)' : 'B2Brouter stand-in'}`);
  if (!LIVE) {
    // A platform in a hurry: registered, made available, accepted within ten seconds.
    const timeline = [
      { status: 'received_by_platform', after: 'PT2S' },
      { status: 'delivered', after: 'PT3S' },
      { status: 'accepted', after: 'PT3S' },
    ];
    expect((await control('', { method: 'PUT', body: JSON.stringify({ timeline }) })).ok).toBe(
      true,
    );
  }
  await seedDemo({
    api,
    adminToken: E2E.adminToken,
    email: OWNER,
    provider: 'b2brouter',
    account: LIVE?.account ?? String(Date.now()).slice(-9),
  });
  // A number the platform has never seen: the sandbox keeps every number it was sent.
  const number = `E2E-${String(Date.now()).slice(-8)}`;
  await page.goto('/harness.html');
  const pane = page.getByTestId('pane');

  await test.step('Connexion and columns', async () => {
    await signIn(pane, context, OWNER);
    await pane.getByRole('button', { name: t('addin.detect.confirm') }).click();
    await expect(page.getByTestId('cell-M1')).toHaveText('FI_Statut');
  });

  await test.step('Mode test, a new number (and a customer the sandbox knows)', async () => {
    await page.getByTestId('ribbon-modetest').click();
    await expect(pane.getByTestId('test-banner')).toHaveText(t('banner.testMode'));
    await typeInCell(page, 'A2', number);
    if (LIVE) await typeInCell(page, 'E2', LIVE.buyerSiren);
    await expect(row(pane, `TEST-${number}`)).toBeVisible();
  });

  const sent = await test.step('Envoyer en test, then back to the list', async () => {
    await row(pane, `TEST-${number}`)
      .getByRole('button', { name: t('addin.dash.view') })
      .click();
    await pane.getByRole('button', { name: t('addin.invoice.sendTest') }).click();
    await pane
      .getByTestId('confirm-send')
      .getByRole('button', { name: t('addin.invoice.confirm') })
      .click();
    await expect(pane.getByText(t('addin.send.done', { number: `TEST-${number}` }))).toBeVisible();
    // The fiche follows its own invoice: closed, only the sheet's watch is left.
    await pane.getByRole('button', { name: t('addin.invoice.back') }).click();
    await expect(pane.getByTestId('counts')).toBeVisible();
    return Date.now();
  });

  await test.step('FI_Statut changes with nobody clicking', async () => {
    const cell = page.getByTestId('cell-M2');
    if (LIVE) {
      // What the sandbox does after « sent » is not known yet (docs/B2BROUTER.md §11 T20).
      const left = ['deposited', 'delivered', 'accepted', 'rejected_by_pdp', 'refused', 'paid'];
      await expect(cell).toHaveText(new RegExp(left.map((s) => literal(testLabel(s))).join('|')), {
        timeout: 150_000,
      });
    } else {
      await expect(cell).toHaveText(testLabel('accepted'), { timeout: 150_000 });
    }
    console.log(
      `FI_Statut: « ${await cell.textContent()} » ${Math.round((Date.now() - sent) / 1000)} s after the send`,
    );
    await page.screenshot({ path: info.outputPath('sheet.png') });
  });
});
