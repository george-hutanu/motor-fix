import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect } from '@playwright/test';

import { headers, ready, signIn, signUpDriver } from './accounts.js';
import { test } from './fixtures.js';
import { nextReminderDay, plusDays } from './worker-day.js';

// The texts of the driver's ITP rows in the bell, newest first.
async function bellRows(
  request: APIRequestContext,
  auth: Record<string, string>,
) {
  const res = await request.get('/api/v1/notifications', {
    headers: auth,
  });
  expect(res.ok()).toBe(true);
  const { items } = (await res.json()) as {
    items: { kind: string; text: string }[];
  };
  return items.filter((row) => row.kind === 'DUE_ITP').map((row) => row.text);
}

const LONG_DAY = new Intl.DateTimeFormat('ro-RO', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
});

// Needs the worker on shortened days (REMINDER_DAY_MS, 3000 in CI's E2E job):
// a reminder day passes in seconds, so both stages arrive within the test.
// Without it playwright.config.mts leaves @shortened-days out.
// @traces 094-FR-006
test.describe('the ITP reminders of a car added by a driver @shortened-days', () => {
  test.describe.configure({ retries: 0 });

  test('show the 30-day and then the 7-day reminder in the bell', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const email = await signUpDriver(request, 'itp');
    const auth = await headers(request, email);
    const brands = await request.get('/api/v1/brands?q=Dacia', {
      headers: auth,
    });
    const [dacia] = ((await brands.json()) as { items: { id: string }[] })
      .items;
    const dueOn = plusDays(await nextReminderDay(), 30);
    const car = await request.post('/api/v1/cars', {
      data: {
        brandId: dacia.id,
        fuel: 'petrol',
        itpUntil: dueOn,
        model: 'Logan',
        odometerKm: 98_000,
        year: 2018,
      },
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
    });
    expect(car.status(), await car.text()).toBe(201);
    const sentence = `ITP-ul la Dacia Logan expiră pe ${LONG_DAY.format(new Date(dueOn))}`;

    // The 30-day stage, or its catch-up a few days late; then the 7-day one.
    await expect
      .poll(() => bellRows(request, auth), { timeout: 60_000 })
      .toEqual([expect.stringMatching(/peste \d+ de zile\.$/)]);
    await expect
      .poll(() => bellRows(request, auth), { timeout: 150_000 })
      .toEqual([`${sentence}, peste 7 zile.`, expect.any(String)]);

    await ready(page, '/ro');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, email);
    await expect(page).toHaveURL('/app/driver');
    await page.getByRole('button', { name: /^Notificări/ }).click();
    const list = page.getByRole('dialog', { name: 'Notificări' });
    await expect(
      list.getByRole('button', {
        name: new RegExp(`${sentence}, peste 7 zile`),
      }),
    ).toBeVisible();
    await expect(
      list.getByRole('button', { name: /peste \d+ de zile\./ }),
    ).toBeVisible();
  });
});
