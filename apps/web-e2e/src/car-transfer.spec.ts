// @traces 1392-FR-001 1392-FR-002 1392-FR-003 1392-FR-004 1392-FR-005 1392-FR-009 1392-SC-001 1392-SC-003

import { expect } from '@playwright/test';

import { signedIn } from './accounts.js';
import { MAILBOX, test } from './fixtures.js';
import { freshPhone } from './fresh-phone.js';
import { type SoldCar, soldCar } from './sold-car.js';

const VALID = 'Linkul e valabil. Preluarea mașinii vine în curând.';

test.describe('selling a car and its transfer link @seeded @database', () => {
  let sold: SoldCar | undefined;

  test.afterEach(async () => {
    await sold?.remove();
    sold = undefined;
  });

  test('the seller sends the link with a ticked repair, the buyer’s link works until it is cancelled', async ({
    browser,
    page,
    request,
  }) => {
    sold = await soldCar(request);
    const buyer = freshPhone();
    await signedIn(page, sold.email, /\/app\/driver/);
    await page.goto('/app/driver/cars');

    await page
      .getByRole('button', { name: 'Acțiuni pentru Dacia Logan' })
      .click();
    await page.getByRole('menuitem', { name: 'Am vândut mașina' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ai vândut Dacia Logan?' });
    await dialog
      .getByRole('button', { name: 'Transmit istoricul noului proprietar' })
      .click();
    await dialog.getByRole('checkbox', { name: /Plăcuțe de frână/ }).check();
    await dialog.getByLabel('Telefonul cumpărătorului').fill(buyer);
    await dialog.getByRole('button', { name: 'Trimite' }).click();

    await expect(dialog.getByText('Linkul a plecat pe WhatsApp')).toBeVisible();
    const link =
      (await dialog.locator('[data-part="link"]').textContent())?.trim() ?? '';
    expect(link).toMatch(/\/ro\/transfer\/[\w-]+$/);
    await expect
      .poll(async () => {
        const res = await page.request.get(
          `${MAILBOX}/whatsapp?to=${encodeURIComponent(buyer.slice(1))}`,
        );
        return JSON.stringify(await res.json());
      })
      .toContain(new URL(link).pathname.split('/').at(-1));
    await dialog.getByRole('button', { name: 'Gata' }).click();
    await expect(page.getByText(/Transfer trimis · expiră pe/)).toBeVisible();

    const visitor = await browser.newContext();
    const buyerPage = await visitor.newPage();
    const opened = await buyerPage.goto(new URL(link).pathname);
    expect(opened?.status()).toBe(200);
    await expect(buyerPage.getByRole('heading', { name: VALID })).toBeVisible();

    await page.getByRole('button', { name: 'Anulează transferul' }).click();
    await page
      .getByRole('dialog', { name: 'Anulezi transferul?' })
      .getByRole('button', { name: 'Anulează transferul' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Acțiuni pentru Dacia Logan' }),
    ).toBeVisible();

    const gone = await buyerPage.goto(new URL(link).pathname);
    expect(gone?.status()).toBe(410);
    await expect(
      buyerPage.getByRole('heading', { name: 'Linkul nu mai e valabil' }),
    ).toBeVisible();
    await visitor.close();
  });

  test('an unknown link is served 404', async ({ page }) => {
    const res = await page.goto('/ro/transfer/nu-exista');
    expect(res?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: 'Linkul nu există' }),
    ).toBeVisible();
  });
});
