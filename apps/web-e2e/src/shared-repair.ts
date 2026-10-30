import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect } from '@playwright/test';
import { Client } from 'pg';

// A repair a driver of its own logged by hand and shared with the garage the
// seeded owner (service@example.test) runs. It writes straight to PostgreSQL,
// as the car, its open ownership and the logged repair take three routes and
// a share, so it runs only where `@database` flows run. `id` finds the repair's
// row; `driver` signs in as its driver; `garage` is the garage's name, as the
// driver's bell names it; `remove` deletes what it wrote.
export interface SharedRepair {
  id: string;
  driver: { email: string; password: string };
  garage: string;
  remove(): Promise<void>;
}

const DRIVER_PASSWORD = 'reparatie-partajata-2026';
const GARAGE_OWNER = 'service@example.test';

export async function sharedRepair(
  request: APIRequestContext,
  odometerKm: number,
): Promise<SharedRepair> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const plate = `B${stamp.slice(-6).toUpperCase()}`;
  const driver = `partajare-${stamp}@example.test`;
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();

  const remove = async () => {
    try {
      // The car's repairs and ownership rows go with it (ON DELETE CASCADE).
      await db.query(
        `DELETE FROM car WHERE owner_id IN (SELECT id FROM account WHERE email = $1)`,
        [driver],
      );
      await db.query('DELETE FROM account WHERE email = $1', [driver]);
    } finally {
      await db.end();
    }
  };

  try {
    const res = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: driver,
        language: 'ro',
        name: `Cont ${stamp}`,
        password: DRIVER_PASSWORD,
      },
      headers: { 'x-forwarded-for': `198.51.100.${Date.now() % 250}` },
    });
    expect(res.status()).toBe(201);
    const owned = await db.query<{ id: string; name: string }>(
      `SELECT g.id, g.name FROM garage g
       JOIN garage_member m ON m.garage_id = g.id AND m.role = 'owner'
       JOIN account a ON a.id = m.account_id
       WHERE a.email = $1`,
      [GARAGE_OWNER],
    );
    const garage = owned.rows[0];
    expect(garage).toBeDefined();
    const made = await db.query<{ car_id: string; driver_id: string }>(
      `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km, plate, idempotency_key)
       SELECT gen_random_uuid(), a.id, b.id, 'Logan', 2018, 'petrol', $4, $2, $3
       FROM account a, brand b WHERE a.email = $1 AND b.key = 'dacia'
       RETURNING id AS car_id, owner_id AS driver_id`,
      [driver, plate, stamp, odometerKm],
    );
    const own = made.rows[0];
    await db.query(
      `INSERT INTO car_ownership (id, car_id, account_id, access, from_date, opened_at)
       VALUES (gen_random_uuid(), $1, $2, 'owner', current_date - 30, now() - interval '30 days')`,
      [own?.car_id, own?.driver_id],
    );
    const repair = await db.query<{ id: string }>(
      `INSERT INTO repair (id, car_id, source, what, garage_name, garage_id, done_on,
                           odometer_km, cost_bani, shared_with_garage, shared_at)
       VALUES (gen_random_uuid(), $1, 'logged', 'Schimb ulei și filtre', $2, $3,
               current_date - 7, $4, 45000, true, now())
       RETURNING id`,
      [own?.car_id, garage?.name, garage?.id, odometerKm],
    );
    const id = repair.rows[0]?.id;
    expect(id).toBeDefined();
    return {
      driver: { email: driver, password: DRIVER_PASSWORD },
      garage: garage?.name ?? '',
      id: id ?? '',
      remove,
    };
  } catch (error) {
    await remove();
    throw error;
  }
}
