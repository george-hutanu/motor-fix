import { expect, type Page, test } from '@playwright/test';

import { signInAs } from './sign-in.js';

const bar = (page: Page) =>
  page.getByRole('navigation', { name: 'Navigare principală' });

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test.describe('the public tab bar on a 375 px phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ height: 812, width: 375 });
  });

  test('takes a visitor from Home to each section in one tap', async ({
    page,
  }) => {
    for (const [tab, address] of [
      ['Service-uri', '/ro/garages'],
      ['Cont', '/ro/account'],
      ['Caută', '/ro'],
    ]) {
      await open(page, '/ro');
      await bar(page).getByRole('link', { name: tab }).click();
      await expect(page).toHaveURL(address);
      await expect(bar(page).getByRole('link', { name: tab })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  test('opens the dashboard of a signed-in person from Cont', async ({
    page,
  }) => {
    await signInAs(page, 'driver', '/app/driver');
    await open(page, '/ro');

    await bar(page).getByRole('link', { name: 'Cont' }).click();

    await expect(page).toHaveURL('/app/driver');
  });

  test('sits at the bottom of a short page and above the end of a long one', async ({
    page,
  }) => {
    await open(page, '/ro');
    const box = await bar(page).boundingBox();
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(812);

    await page.evaluate(() => {
      const filler = document.createElement('p');
      filler.id = 'end';
      filler.textContent = 'end';
      filler.style.marginTop = '2000px';
      document.querySelector('mf-home')?.append(filler);
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const end = await page.locator('#end').boundingBox();
    const top = (await bar(page).boundingBox())?.y ?? 0;
    expect((end?.y ?? 0) + (end?.height ?? 0)).toBeLessThanOrEqual(top);
  });

  test('is announced and works from the keyboard', async ({ page }) => {
    await open(page, '/ro');
    const links = bar(page).getByRole('link');

    await expect(links).toHaveText(['Caută', 'Service-uri', 'Cont']);
    await expect(links.first()).toHaveAttribute('aria-current', 'page');
    await expect(links.nth(1)).not.toHaveAttribute('aria-current');

    await links.first().focus();
    await page.keyboard.press('Tab');
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(links.nth(2)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/ro/account');
  });

  test('reads English at /en', async ({ page }) => {
    await open(page, '/en');

    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link'),
    ).toHaveText(['Search', 'Garages', 'Account']);
  });

  test('hides while a text field has focus', async ({ page }) => {
    await open(page, '/ro');
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.id = 'field';
      document.querySelector('mf-home')?.append(field);
    });

    await page.locator('#field').focus();
    await expect(bar(page)).toBeHidden();
    await page.locator('#field').blur();
    await expect(bar(page)).toBeVisible();
  });
});

test.describe('the public tab bar at 320 px', () => {
  for (const path of ['/ro', '/ro/garages', '/ro/account', '/en']) {
    test(`fits ${path} with 44 px tabs and 12 px labels`, async ({ page }) => {
      await page.setViewportSize({ height: 640, width: 320 });
      await open(page, path);

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320);
      const tabs = page.locator('mf-public-tab-bar').getByRole('link');
      await expect(tabs).toHaveCount(3);
      for (const tab of await tabs.all()) {
        expect((await tab.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
          44,
        );
        const size = await tab.evaluate((el) =>
          Number.parseFloat(getComputedStyle(el).fontSize),
        );
        expect(size).toBeGreaterThanOrEqual(12);
      }
    });
  }
});

test.describe('the public tab bar on a tablet and a desktop', () => {
  for (const width of [768, 1024]) {
    for (const path of ['/ro', '/ro/garages']) {
      test(`is hidden on ${path} at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ height: 900, width });
        await open(page, path);

        await expect(page.locator('mf-public-tab-bar')).toBeAttached();
        await expect(page.locator('mf-public-tab-bar')).toBeHidden();
      });
    }
  }
});
