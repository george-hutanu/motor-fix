import { expect, type Page, test } from '@playwright/test';

import { ready } from './accounts.js';

// The WhatsApp messages as the api sent them, read from the test mailbox the
// local run starts (mailbox.mjs); a deployed address has none.
const MAILBOX = 'http://127.0.0.1:3025';
// The seeded garage owner's verified number (libs/domain/src/seed.ts).
const GARAGE_PHONE = '+40700000101';

async function lastCode(page: Page, phone: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/whatsapp?to=${encodeURIComponent(phone.slice(1))}`,
        );
        const sent: { params: string[] }[] = await res.json();
        code = sent.at(-1)?.params[0];
        return code;
      },
      { message: 'no WhatsApp message sent', timeout: 20_000 },
    )
    .toMatch(/^\d{6}$/);
  return String(code);
}

test.describe('signing in with a phone number @seeded @mailbox', () => {
  test('a garage owner asks for a code, types it and lands on the garage', async ({
    page,
  }) => {
    await ready(page, '/ro/garages');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Autentificare' });
    await expect(dialog.locator('mf-overlay-panel')).toBeVisible();

    await dialog.getByRole('button', { name: 'Continuă cu telefonul' }).click();
    await dialog.getByLabel('Număr de telefon').fill('0700 000 101');
    await dialog.getByRole('button', { name: 'Trimite codul' }).click();

    await expect(dialog.getByLabel('Cod')).toBeFocused();
    await dialog.getByLabel('Cod').fill(await lastCode(page, GARAGE_PHONE));
    await dialog.getByRole('button', { name: 'Intră în cont' }).click();

    await expect(page).toHaveURL('/app/garage');
  });
});
