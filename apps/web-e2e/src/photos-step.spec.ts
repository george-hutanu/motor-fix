import { expect, type Page } from '@playwright/test';

import { hydrated, ownMap } from './accounts.js';
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
const keys = (page: Page) =>
  tiles(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-key')),
  );

// The draft's server copy, once it holds these photo keys in this order.
const savedWith = (page: Page, files: (string | null)[]) =>
  page.waitForResponse((res) => {
    if (
      res.request().method() !== 'PATCH' ||
      !/\/listing-drafts\/[^/?]+$/.test(new URL(res.url()).pathname)
    )
      return false;
    const sent = res.request().postDataJSON() as {
      data?: { files?: string[] };
    };
    return res.ok() && sent.data?.files?.join() === files.join();
  });

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

// On a phone the steps sit behind the bar; open it first.
async function toStep5(page: Page, nav: 'Pași' | 'Steps') {
  const bar = page.locator('nav > button[aria-expanded]');
  if (await bar.isVisible()) await bar.click();
  await page
    .getByRole('navigation', { name: nav })
    .getByRole('button', { name: /^5 / })
    .click();
}

async function toPhotos(page: Page, email: string) {
  await hydrated(page, '/ro/list-your-garage');
  await page.getByLabel('E‑mail').fill(email);
  await page.getByLabel('E‑mail').blur();
  await toStep5(page, 'Pași');
  // The picker opens once the draft exists on the server; files set before
  // then wait for a connection that is already there.
  await expect(
    step(page).getByRole('button', { name: 'Alege fotografii' }),
  ).toBeEnabled();
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
  test.beforeEach(({ context }) => ownMap(context));

  // @traces 948-FR-001 948-FR-002 948-FR-003 948-FR-004
  for (const [size, width, height] of SIZES) {
    test(`on ${size}: three photos uploaded, the last moved first, kept after a reload and on the link, one removed`, async ({
      browser,
      page,
    }) => {
      // Two reloads, a second browser and the mailbox: on a CI runner with
      // four workers each step takes seconds (fill 2.8 s in run
      // 37734125105's trace), and the flow ran past 30 s while still correct.
      // Its retries then used up the 10 drafts an hour per address.
      // No wait here is for a quiet network: a page holding a live stream
      // never gets one (runs 37814121036 and 37848562526).
      test.slow();
      await page.setViewportSize({ height, width });
      const email = `photos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
      await toPhotos(page, email);

      await step(page)
        .locator('input[type="file"]')
        .setInputFiles([jpeg('unu.jpg'), jpeg('doi.jpg'), jpeg('trei.jpg')]);
      await expect(tiles(page)).toHaveCount(3);
      await confirmedCount(page, 3);
      expect(await names(page)).toEqual(['unu.jpg', 'doi.jpg', 'trei.jpg']);

      await step(page)
        .getByRole('button', { name: 'Mută înainte fotografia 3' })
        .click();
      await expect
        .poll(() => names(page))
        .toEqual(['unu.jpg', 'trei.jpg', 'doi.jpg']);
      await step(page)
        .getByRole('button', { name: 'Mută înainte fotografia 2' })
        .click();
      await expect
        .poll(() => names(page))
        .toEqual(['trei.jpg', 'unu.jpg', 'doi.jpg']);
      await expect(tiles(page).first()).toContainText('Copertă');
      const order = await keys(page);
      expect(order).not.toContain(null);
      // The other browser reads the server copy: it must hold the new order.
      const saved = savedWith(page, order);
      await page.getByRole('button', { name: 'Salvează ciorna' }).click();
      await saved;

      await page.reload();
      await hydrated(page);
      await expect(tiles(page)).toHaveCount(3);
      expect(await keys(page)).toEqual(order);

      const other = await browser.newContext();
      await ownMap(other);
      try {
        const phone = await other.newPage();
        await hydrated(phone, await draftLink(page, email));
        await toStep5(phone, 'Pași');
        await expect(tiles(phone)).toHaveCount(3);
        expect(await keys(phone)).toEqual(order);
      } finally {
        await other.close();
      }

      // A reload that aborts the delete would leave the photo on the server.
      const removed = page.waitForResponse(
        (res) =>
          res.request().method() === 'DELETE' &&
          /\/listing-drafts\/[^/]+\/photos\//.test(res.url()),
      );
      await tiles(page)
        .nth(1)
        .getByRole('button', { name: /Șterge/ })
        .click();
      expect((await removed).ok()).toBe(true);
      await expect(tiles(page)).toHaveCount(2);
      await page.reload();
      await hydrated(page);
      await expect(tiles(page)).toHaveCount(2);
      expect(await keys(page)).toEqual([order[0], order[2]]);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`at 320 px in English, ${scheme}: the step fits the width and speaks English`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 640, width: 320 });
      await page.emulateMedia({ colorScheme: scheme });
      await hydrated(page, '/en/list-your-garage');
      await toStep5(page, 'Steps');

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
