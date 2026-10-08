import { expect, type Locator, type Page } from '@playwright/test';

import { test } from './fixtures.js';

const preview = (page: Page) => page.locator('mf-garage-preview');
const details = (page: Page) => page.locator('mf-details-step');
const chip = (page: Page, name: string) =>
  page.locator('mf-brands-step .chips button', { hasText: name });
const prices = (page: Page) => page.locator('mf-prices-step');
const mechanics = (page: Page) => page.locator('mf-mechanics-step');

async function open(page: Page, path = '/ro/list-your-garage') {
  await page.goto(path);
  // A field typed in before hydration is wiped when the client takes over.
  await expect(chip(page, 'BMW')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function labour(scope: Locator, from: string, to: string) {
  await scope
    .getByRole('textbox', { exact: true, name: 'Manoperă, pe oră, de la' })
    .fill(from);
  await scope
    .getByRole('textbox', { exact: true, name: 'Manoperă, pe oră, până la' })
    .fill(to);
}

async function fill(page: Page, name: string) {
  await details(page).locator('[name="name"]').fill(name);
  await details(page).locator('[name="phone"]').fill('0722 123 456');
  await labour(prices(page), '150', '250');
  await chip(page, 'BMW').click();
  await chip(page, 'Tesla').click();
  await chip(page, 'Tesla').click();
  await mechanics(page)
    .getByRole('button', { name: 'Adaugă un mecanic' })
    .click();
  await mechanics(page).locator('input[name="name"]').fill('Mihai Dumitru');
  await mechanics(page).getByRole('switch').click();
}

async function follows(page: Page, name: string) {
  const card = preview(page);
  await expect(card.locator('.name')).toHaveText(name);
  await expect(card.locator('.range')).toHaveText('150–250 lei/oră');
  await expect(card.locator('mf-lamp')).toHaveText('Lucrează pe BMW');
  await expect(card.locator('.line')).toHaveText([
    'Lucrează pe: BMW',
    'Nu primește: Tesla',
  ]);
  await expect(card.locator('.mechanic .avatar')).toHaveText('MD');
  await expect(card).not.toContainText('0722');
}

test.describe('the live preview on list your garage', () => {
  test('follows the name, the range, the brands and a mechanic beside the form', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await open(page);
    await expect(preview(page).locator('.name')).toHaveText(
      'Numele service‑ului',
    );
    await expect(
      preview(page).getByRole('button', { name: 'Previzualizare' }),
    ).toBeHidden();

    await fill(page, 'Service Ionescu');

    await follows(page, 'Service Ionescu');
    const [form, card] = await Promise.all([
      page.locator('.sections').boundingBox(),
      preview(page).boundingBox(),
    ]);
    expect(card?.x).toBeGreaterThan((form?.x ?? 0) + (form?.width ?? 0) - 1);
  });

  test('keeps following the form with the network off', async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await open(page);
    await context.setOffline(true);

    await fill(page, 'Service Offline');

    await follows(page, 'Service Offline');
    await context.setOffline(false);
  });

  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [768, 1024],
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      for (const [path, toggle, title] of [
        ['/ro/list-your-garage', 'Previzualizare', 'Cum îl vor vedea șoferii'],
        ['/en/list-your-garage', 'Preview', 'How drivers will see it'],
      ]) {
        test(`${path} at ${width} px, ${scheme}: a collapsed panel above Save that opens without sideways scroll`, async ({
          page,
        }) => {
          await page.setViewportSize({ height, width });
          await page.emulateMedia({ colorScheme: scheme });
          await open(page, path);
          const button = preview(page).getByRole('button', { name: toggle });
          const title_ = preview(page).getByText(title, { exact: true });

          await expect(button).toHaveAttribute('aria-expanded', 'false');
          await expect(title_).toBeHidden();

          await details(page)
            .locator('[name="name"]')
            .fill('Service Auto Constantinescu-Dumitrescu și Fiii SRL');
          for (const name of ['BMW', 'Mercedes-Benz', 'Volkswagen', 'Dacia']) {
            await chip(page, name).click();
          }
          await button.focus();
          await page.keyboard.press('Enter');

          await expect(button).toHaveAttribute('aria-expanded', 'true');
          await expect(title_).toBeVisible();
          const sideways = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(sideways).toBe(false);
          const before = await page.evaluate(() => {
            const panel = document.querySelector('mf-garage-preview');
            const save = document.querySelector('.actions');
            return Boolean(
              panel &&
                save &&
                panel.compareDocumentPosition(save) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
            );
          });
          expect(before).toBe(true);

          await page.keyboard.press('Space');
          await expect(button).toHaveAttribute('aria-expanded', 'false');
        });
      }
    }
  }
});
