import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect } from '@playwright/test';
import { Client } from 'pg';

import { signedIn, signUpDriver } from './accounts.js';
import { accessToken, bearer, confirmed, MILITARI } from './booking.js';
import { test } from './fixtures.js';

const MECHANIC = 'mecanic-militari@example.test';

// A driver of the test's own with a car: the seeded drivers' daily requests
// are spent by the specs beside this one.
async function ownDriver(request: APIRequestContext) {
  const email = await signUpDriver(request, 'o-stare');
  const driver = bearer(await accessToken(request, email));
  const brands = await request.get('/api/v1/brands?q=Dacia', {
    headers: driver,
  });
  const [dacia] = ((await brands.json()) as { items: { id: string }[] }).items;
  const car = await request.post('/api/v1/cars', {
    data: {
      brandId: dacia.id,
      fuel: 'petrol',
      model: 'Logan',
      odometerKm: 98_000,
      year: 2018,
    },
    headers: { ...driver, 'Idempotency-Key': randomUUID() },
  });
  expect(car.status(), await car.text()).toBe(201);
  return email;
}

// @seeded: Militari and its mechanic Dan; @database: his card's id.
test.describe('one job status on every screen @seeded @database', () => {
  // @traces 122-one-job-status-FR-001 122-one-job-status-FR-014
  test('the owner’s pause reaches the mechanic’s Panou within two seconds', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const garage = bearer(await accessToken(request, MILITARI));
    let jobId = '';
    try {
      const card = await db.query<{ id: string }>(
        `SELECT m.id FROM mechanic m JOIN account a ON a.id = m.account_id
         WHERE a.email = $1 AND m.removed_at IS NULL`,
        [MECHANIC],
      );
      const mechanicId = card.rows[0]?.id ?? '';
      expect(mechanicId).not.toBe('');
      const { bookingId } = await confirmed(
        request,
        await ownDriver(request),
        mechanicId,
      );
      const job = await db.query<{ id: string }>(
        'SELECT id FROM job WHERE booking_id = $1',
        [bookingId],
      );
      jobId = job.rows[0]?.id ?? '';
      expect(jobId).not.toBe('');
      const call = async (verb: string) => {
        const res = await request.post(`/api/v1/garage/jobs/${jobId}/${verb}`, {
          headers: garage,
        });
        expect(res.ok(), `${verb}: ${res.status()}`).toBe(true);
      };
      await call('start');

      await page.setViewportSize({ height: 844, width: 390 });
      await signedIn(page, MECHANIC, '/app/garage');
      const row = page
        .locator('mf-own-jobs-section')
        .locator(`[data-job="${jobId}"] button`);
      await expect(row).toHaveAttribute('data-status', 'in_work');

      await call('pause');
      await expect(row).toHaveAttribute('data-status', 'paused', {
        timeout: 2_000,
      });
      await expect(row).toContainText('În pauză');
    } finally {
      if (jobId)
        await request.post(`/api/v1/garage/jobs/${jobId}/finish`, {
          headers: garage,
        });
      await db.end();
    }
  });
});
