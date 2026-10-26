import { expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { accessToken, bearer, confirmed, DRIVER, MILITARI } from './booking.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

async function signedIn(page: Page, email: string, landing: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL(landing);
}

// @seeded: the seeded driver cancels a booking Militari confirmed.
test.describe('cancelling a booking from Cererile mele @seeded', () => {
  // @traces 1385-FR-009
  test('the driver cancels with a reason, the row reads Anulată de tine and Militari’s bell tells it', async ({
    page,
    request,
  }) => {
    const { bookingId, requestId } = await confirmed(request);
    const owner = bearer(await accessToken(request, MILITARI));
    const unread = async () => {
      const res = await request.get('/api/v1/notifications/unread-count', {
        headers: owner,
      });
      expect(res.ok()).toBe(true);
      return ((await res.json()) as { count: number }).count;
    };
    const before = await unread();

    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, DRIVER, '/app/driver');
    await page.goto('/app/driver/requests');
    const row = page.locator(`li[data-request="${requestId}"]`);
    await row
      .getByRole('button', { exact: true, name: 'Anulează programarea' })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Anulezi programarea?' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Am găsit alt service').check();
    await dialog
      .getByRole('button', { exact: true, name: 'Anulează programarea' })
      .click();
    await expect(page.getByText('Programare anulată')).toBeVisible();
    await expect(dialog).toBeHidden();

    await expect(row.locator('.cancelled')).toHaveText('Anulată de tine', {
      timeout: 5_000,
    });
    await expect(
      row.getByRole('button', { name: 'Anulează programarea' }),
    ).toHaveCount(0);

    // Signed in as Militari's owner: the bell counts and lists the cancel.
    await expect.poll(unread, { timeout: 10_000 }).toBeGreaterThan(before);
    const list = await request.get('/api/v1/notifications', {
      headers: owner,
    });
    expect(list.ok()).toBe(true);
    const { items } = (await list.json()) as {
      items: { subjectId: string | null; text: string }[];
    };
    // "<driver> a anulat programarea · <car> · <slot>": the driver's own name
    // and car, as the driver's reads give them.
    const driver = bearer(await accessToken(request, DRIVER));
    const me = (await (
      await request.get('/api/v1/me', { headers: driver })
    ).json()) as { name: string };
    const mine = (await (
      await request.get('/api/v1/requests', { headers: driver })
    ).json()) as {
      items: { car: { brand: string; model: string }; id: string }[];
    };
    const car = mine.items.find((item) => item.id === requestId)?.car;
    const told = items.find((item) => item.subjectId === bookingId);
    expect(told?.text).toMatch(/^.+ a anulat programarea · .+ · .+$/);
    expect(told?.text.startsWith(`${me.name} a anulat programarea · `)).toBe(
      true,
    );
    expect(told?.text).toContain(`${car?.brand} ${car?.model}`);
  });
});
