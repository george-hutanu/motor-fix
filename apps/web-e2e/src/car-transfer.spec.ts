// @traces 1392-FR-001 1392-FR-002 1392-FR-003 1392-FR-004 1392-FR-005 1392-FR-009 1394-FR-008

import { expect, type Locator, type Page } from '@playwright/test';

import { signedIn } from './accounts.js';
import { MAILBOX, test } from './fixtures.js';
import { freshPhone } from './fresh-phone.js';
import { removeDriver, type SoldCar, soldCar } from './sold-car.js';
import { lastCode } from './whatsapp-code.js';

const WAITING = 'O mașină te așteaptă.';

// The seller's sale dialog, sending the link with the logged repair ticked;
// the dialog stays open on the sent link.
async function sendLink(
  page: Page,
  buyer: string,
): Promise<{ dialog: Locator; link: string }> {
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
  return { dialog, link };
}

// A new number signs up in the dialog the page opened: the code, a name, the tick.
async function phoneSignUp(page: Page, phone: string) {
  const dialog = page.getByRole('dialog', { name: 'Autentificare' });
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuă cu telefonul' }).click();
  await dialog.getByLabel('Număr de telefon').fill(phone);
  await dialog.getByRole('button', { name: 'Trimite codul' }).click();
  await dialog.getByLabel('Cod').fill(await lastCode(page, phone));
  await dialog.getByRole('button', { name: 'Intră în cont' }).click();
  await dialog.getByLabel('Nume').fill('Andrei Ionescu');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Creează contul' }).click();
  await expect(dialog).toHaveCount(0);
}

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

    const { dialog, link } = await sendLink(page, buyer);
    expect(link).toMatch(/\/ro\/transfer\/[\w-]+$/);
    await expect
      .poll(async () => {
        const res = await page.request.get(
          `${MAILBOX}/whatsapp?to=${encodeURIComponent(buyer.slice(1))}`,
        );
        return JSON.stringify(await res.json());
      })
      .toContain(new URL(link).pathname.split('/').at(-1));
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await dialog.getByRole('button', { name: 'Copiază linkul' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(link);
    await dialog.getByRole('button', { name: 'Gata' }).click();
    await expect(page.getByText(/Transfer trimis · expiră pe/)).toBeVisible();

    const visitor = await browser.newContext();
    const buyerPage = await visitor.newPage();
    const opened = await buyerPage.goto(new URL(link).pathname);
    expect(opened?.status()).toBe(200);
    await expect(
      buyerPage.getByRole('heading', { name: WAITING }),
    ).toBeVisible();

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

  test('the buyer signs in on the link and takes the car over; the seller sees it sold with its history', async ({
    browser,
    page,
    request,
  }) => {
    sold = await soldCar(request);
    const phone = freshPhone();
    try {
      await signedIn(page, sold.email, /\/app\/driver/);
      await page.goto('/app/driver/cars');
      const sent = await sendLink(page, phone);
      await sent.dialog.getByRole('button', { name: 'Gata' }).click();
      const path = new URL(sent.link).pathname;

      const visitor = await browser.newContext();
      const buyer = await visitor.newPage();
      const opened = await buyer.goto(path);
      expect(opened?.status()).toBe(200);
      await expect(buyer.getByRole('heading', { name: WAITING })).toBeVisible();
      await expect(buyer.locator('mf-transfer')).not.toContainText('Dacia');

      await buyer.getByRole('button', { name: 'Intră în cont' }).click();
      await phoneSignUp(buyer, phone);
      await expect(
        buyer.getByRole('heading', {
          name: /^Dacia Logan 2018 · 1 reparație transmisă · de la /,
        }),
      ).toBeVisible();
      await expect(buyer).toHaveURL(path);

      await buyer.getByRole('button', { name: 'Preiau mașina' }).click();
      await expect(buyer).toHaveURL(/\/app\/driver\/cars\/[\w-]+$/);
      const card = buyer.locator('article[data-car]', {
        hasText: 'Dacia Logan',
      });
      await expect(card).toBeVisible();
      await expect(card).toContainText('2018');
      await expect(card).not.toContainText(/[A-Z]{1,2} ?\d{2,3} ?[A-Z]{3}/);
      await visitor.close();

      await page.reload();
      const section = page.locator('mf-sold-cars');
      await expect(
        section.getByRole('heading', { name: 'Mașini vândute' }),
      ).toBeVisible();
      await expect(section).toContainText(
        /Dacia Logan 2018 · vândută pe \d{1,2} \p{L}+ \d{4}/u,
      );
      await section
        .getByRole('button', { name: 'Vezi istoricul pentru Dacia Logan' })
        .click();
      await expect(section.getByText('Plăcuțe de frână')).toBeVisible();
      await expect(section.getByText('Adăugată de tine')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Acțiuni pentru Dacia Logan' }),
      ).toHaveCount(0);
    } finally {
      await removeDriver('phone', phone);
    }
  });

  test('an unknown link is served 404', async ({ page }) => {
    const res = await page.goto('/ro/transfer/nu-exista');
    expect(res?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: 'Linkul nu există' }),
    ).toBeVisible();
  });
});
