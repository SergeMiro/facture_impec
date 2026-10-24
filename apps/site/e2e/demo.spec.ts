import { expect, test } from '@playwright/test';

// browser: local. These tests execute only this repository's marketing site.
test('film autoplays, seeks, pauses offscreen and preserves a manual pause', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const video = page.getByTestId('product-video');
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => !node.paused && node.currentTime > 0))
    .toBe(true);
  expect(
    await video.evaluate((node: HTMLVideoElement) => ({
      muted: node.muted,
      inline: node.playsInline,
      duration: node.duration,
    })),
  ).toMatchObject({ muted: true, inline: true });
  await page.getByRole('button', { name: '4. L’envoi', exact: true }).click();
  await expect(page.getByTestId('film-caption')).toContainText('Factur-X');
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
    .toBeGreaterThanOrEqual(17);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(350);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  expect(await video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await page.getByRole('button', { name: 'Revoir la démonstration', exact: true }).click();
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => !node.paused && node.currentTime < 4))
    .toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '/tmp/facture-impec-site-desktop.png' });
});

test('reduced motion requires an explicit play decision', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const video = page.getByTestId('product-video');
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
    .toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(
    await video.evaluate((node: HTMLVideoElement) => node.paused && node.currentTime < 0.1),
  ).toBe(true);
  await page.getByRole('button', { name: 'Lire la démonstration', exact: true }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => !node.paused)).toBe(true);
});

test('phone uses the portrait film and starts without scrolling', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4333/');
  const video = page.getByTestId('product-video');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(960);
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => !node.paused && node.currentTime > 0))
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const bounds = await video.boundingBox();
  expect(bounds?.y).toBeLessThan(500);
  await page.screenshot({ path: '/tmp/facture-impec-site-mobile.png' });
  await context.close();
});

test('a failed video leaves the transcript and interactive demo available', async ({ page }) => {
  await page.route('**/demo/*.mp4', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('film-caption')).toContainText('Le film ne s’est pas chargé');
  await page.getByText('Lire le parcours', { exact: true }).click();
  await expect(page.locator('.auto-demo-transcript')).toContainText('1 200 € HT');
  await expect(page.locator('.auto-demo-controls a')).toHaveAttribute('href', '#demo');
});
