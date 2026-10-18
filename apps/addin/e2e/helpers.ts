// What the harness specs share: the e-mailed sign-in link, typing in a cell, a row of the pane.
import { t } from '@fi/shared';
import { type BrowserContext, expect, type Locator, type Page } from '@playwright/test';
import { E2E } from './env';

export const api = `http://localhost:${E2E.api}`;

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

/** Signs the pane in as a new user does: e-mail, then the link opened in another tab. */
export async function signIn(pane: Locator, context: BrowserContext, email: string) {
  await pane.getByLabel(t('addin.login.email')).fill(email);
  await pane.getByRole('button', { name: t('addin.login.sendLink') }).click();
  await expect(pane.getByTestId('link-waiting')).toBeVisible();
  const mail = await context.newPage();
  await mail.goto(await linkFor(email));
  await mail.getByRole('button', { name: t('login.page.button') }).click();
  await expect(mail.getByText(t('login.page.done'))).toBeVisible();
  await mail.close();
}

/** Types into a cell the way a user does: select it, type in the formula bar, press Enter. */
export async function typeInSelectedCell(page: Page, cell: string, text: string) {
  await expect(page.getByTestId('name-box')).toHaveText(cell);
  const bar = page.getByTestId('formula-bar');
  await bar.fill(text);
  await bar.press('Enter');
}

/** Clicks a cell, then types into it. */
export async function typeInCell(page: Page, cell: string, text: string) {
  await page.getByTestId(`cell-${cell}`).click();
  await typeInSelectedCell(page, cell, text);
}

export const row = (pane: Locator, number: string) =>
  pane.locator('[data-testid^="row-"]').filter({ hasText: number });
