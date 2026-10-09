import { expect, type Locator, type Page } from '@playwright/test';

import { hydrated, ownMap } from './accounts.js';
import { test } from './fixtures.js';

// The store checks the first bytes only.
const pdf = (name: string) => ({
  buffer: Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n'),
  mimeType: 'application/pdf',
  name,
});
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

const step = (page: Page) => page.locator('mf-documents-step');
const area = (page: Page, kind: string) =>
  step(page).locator(`.area[data-kind="${kind}"]`);
const certificate = (page: Page) => area(page, 'onrc_certificate');
const authorisation = (page: Page) => area(page, 'rar_authorisation');
const pages = (section: Locator) => section.locator('li.page');
const names = (section: Locator) =>
  pages(section).evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-name')),
  );
const keys = (section: Locator) =>
  pages(section).evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-key')),
  );
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
// Every button of the step is at least 44 px each way.
const smallTargets = (page: Page) =>
  step(page)
    .locator('button')
    .evaluateAll((buttons) =>
      buttons
        .map((b) => b.getBoundingClientRect())
        .filter((box) => box.width > 0 && (box.width < 44 || box.height < 44))
        .map((box) => `${box.width}x${box.height}`),
    );

const localDate = (daysBefore: number) => {
  const at = new Date();
  at.setDate(at.getDate() - daysBefore);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

// On a phone the steps sit behind the bar; open it first.
async function toStep6(page: Page, nav: 'Pași' | 'Steps') {
  const bar = page.locator('nav > button[aria-expanded]');
  if (await bar.isVisible()) await bar.click();
  await page
    .getByRole('navigation', { name: nav })
    .getByRole('button', { name: /^6 / })
    .click();
}

async function toDocuments(page: Page, email: string) {
  await hydrated(page, '/ro/list-your-garage');
  await page.getByLabel('E‑mail').fill(email);
  await page.getByLabel('E‑mail').blur();
  await toStep6(page, 'Pași');
  // The pickers open once the draft exists on the server.
  await expect(
    certificate(page).getByRole('button', { name: 'Alege fișiere' }),
  ).toBeEnabled();
}

test.describe('step 6 of list your garage, the documents', () => {
  test.beforeEach(({ context }) => ownMap(context));

  // @traces 206-documents-declaration-FR-001
  // @traces 206-documents-declaration-FR-008
  // @traces 206-documents-declaration-FR-015
  // @traces 206-documents-declaration-FR-017
  for (const [size, width, height] of SIZES) {
    test(`on ${size}: a PDF certificate with its date and two authorisation photos, reordered, one removed, kept after a reload`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize({ height, width });
      const email = `documents-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
      await toDocuments(page, email);

      await certificate(page)
        .locator('input[type="file"]')
        .setInputFiles([pdf('certificat.pdf')]);
      await expect(pages(certificate(page))).toHaveCount(1);
      await expect(pages(certificate(page)).first()).toContainText('Pagina 1');
      await expect(pages(certificate(page)).first()).toHaveAttribute(
        'data-key',
        /^legal_document\//,
      );

      const date = step(page).getByLabel('Data emiterii certificatului');
      await date.fill(localDate(2));
      await date.blur();
      await expect(step(page)).not.toContainText(
        'Certificatul trebuie să fie emis în ultimele 30 de zile',
      );

      await authorisation(page)
        .locator('input[type="file"]')
        .setInputFiles([jpeg('fata.jpg'), jpeg('verso.jpg')]);
      await expect(pages(authorisation(page))).toHaveCount(2);
      await expect
        .poll(() => keys(authorisation(page)))
        .toEqual([
          expect.stringMatching(/^legal_document\//),
          expect.stringMatching(/^legal_document\//),
        ]);
      expect(await names(authorisation(page))).toEqual([
        'fata.jpg',
        'verso.jpg',
      ]);

      await authorisation(page)
        .getByRole('button', { name: 'Mută înainte pagina 2' })
        .click();
      await expect
        .poll(() => names(authorisation(page)))
        .toEqual(['verso.jpg', 'fata.jpg']);
      const order = await keys(authorisation(page));

      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await smallTargets(page)).toEqual([]);

      const removed = page.waitForResponse(
        (res) =>
          res.request().method() === 'DELETE' &&
          /\/listing-drafts\/[^/]+\/documents\/rar_authorisation\//.test(
            res.url(),
          ),
      );
      await pages(authorisation(page))
        .nth(1)
        .getByRole('button', { name: /Șterge/ })
        .click();
      expect((await removed).ok()).toBe(true);
      await expect(pages(authorisation(page))).toHaveCount(1);

      const saved = page.waitForResponse(
        (res) =>
          res.request().method() === 'PATCH' &&
          /\/listing-drafts\/[^/?]+$/.test(new URL(res.url()).pathname) &&
          res.ok(),
      );
      await page.getByRole('button', { name: 'Salvează ciorna' }).click();
      await saved;

      await page.reload();
      await hydrated(page);
      await expect(pages(authorisation(page))).toHaveCount(1);
      expect(await keys(authorisation(page))).toEqual([order[0]]);
      await expect(pages(certificate(page))).toHaveCount(1);
      await expect(
        step(page).getByLabel('Data emiterii certificatului'),
      ).toHaveValue(localDate(2));
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`at 320 px in English, ${scheme}: the step fits the width and speaks English`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 640, width: 320 });
      await page.emulateMedia({ colorScheme: scheme });
      await hydrated(page, '/en/list-your-garage');
      await toStep6(page, 'Steps');

      await expect(certificate(page)).toContainText('ONRC company certificate');
      await expect(authorisation(page)).toContainText(
        'RAR technical authorisation',
      );
      await expect(certificate(page)).toContainText(
        'Add an e-mail at step 1 to upload documents',
      );
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});
