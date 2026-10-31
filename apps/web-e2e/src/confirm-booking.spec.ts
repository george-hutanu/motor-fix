import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import {
  accepted,
  accessToken,
  bearer,
  DRIVER,
  freeSlot,
  MILITARI,
} from './booking.js';
import { test } from './fixtures.js';
import { ownDriver } from './own-driver.js';
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

// A mechanic card of the test's own at Militari, named in letters only, free
// at any time the test draws; removed when the test ends.
async function ownMechanic(
  request: APIRequestContext,
  garage: Record<string, string>,
) {
  const me = await request.get('/api/v1/me', { headers: garage });
  const { garageId } = (await me.json()) as { garageId: string };
  const letters = Array.from(randomUUID().replace(/-/g, '').slice(0, 6), (c) =>
    String.fromCharCode(97 + (Number.parseInt(c, 16) % 26)),
  ).join('');
  const name = `Mecanic Elevator ${letters}`;
  const added = await request.post(`/api/v1/garages/${garageId}/mechanics`, {
    data: { name },
    headers: garage,
  });
  expect(added.status(), await added.text()).toBe(201);
  const { id } = (await added.json()) as { id: string };
  const remove = async () => {
    await request.delete(`/api/v1/garages/${garageId}/mechanics/${id}`, {
      headers: garage,
    });
  };
  return { name, remove };
}

// @seeded: the seeded driver's accepted booking is confirmed by Militari.
test.describe('confirming a booking @seeded', () => {
  // @traces 389-FR-002
  // @traces 389-FR-014
  // @traces 389-FR-015
  // @traces 389-FR-016
  // @traces 389-FR-020
  test('the owner confirms with a mechanic and Elevator 1, and the driver’s Cererile mele shows it booked without a reload', async ({
    browser,
    page,
    request,
  }) => {
    const requestId = await accepted(request);
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, DRIVER, '/app/driver');
    await page.goto('/app/driver/requests');
    const row = page.locator(`li[data-request="${requestId}"]`);
    await expect(row.locator('.waiting')).toBeVisible();
    await expect(row.locator('.booked')).toHaveCount(0);

    const context = await browser.newContext();
    try {
      const owner = await context.newPage();
      await owner.setViewportSize({ height: 900, width: 1440 });
      await signedIn(owner, MILITARI, '/app/garage');
      await owner.goto('/app/garage/requests');
      const sent = owner
        .locator('mf-quotes-sent-panel')
        .locator(`[data-live-id="${requestId}"]`);
      await sent.getByRole('button', { name: 'Confirmă programarea' }).click();

      const dialog = owner.getByRole('dialog', {
        name: 'Confirmă programarea',
      });
      const mechanic = dialog.getByLabel('Mecanic');
      // The choices arrive after the dialog opens.
      await expect(mechanic).toBeVisible();
      const [, first] = await mechanic.locator('option').allTextContents();
      await mechanic.selectOption({ label: first });
      await dialog.getByLabel('Elevator').selectOption({ label: 'Elevator 1' });
      await dialog
        .getByRole('button', { exact: true, name: 'Confirmă' })
        .click();
      await expect(owner.getByText('Programare confirmată')).toBeVisible();
      await expect(dialog).toBeHidden();

      await expect(sent).toContainText('Acceptată · programată');
      await expect(sent.locator('.mechanic')).toHaveText(first);
      await expect(sent.locator('.lift')).toHaveText('Elevator 1');
      await expect(
        sent.getByRole('button', { name: 'Confirmă programarea' }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }

    await expect(row.locator('.booked')).toContainText('Programată ·', {
      timeout: 5_000,
    });
    await expect(row.locator('.waiting')).toHaveCount(0);
  });

  // @traces 1384-FR-001 1384-FR-002 1384-FR-003 1384-FR-008
  test('an oil service asks for a lift, and a second booking at the same time is refused Elevator 1, then confirmed with Fără elevator', async ({
    page,
    request,
  }) => {
    // A driver and two mechanics of the test's own: the seeded driver's 20
    // requests a day go to the specs beside this one, and a shared mechanic
    // may be off at the drawn time or booked by another test.
    const driver = await ownDriver(request, 'lift-contend');
    const garage = bearer(await accessToken(request, MILITARI));
    const one = await ownMechanic(request, garage);
    const two = await ownMechanic(request, garage);
    try {
      const slot = await freeSlot(request);
      const first = await accepted(request, slot, driver.email);
      const second = await accepted(request, slot, driver.email);
      await page.setViewportSize({ height: 900, width: 1440 });
      await signedIn(page, MILITARI, '/app/garage');
      await page.goto('/app/garage/requests');
      const dialog = page.getByRole('dialog', { name: 'Confirmă programarea' });

      async function openFor(requestId: string) {
        const row = page
          .locator('mf-quotes-sent-panel')
          .locator(`[data-live-id="${requestId}"]`);
        await row.getByRole('button', { name: 'Confirmă programarea' }).click();
        const mechanic = dialog.getByLabel('Mecanic');
        await expect(mechanic).toBeVisible();
        return { mechanic, row };
      }

      const opened = await openFor(first);
      const lift = dialog.getByLabel('Elevator');
      // The oil service is done on a lift: nothing is picked for it.
      await expect(lift.locator('option:checked')).toHaveText(
        'Alege elevatorul',
      );
      await opened.mechanic.selectOption({ label: one.name });
      await lift.selectOption({ label: 'Elevator 1' });
      await dialog
        .getByRole('button', { exact: true, name: 'Confirmă' })
        .click();
      await expect(page.getByText('Programare confirmată')).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(opened.row.locator('.mechanic')).toHaveText(one.name);
      await expect(opened.row.locator('.lift')).toHaveText('Elevator 1');

      const again = await openFor(second);
      await again.mechanic.selectOption({ label: two.name });
      await lift.selectOption({ label: 'Elevator 1' });
      await dialog
        .getByRole('button', { exact: true, name: 'Confirmă' })
        .click();
      await expect(
        dialog.getByText('Elevatorul 1 e ocupat la ora asta'),
      ).toBeVisible();
      await expect(lift).toBeFocused();

      await lift.selectOption({ label: 'Fără elevator' });
      await dialog
        .getByRole('button', { exact: true, name: 'Confirmă' })
        .click();
      await expect(dialog).toBeHidden();
      await expect(again.row).toContainText('Acceptată · programată');
      await expect(again.row.locator('.mechanic')).toHaveText(two.name);
    } finally {
      // The driver first: its requests take their bookings and jobs along,
      // so the mechanics leave with nothing booked.
      await driver.remove();
      await one.remove();
      await two.remove();
    }
  });
});
