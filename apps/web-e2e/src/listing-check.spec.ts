import { expect, type Page } from '@playwright/test';

import { ownMap, ready } from './accounts.js';
import { test } from './fixtures.js';
import { JOBS, jpeg, KEPT } from './listing-kept.js';

// The place step's map draws the app's empty style.
test.beforeEach(({ context }) => ownMap(context));

const send = (page: Page) =>
  page.getByRole('button', { name: 'Trimite spre verificare' });
const summary = (page: Page) => page.locator('mf-missing-summary .summary');
const title = (page: Page) => summary(page).locator('h2');
const item = (page: Page, name: RegExp) =>
  summary(page).getByRole('button', { name });
const cui = (page: Page) => page.locator('#listing-cui');

const prices = (page: Page) => page.locator('mf-prices-step');
const photos = (page: Page) => page.locator('mf-photos-step');

async function range(page: Page, name: string, from: string, to: string) {
  await prices(page)
    .getByRole('textbox', { exact: true, name: `${name}, de la` })
    .fill(from);
  await prices(page)
    .getByRole('textbox', { exact: true, name: `${name}, până la` })
    .fill(to);
}

const count = async (page: Page) =>
  Number((await title(page).textContent())?.match(/\d+/)?.[0]);

const sideways = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

test.describe('list your garage, what is missing before sending', () => {
  for (const width of [320, 390]) {
    // @traces 115-FR-008 115-FR-013
    test(`at ${width} px: the press lists what is missing, an item goes to its field, and the list shrinks as it is fixed`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 740, width });
      await ready(page, '/ro/list-your-garage');
      await expect(summary(page)).toHaveText('');

      await send(page).click();

      await expect(title(page)).toHaveText(/^Mai lipsesc: \d+ (de )?lucruri$/);
      await expect(summary(page)).toBeFocused();
      await expect(
        page.locator('nav ol li').first().locator('.dot'),
      ).toHaveCount(1);
      const before = await count(page);
      expect(await sideways(page)).toBe(false);

      const target = item(page, /Scrie CUI.ul firmei/);
      const box = await target.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await target.click();
      await expect(cui(page)).toBeFocused();
      await expect(cui(page)).toBeInViewport();
      await expect(cui(page)).toHaveAttribute('aria-invalid', 'true');

      await cui(page).fill('18547290');
      await expect(item(page, /Scrie CUI.ul firmei/)).toHaveCount(0);
      expect(await count(page)).toBe(before - 1);
      await expect(cui(page)).not.toHaveAttribute('aria-invalid', 'true');
      expect(await sideways(page)).toBe(false);
    });
  }

  // @traces 115-FR-008 115-FR-012
  test('in English, then switched to Romanian, the summary and the field messages stay shown', async ({
    page,
  }) => {
    await ready(page, '/en/list-your-garage');
    await page
      .getByRole('button', { exact: true, name: 'Send for review' })
      .click();

    await expect(title(page)).toHaveText(/^Still missing: \d+ things$/);
    await expect(item(page, /Write the company's CUI/)).toBeVisible();
    await expect(cui(page)).toHaveAttribute('aria-invalid', 'true');
    const before = await count(page);

    // A click that does not scroll, as the language switch spec does.
    await page
      .getByRole('group', { name: 'Language' })
      .getByRole('button', { name: 'RO' })
      .dispatchEvent('click');

    await expect(page).toHaveURL(/\/ro\/list-your-garage/);
    await expect(title(page)).toHaveText(/^Mai lipsesc: \d+ (de )?lucruri$/);
    expect(await count(page)).toBe(before);
    await expect(item(page, /Scrie CUI.ul firmei/)).toBeVisible();
    await expect(cui(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(send(page)).toBeVisible();
  });

  // @traces 115-FR-011
  test('nothing typed is cleared by the press', async ({ page }) => {
    await ready(page, '/ro/list-your-garage');
    const name = page.locator('mf-details-step [name="name"]');
    await name.fill('S');

    await send(page).click();

    await expect(title(page)).toBeVisible();
    await expect(name).toHaveValue('S');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
  });

  // @traces 115-FR-009 115-FR-010 115-FR-013 115-FR-015
  test('at 390 px: a listing fixed through its summary is complete, its missing documents only told', async ({
    context,
    page,
  }) => {
    // An upload and two server checks on a CI runner with four workers.
    test.slow();
    await context.addInitScript((copy) => {
      if (sessionStorage.getItem('kept')) return;
      localStorage.setItem('mf.listing-draft', copy);
      sessionStorage.setItem('kept', '1');
    }, JSON.stringify(KEPT));
    await page.setViewportSize({ height: 844, width: 390 });
    await ready(page, '/ro/list-your-garage');
    const email = `check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    await page.getByLabel('E‑mail').fill(email);
    await page.getByLabel('E‑mail').blur();
    // The photo picker opens once the draft exists on the server.
    await expect(
      photos(page).getByRole('button', { name: 'Alege fotografii' }),
    ).toBeEnabled();

    await send(page).click();
    await expect(title(page)).toHaveText(/^Mai lipsesc: \d+ lucruri$/);

    await item(page, /Alege cel puțin o marcă/).click();
    await page
      .locator('mf-brands-step .chips button', { hasText: 'Dacia' })
      .first()
      .click();
    await range(page, 'Manoperă, pe oră', '120', '200');
    for (const [job, from, to] of JOBS) await range(page, job, from, to);
    await item(page, /Adaugă cel puțin o fotografie/).click();
    await photos(page)
      .locator('input[type="file"]')
      .setInputFiles([jpeg('fata.jpg')]);
    await expect(photos(page).locator('li.photo')).toHaveCount(1);
    await expect(photos(page).locator('li.photo').first()).toHaveAttribute(
      'data-key',
      /garage_photo\//,
    );
    // The last missing thing typed, the list is gone.
    await expect(summary(page).getByRole('button')).toHaveCount(0);

    const checked = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        /\/listing-drafts\/[^/]+\/check$/.test(new URL(res.url()).pathname),
    );
    await send(page).click();
    const answer = await checked;
    expect(answer.status()).toBe(200);
    const { warnings } = (await answer.json()) as {
      warnings: { code: string }[];
    };
    expect(warnings.map((w) => w.code)).toContain('document_missing');

    await expect(summary(page)).toHaveText('Totul e complet');
    await expect(send(page)).toBeFocused();
    expect(await sideways(page)).toBe(false);
  });
});
