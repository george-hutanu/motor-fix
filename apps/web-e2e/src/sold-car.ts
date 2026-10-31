import type { APIRequestContext } from '@playwright/test';
import { Client } from 'pg';

import { signUpDriver } from './accounts.js';
import { bucharestDay } from './bucharest-day.js';

// A driver of the flow's own with one car and one repair they logged by hand,
// for the sale of the car. It writes straight to PostgreSQL, as the car, its
// open ownership and the logged repair take three routes, so it runs only
// where `@database` flows run. A MotorFix repair needs a finished job behind
// it, which the Jest specs cover instead. `remove` deletes what it wrote.
export interface SoldCar {
  email: string;
  car: string;
  repair: string;
  remove(): Promise<void>;
}

// A driver the flow made, by e-mail or phone, and their cars: the cars'
// repairs, ownership and transfer rows go with them (ON DELETE CASCADE).
export async function removeDriver(
  by: 'email' | 'phone',
  value: string,
): Promise<void> {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    await db.query(
      `DELETE FROM car WHERE owner_id IN (SELECT id FROM account WHERE ${by} = $1)`,
      [value],
    );
    await db.query(`DELETE FROM account WHERE ${by} = $1`, [value]);
  } finally {
    await db.end();
  }
}

export async function soldCar(request: APIRequestContext): Promise<SoldCar> {
  const email = await signUpDriver(request, 'vanzare');
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();

  const remove = async () => {
    await db.end();
    await removeDriver('email', email);
  };

  try {
    const made = await db.query<{ car_id: string; driver_id: string }>(
      `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km, idempotency_key)
       SELECT gen_random_uuid(), a.id, b.id, 'Logan', 2018, 'petrol', 120000, gen_random_uuid()::text
       FROM account a, brand b WHERE a.email = $1 AND b.key = 'dacia'
       RETURNING id AS car_id, owner_id AS driver_id`,
      [email],
    );
    const own = made.rows[0];
    if (!own) throw new Error('soldCar: the driver has no car to sell');
    await db.query(
      `INSERT INTO car_ownership (id, car_id, account_id, access, from_date, opened_at)
       VALUES (gen_random_uuid(), $1, $2, 'owner', $3, now() - interval '60 days')`,
      [own.car_id, own.driver_id, bucharestDay(-60)],
    );
    const repair = await db.query<{ id: string }>(
      `INSERT INTO repair (id, car_id, source, what, garage_name, done_on)
       VALUES (gen_random_uuid(), $1, 'logged', 'Plăcuțe de frână', 'Atelier Doi', $2)
       RETURNING id`,
      [own.car_id, bucharestDay(-10)],
    );
    return {
      car: own.car_id,
      email,
      remove,
      repair: repair.rows[0]?.id ?? '',
    };
  } catch (error) {
    await remove();
    throw error;
  }
}
