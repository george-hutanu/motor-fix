import { expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seed's Service Auto Militari, its owner and its mechanic.
const OWNER = 'militari@example.test';
const MECHANIC = 'mecanic-militari@example.test';
const SLUG = 'service-auto-militari';

const title = (page: Page) => page.getByRole('heading', { level: 1 });
const language = (page: Page) =>
  page.getByRole('group', { name: /^(Limba|Language)$/ });
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
  // Romanian whatever an earlier run left saved on the shared account.
  await language(page).getByRole('button', { exact: true, name: 'RO' }).click();
}

const chips = (page: Page, list: string) =>
  page.locator(`${list} mf-lamp`).allTextContents();

// @traces 133-FR-005 133-FR-009 133-FR-015 133-SC-001 133-SC-002
test.describe('the garage profile view @seeded', () => {
  test('shows the owner what drivers see, with the phone kept to the dashboard', async ({
    page,
  }) => {
    await signedIn(page, OWNER);
    await page.goto('/app/garage/profile');

    await expect(title(page)).toHaveText('Profilul service‑ului');
    await expect(page.locator('[data-line="name"]')).toContainText(
      'Service Auto Militari',
    );
    await expect(page.locator('[data-phone-tag]')).toHaveText(
      'nu apare public',
    );
    const phone = (
      await page.locator('[data-line="phone"] [data-value]').textContent()
    )?.trim();
    expect(phone).toMatch(/^\+40\d{9}$/);
    const works = await chips(page, '[data-works]');
    const refuses = await chips(page, '[data-refuses]');
    expect(works.length).toBeGreaterThan(0);

    const link = page.locator('[data-public-link]');
    await expect(link).toHaveAttribute('href', `/ro/garages/${SLUG}`);
    await expect(link).toHaveAttribute('target', '_blank');
    const [profile] = await Promise.all([
      page.context().waitForEvent('page'),
      link.click(),
    ]);
    await profile.waitForLoadState();
    await expect(profile).toHaveURL(new RegExp(`/ro/garages/${SLUG}$`));
    await expect(profile.getByRole('heading', { level: 1 })).toHaveText(
      /Service Auto Militari/i,
    );
    expect(
      (await profile.locator('.works mf-lamp').allTextContents()).map((t) =>
        t.trim(),
      ),
    ).toEqual(works.map((t) => t.trim()));
    expect(
      (await profile.locator('.refuses mf-lamp').allTextContents()).map((t) =>
        t.trim(),
      ),
    ).toEqual(refuses.map((t) => t.trim()));
    const fuels = await page
      .locator('[data-works] [data-fuels]')
      .allTextContents();
    expect(
      (await profile.locator('.works .fuels').allTextContents()).map((t) =>
        t.trim(),
      ),
    ).toEqual(fuels.map((t) => t.trim()));
    // The offered facilities, and the hours, read the same on both pages.
    const offered = await page
      .locator('[data-facility]:not(.off) mf-lamp')
      .allTextContents();
    expect(
      (await profile.locator('.facilities .chip').allTextContents()).map((t) =>
        t.trim(),
      ),
    ).toEqual(offered.map((t) => t.trim()));
    const hours = (
      await page.locator('[data-line="hours"] .hours-line').allTextContents()
    ).map((t) => t.replace(/\s+/g, ' ').trim());
    const publicHours = await profile
      .locator('.days')
      .evaluateAll((days) =>
        days.map((d) =>
          `${d.textContent} ${d.nextElementSibling?.textContent ?? ''}`
            .replace(/\s+/g, ' ')
            .trim(),
        ),
      );
    expect(publicHours).toEqual(hours);
    expect(await profile.content()).not.toContain(phone?.slice(3) ?? '-');
  });

  test('fits a 320 px phone without sideways scroll', async ({ page }) => {
    await signedIn(page, OWNER);
    await page.setViewportSize({ height: 800, width: 320 });
    await page.goto('/app/garage/profile');

    await expect(page.locator('[data-line="name"]')).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  // @traces 133-FR-002
  test("keeps the view from the garage's mechanic", async ({ page }) => {
    await signedIn(page, MECHANIC);
    const menu = page.getByRole('navigation', { name: 'Meniu' });

    await expect(
      menu.getByRole('link', { name: 'Profilul service‑ului' }),
    ).toHaveCount(0);
    await page.goto('/app/garage/profile');
    await expect(page).toHaveURL('/app/garage');
  });
});
