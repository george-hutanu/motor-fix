import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect } from '@playwright/test';
import { Client } from 'pg';

import { PASSWORD } from './accounts.js';

// A driver of the caller's own with a 2018 Dacia Logan on petrol, signed up
// with the seeded password: the seeded driver may send 20 requests a day
// (libs/domain/src/rate-limit/rate-limit.config.ts), and the specs beside the
// caller use them up within a run. It writes the car straight to PostgreSQL,
// so a run without DATABASE_URL (a deployed address) skips the caller.
export interface OwnDriver {
  email: string;
  carId: string;
  remove(): Promise<void>;
}

export async function ownDriver(
  request: APIRequestContext,
  tag: string,
): Promise<OwnDriver> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${tag}-${stamp}@example.test`;
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();

  // Always closes the connection, even when a DELETE fails.
  const remove = async () => {
    try {
      await db.query(
        'DELETE FROM quote_request WHERE driver_id IN (SELECT id FROM account WHERE email = $1)',
        [email],
      );
      await db.query('DELETE FROM account WHERE email = $1', [email]);
    } finally {
      await db.end();
    }
  };

  try {
    const res = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email,
        language: 'ro',
        name: `Șofer ${stamp}`,
        password: PASSWORD,
      },
      headers: { 'x-forwarded-for': `198.51.100.${Date.now() % 250}` },
    });
    expect(res.status(), await res.text()).toBe(201);
    const car = await db.query<{ id: string }>(
      `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km, idempotency_key)
       SELECT gen_random_uuid(), a.id, b.id, 'Logan', 2018, 'petrol', 98000, $2
       FROM account a, brand b WHERE a.email = $1 AND b.key = 'dacia' RETURNING id`,
      [email, stamp],
    );
    return { carId: car.rows[0]?.id ?? '', email, remove };
  } catch (error) {
    // The setup's own failure is the one to report, not the cleanup's.
    await remove().catch(() => undefined);
    throw error;
  }
}
