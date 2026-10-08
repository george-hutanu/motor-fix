import { expect, type Page, test } from '@playwright/test';

import { ready } from './accounts.js';

const picker = (page: Page) =>
  page.getByRole('radiogroup', { name: 'Marca mașinii' });
const tile = (page: Page, name: string) =>
  picker(page).getByRole('radio', { exact: true, name });
const homeReads = (page: Page) => {
  const brands: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/home') {
      brands.push(url.searchParams.get('brand') ?? '');
    }
  });
  return brands;
};

test('the server sends eight brand tiles, the first one selected', async ({
  request,
}) => {
  const html = await (await request.get('/ro')).text();

  expect(html.match(/role="radio"/g)).toHaveLength(8);
  expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  expect(html).not.toMatch(/public\.[a-z]/);
});

test.describe('the brand picker @seeded', () => {
  test('counts the garages that take Dacia after one read, in both languages', async ({
    page,
  }) => {
    const reads = homeReads(page);
    await ready(page, '/ro');
    reads.length = 0;

    await tile(page, 'Dacia').click();

    await expect(
      page.getByText('3 din 6 service‑uri primesc Dacia'),
    ).toBeVisible();
    await expect(page.getByText('Service‑uri pentru Dacia')).toBeVisible();
    expect(reads).toEqual(['dacia']);

    await page.getByRole('button', { exact: true, name: 'EN' }).click();

    await expect(page.getByText('3 of 6 garages take Dacia')).toBeVisible();
    await expect(
      page
        .getByRole('radiogroup', { name: 'Car brand' })
        .getByRole('radio', { checked: true }),
    ).toHaveText('Dacia');
  });

  test('opens the results for the chosen brand', async ({ page }) => {
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();

    await page.getByRole('link', { name: 'Caută service‑uri' }).click();

    await expect(page).toHaveURL('/ro/garages?brand=dacia');
  });

  test('moves to the next brand within 5.5 s, and stays put after a tap', async ({
    page,
  }) => {
    await ready(page, '/ro');
    const second = picker(page).getByRole('radio').nth(1);

    await expect(second).toHaveAttribute('aria-checked', 'true', {
      timeout: 5500,
    });

    await tile(page, 'Dacia').click();
    await page.waitForTimeout(12_000);
    await expect(tile(page, 'Dacia')).toHaveAttribute('aria-checked', 'true');
  });

  test('says when the count could not load, and tries again', async ({
    page,
  }) => {
    let fail = true;
    await page.route('**/api/v1/home?*', (route) =>
      fail ? route.fulfill({ status: 503 }) : route.continue(),
    );
    await ready(page, '/ro');

    await tile(page, 'Dacia').click();
    await expect(
      page.getByText('Nu am putut încărca service‑urile'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Caută service‑uri' }),
    ).toHaveAttribute('href', '/ro/garages?brand=dacia');

    fail = false;
    await page.getByRole('button', { name: 'Reîncearcă' }).click();

    await expect(
      page.getByText('3 din 6 service‑uri primesc Dacia'),
    ).toBeVisible();
  });
});

test.describe('the brand picker with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('stays on the first brand', async ({ page }) => {
    await ready(page, '/ro');

    await page.waitForTimeout(11_000);

    await expect(picker(page).getByRole('radio').first()).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

for (const scheme of ['light', 'dark'] as const) {
  for (const path of ['/ro', '/en']) {
    test(`fits a 320 px phone in two columns on ${path}, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 640, width: 320 });
      await ready(page, path);

      const boxes = await page
        .getByRole('radiogroup')
        .getByRole('radio')
        .evaluateAll((tiles) =>
          tiles.map((t) => {
            const box = t.getBoundingClientRect();
            return { height: box.height, left: Math.round(box.left) };
          }),
        );
      expect(new Set(boxes.map((b) => b.left)).size).toBe(2);
      for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320);
    });
  }
}
