import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// A driver and two garages of this file's own, beside the seeded Service
// Auto Militari: the seeded driver's requests are quoted by other specs
// running beside this one, and the overview shows the newest open request
// with quotes, which would then be theirs. A deployed address, whose run has
// no DATABASE_URL, skips the file.
const MILITARI = 'militari@example.test';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function accessToken(
  request: APIRequestContext,
  email: string,
  password = PASSWORD,
) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.describe('comparing the quotes of a request @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its driver, car and garages straight to PostgreSQL, which needs DATABASE_URL',
  );
  test.describe.configure({ mode: 'serial' });

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = 'compara-oferte-2026';
  const driver = `compara-${stamp}@example.test`;
  const garages = [
    { name: `Service Ieftin ${stamp}`, owner: `ieftin-${stamp}@example.test` },
    { name: `Service Târziu ${stamp}`, owner: `tarziu-${stamp}@example.test` },
  ];
  let db: Client;
  let requestId = '';
  const garageIds: string[] = [];

  const signUp = async (
    request: APIRequestContext,
    email: string,
    n: number,
  ) => {
    const res = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email,
        language: 'ro',
        name: `Cont ${stamp}`,
        password,
      },
      headers: {
        'x-forwarded-for': `198.51.100.${(Date.now() + 101 + n) % 250}`,
      },
    });
    expect(res.status()).toBe(201);
    const row = await db.query<{ id: string }>(
      'SELECT id FROM account WHERE email = $1',
      [email],
    );
    return row.rows[0]?.id ?? '';
  };

  const quote = async (
    request: APIRequestContext,
    token: string,
    fromLei: number,
  ) => {
    const res = await request.post('/api/v1/quotes', {
      data: {
        durationMinutes: 60,
        fromLei,
        requestId,
        slot: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        toLei: fromLei + 100,
      },
      headers: { ...bearer(token), 'Idempotency-Key': randomUUID() },
    });
    expect(res.status()).toBe(201);
  };

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const driverId = await signUp(request, driver, 0);
    const car = await db.query<{ id: string }>(
      `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km, idempotency_key)
       SELECT gen_random_uuid(), $1, b.id, 'Logan', 2018, 'petrol', 98000, $2
       FROM brand b WHERE b.key = 'dacia' RETURNING id`,
      [driverId, stamp],
    );
    for (const [i, garage] of garages.entries()) {
      const made = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at, city_key, city_name)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), 'bucuresti', 'București') RETURNING id`,
        [garage.name, `e2e-compara-${stamp}-${i}`],
      );
      const garageId = made.rows[0]?.id ?? '';
      garageIds.push(garageId);
      const ownerId = await signUp(request, garage.owner, i + 1);
      await db.query(
        `INSERT INTO account_role (account_id, role) VALUES ($1, 'garage') ON CONFLICT DO NOTHING`,
        [ownerId],
      );
      await db.query(`UPDATE account SET last_role = 'garage' WHERE id = $1`, [
        ownerId,
      ]);
      await db.query(
        `INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'owner')`,
        [garageId, ownerId],
      );
    }
    const militari = await accessToken(request, MILITARI);
    const me = await request.get('/api/v1/me', { headers: bearer(militari) });
    const { garageId: militariId } = (await me.json()) as { garageId: string };
    const jobs = await request.get('/api/v1/job-types?keys=oil-service');
    const [oil] = ((await jobs.json()) as { items: { id: string }[] }).items;
    const sent = await request.post('/api/v1/quote-requests', {
      data: {
        carId: car.rows[0]?.id,
        description: `Schimb de ulei ${stamp}`,
        garageIds: [militariId, ...garageIds],
        jobTypeIds: [oil?.id],
        // One source per garage, in the same order.
        sources: [militariId, ...garageIds].map(() => 'profile_direct'),
      },
      headers: {
        ...bearer(await accessToken(request, driver, password)),
        'Idempotency-Key': randomUUID(),
      },
    });
    expect(sent.status()).toBe(201);
    requestId = ((await sent.json()) as { id: string }).id;
    // Militari answers first and dearer, the first own garage after and cheaper.
    await quote(request, militari, 500);
    await quote(
      request,
      await accessToken(request, garages[0]!.owner, password),
      300,
    );
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM quote_request WHERE id = $1', [requestId]);
    await db.query('DELETE FROM account WHERE email = ANY($1)', [
      [driver, ...garages.map((g) => g.owner)],
    ]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    await db.end();
  });

  const panel = (page: Page) => page.locator('mf-quotes-compare');
  const names = (page: Page) =>
    panel(page).locator('li[data-quote] [data-part="name"]');

  async function signedIn(page: Page) {
    await page.setViewportSize({ height: 900, width: 1440 });
    await ready(page, '/ro');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, driver, { password });
    await expect(page).toHaveURL('/app/driver');
  }

  // @traces 313-FR-001 313-FR-005 313-FR-006 313-FR-012 313-FR-013
  test('lists the two quotes fastest first on the overview and in Cererile mele', async ({
    page,
  }) => {
    await signedIn(page);

    await expect(names(page)).toHaveText([
      'Service Auto Militari',
      garages[0]!.name,
    ]);
    await expect(panel(page).locator('[data-part="header"]')).toHaveText(
      /· 2 oferte$/,
    );

    await page.goto(`/app/driver/requests?request=${requestId}`);
    await expect(names(page)).toHaveText([
      'Service Auto Militari',
      garages[0]!.name,
    ]);
  });

  // @traces 313-FR-004
  test('re-sorts the rows by price', async ({ page }) => {
    await signedIn(page);
    await expect(names(page)).toHaveCount(2);

    await panel(page).getByRole('radio', { name: 'Preț' }).check();

    await expect(names(page)).toHaveText([
      garages[0]!.name,
      'Service Auto Militari',
    ]);
  });

  // @traces 313-FR-010
  test('shows a third quote without a reload, and the count reads 3', async ({
    page,
    request,
  }) => {
    await signedIn(page);
    await page.goto(`/app/driver/requests?request=${requestId}`);
    await expect(names(page)).toHaveCount(2);
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    await quote(
      request,
      await accessToken(request, garages[1]!.owner, password),
      400,
    );

    await expect(names(page)).toHaveCount(3, { timeout: 5_000 });
    await expect(panel(page).locator('[data-part="header"]')).toHaveText(
      /· 3 oferte$/,
    );
    expect(navigations).toBe(0);
  });
});
