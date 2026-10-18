import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect } from '@playwright/test';
import { Client } from 'pg';

import { PASSWORD } from './accounts.js';

// A driver and two garages of the caller's own, beside the seeded Service
// Auto Militari, and the driver's oil-service request sent to all three:
// the seeded driver's requests are quoted by other specs running beside the
// caller, and the overview shows the newest open request with quotes, which
// would then be theirs. It writes straight to PostgreSQL, so a run without
// DATABASE_URL (a deployed address) skips the caller.
const MILITARI = 'militari@example.test';

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function accessToken(
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

export interface QuotedRequest {
  driver: string;
  password: string;
  garages: { name: string; owner: string }[];
  requestId: string;
  // Militari answers first and dearer (500 lei), the first own garage after
  // and cheaper (300 lei); the second own garage has not answered.
  quote(
    request: APIRequestContext,
    token: string,
    fromLei: number,
  ): Promise<void>;
  remove(): Promise<void>;
}

export async function quotedRequest(
  request: APIRequestContext,
  tag: string,
): Promise<QuotedRequest> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = 'compara-oferte-2026';
  const driver = `${tag}-${stamp}@example.test`;
  const garages = [
    { name: `Service Ieftin ${stamp}`, owner: `ieftin-${stamp}@example.test` },
    { name: `Service Târziu ${stamp}`, owner: `tarziu-${stamp}@example.test` },
  ];
  const garageIds: string[] = [];
  let requestId = '';
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();

  const remove = async () => {
    if (requestId)
      await db.query('DELETE FROM quote_request WHERE id = $1', [requestId]);
    await db.query('DELETE FROM account WHERE email = ANY($1)', [
      [driver, ...garages.map((g) => g.owner)],
    ]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    await db.end();
  };

  const signUp = async (email: string, n: number) => {
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

  try {
    const driverId = await signUp(driver, 0);
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
        [garage.name, `e2e-${tag}-${stamp}-${i}`],
      );
      const garageId = made.rows[0]?.id ?? '';
      garageIds.push(garageId);
      // A garage receives the request only when it works on the car's brand
      // and fuel and does the job asked for.
      await db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         SELECT $1, b.id, 'works_on', true, true, true, true, now() FROM brand b WHERE b.key = 'dacia'`,
        [garageId],
      );
      await db.query(
        `INSERT INTO garage_brand_job (garage_id, brand_id, job_type_id)
         SELECT $1, b.id, j.id FROM brand b, job_type j
         WHERE b.key = 'dacia' AND j.key = 'oil-service'`,
        [garageId],
      );
      const ownerId = await signUp(garage.owner, i + 1);
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
    expect(sent.status(), await sent.text()).toBe(201);
    requestId = ((await sent.json()) as { id: string }).id;
    await quote(request, militari, 500);
    await quote(
      request,
      await accessToken(request, garages[0]!.owner, password),
      300,
    );
  } catch (error) {
    await remove();
    throw error;
  }

  return { driver, garages, password, quote, remove, requestId };
}
