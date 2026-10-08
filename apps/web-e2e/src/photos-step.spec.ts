import { expect, type Page } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

const MAILBOX = 'http://127.0.0.1:3025';
const DRAFT_LINK =
  /https?:\/\/[^\s"<>]+\/(ro|en)\/list-your-garage\?draft=[A-Za-z0-9_-]{43}/;

// The store checks the first bytes only; the worker may still be processing.
const jpeg = (name: string) => ({
  buffer: Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]),
  mimeType: 'image/jpeg',
  name,
});

const SIZES = [
  ['a 320 px phone', 320, 640],
  ['a 390 px phone', 390, 844],
  ['a tablet', 820, 1180],
  ['a desktop', 1280, 800],
] as const;

const step = (page: Page) => page.locator('mf-photos-step');
const tiles = (page: Page) => step(page).locator('li.photo');
const names = (page: Page) =>
  tiles(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-name')),
  );

async function draftLink(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/messages?to=${encodeURIComponent(email)}`,
        );
        const sent: { textContent: string }[] = await res.json();
        link = sent
          .map((m) => DRAFT_LINK.exec(m.textContent)?.[0])
          .filter(Boolean)
          .at(-1);
        return link;
      },
      { message: 'no draft link e-mail sent', timeout: 20_000 },
    )
    .toBeDefined();
  const url = new URL(String(link));
  return url.pathname + url.search;
}

async function toPhotos(page: Page, email: string) {
  await ready(page, '/ro/list-your-garage');
  await page.getByLabel('E‑mail').fill(email);
  await page.getByLabel('E‑mail').blur();
  await page
    .getByRole('navigation', { name: 'Pași' })
    .getByRole('button', { name: /^5 / })
    .click();
  await expect(step(page).getByText('Alege fotografii')).toBeVisible();
}

const confirmedCount = (page: Page, count: number) =>
  expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).reduce(
          (most, key) =>
            Math.max(
              most,
              (localStorage.getItem(key) ?? '').match(/garage_photo\//g)
                ?.length ?? 0,
            ),
          0,
        ),
      ),
    )
    .toBe(count);

test.describe('step 5 of list your garage, the photos @mailbox', () => {
  for (const [size, width, height] of SIZES) {
    test(`on ${size}: three photos uploaded, the last moved first, kept after a reload and on the link, one removed`, async ({
      browser,
      page,
    }) => {
      await page.setViewportSize({ height, width });
      const email = `photos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
      await toPhotos(page, email);

      await step(page)
        .locator('input[type="file"]')
        .setInputFiles([jpeg('unu.jpg'), jpeg('doi.jpg'), jpeg('trei.jpg')]);
      await expect(tiles(page)).toHaveCount(3);
      await confirmedCount(page, 3);
      expect(await names(page)).toEqual(['unu.jpg', 'doi.jpg', 'trei.jpg']);

      const last = tiles(page).nth(2);
      await last.getByRole('button', { name: /Mută înainte/ }).click();
      await tiles(page)
        .nth(1)
        .getByRole('button', { name: /Mută înainte/ })
        .click();
      await expect(tiles(page).first()).toContainText('Copertă');
      const order = await names(page);
      expect(order).toEqual(['trei.jpg', 'unu.jpg', 'doi.jpg']);
      await page.getByRole('button', { name: 'Salvează ciorna' }).click();

      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(tiles(page)).toHaveCount(3);
      const keys = await tiles(page).evaluateAll((items) =>
        items.map((item) => item.getAttribute('data-key')),
      );

      const other = await browser.newContext();
      try {
        const phone = await other.newPage();
        await ready(phone, await draftLink(page, email));
        await phone
          .getByRole('navigation', { name: 'Pași' })
          .getByRole('button', { name: /^5 / })
          .click();
        await expect(tiles(phone)).toHaveCount(3);
        expect(
          await tiles(phone).evaluateAll((items) =>
            items.map((item) => item.getAttribute('data-key')),
          ),
        ).toEqual(keys);
      } finally {
        await other.close();
      }

      await tiles(page)
        .nth(1)
        .getByRole('button', { name: /Șterge/ })
        .click();
      await expect(tiles(page)).toHaveCount(2);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(tiles(page)).toHaveCount(2);
      expect(
        await tiles(page).evaluateAll((items) =>
          items.map((item) => item.getAttribute('data-key')),
        ),
      ).toEqual([keys[0], keys[2]]);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`at 320 px in English, ${scheme}: the step fits the width and speaks English`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 640, width: 320 });
      await page.emulateMedia({ colorScheme: scheme });
      await ready(page, '/en/list-your-garage');
      await page
        .getByRole('navigation', { name: 'Steps' })
        .getByRole('button', { name: /^5 / })
        .click();

      await expect(step(page)).toContainText(
        'Add an e-mail at step 1 to upload photos',
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
});
