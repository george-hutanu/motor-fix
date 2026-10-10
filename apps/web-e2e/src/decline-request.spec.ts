import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, an approved garage that works on Dacia petrol cars.
const DRIVER = 'cerere@example.test';
const OWNER = 'militari@example.test';
const DESCRIPTION = 'Zgomot la motor la pornirea la rece';

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// The driver sends a request with no job, straight to the owner's garage.
async function send(request: APIRequestContext) {
  const owner = await accessToken(request, OWNER);
  const me = await request.get('/api/v1/me', { headers: bearer(owner) });
  const { garageId } = (await me.json()) as { garageId: string };
  const driver = await accessToken(request, DRIVER);
  const cars = await request.get('/api/v1/cars', { headers: bearer(driver) });
  const { items } = (await cars.json()) as {
    items: { id: string; model: string }[];
  };
  const car = items.find((item) => item.model === 'Logan') ?? items[0];
  const res = await request.post('/api/v1/quote-requests', {
    data: {
      carId: car.id,
      description: DESCRIPTION,
      garageIds: [garageId],
      jobTypeIds: [],
      sources: ['profile_direct'],
    },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(res.status()).toBe(201);
  return {
    driver,
    garageId,
    id: ((await res.json()) as { id: string }).id,
    owner,
  };
}

async function waiting(request: APIRequestContext, token: string) {
  const res = await request.get('/api/v1/garage/requests?status=waiting', {
    headers: bearer(token),
  });
  return ((await res.json()) as { total: number }).total;
}

// The garage's answer as the driver's own read shows it.
async function driverSees(
  request: APIRequestContext,
  token: string,
  id: string,
  garageId: string,
) {
  const res = await request.get(`/api/v1/requests/${id}`, {
    headers: bearer(token),
  });
  expect(res.ok()).toBe(true);
  const { recipients } = (await res.json()) as {
    recipients: {
      declineReason: string | null;
      garage: { id: string };
      status: string;
    }[];
  };
  return recipients.find((r) => r.garage.id === garageId);
}

async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
}

const panel = (page: Page) => page.locator('mf-garage-requests-panel');

// @seeded: the owner declines a driver's request from Panou. The driver's
// read judges the 5-minute window from declined_at, so the case moves that
// back in PostgreSQL rather than wait; a deployed address, whose run has no
// DATABASE_URL, skips it.
test.describe('declining a request @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'moves declined_at back in PostgreSQL',
  );

  // @traces 345-FR-011
  // @traces 345-FR-020
  test('the owner declines with a reason; the row shows Refuzată and the driver sees it after the window', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, OWNER);
    const { driver, garageId, id, owner } = await send(request);
    const row = panel(page).locator(`[data-live-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });

    await row.getByRole('button', { exact: true, name: 'Refuză' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'De ce refuzați cererea?',
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('radio', { name: 'Trebuie să vedem mașina mai întâi' })
      .check();
    await dialog.getByRole('button', { exact: true, name: 'Refuză' }).click();

    await expect(page.getByText('Cerere refuzată')).toBeVisible({
      timeout: 5_000,
    });
    const closed = panel(page).locator(`[data-live-id="${id}"]`);
    await expect(closed).toContainText('Refuzată', { timeout: 5_000 });
    await expect(
      closed.getByRole('button', { exact: true, name: 'Refuză' }),
    ).toHaveCount(0);
    // Other workers send to the same garage: the screen follows the server.
    await expect
      .poll(
        async () =>
          (await panel(page).locator('.counter').textContent())?.trim() ===
          `${await waiting(request, owner)} fără răspuns`,
        { timeout: 5_000 },
      )
      .toBe(true);

    expect(await driverSees(request, driver, id, garageId)).toMatchObject({
      declineReason: null,
      status: 'waiting',
    });

    const db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    try {
      await db.query(
        `UPDATE request_recipient
            SET declined_at = declined_at - interval '5 minutes',
                answered_at = answered_at - interval '5 minutes'
          WHERE request_id = $1 AND garage_id = $2`,
        [id, garageId],
      );
    } finally {
      await db.end();
    }

    expect(await driverSees(request, driver, id, garageId)).toMatchObject({
      declineReason: 'need_to_see_car',
      status: 'declined',
    });
  });
});
