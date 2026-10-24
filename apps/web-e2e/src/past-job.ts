import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect } from '@playwright/test';
import { Client } from 'pg';

// A job the named mechanic card finished earlier today, for a driver and car
// of its own: the jobs view lists a garage's jobs from the start of the
// Bucharest day, so a job booked before it would not show. It writes straight
// to PostgreSQL, as no route records a finished job in one call, so the caller
// skips without DATABASE_URL. `plate` finds the job's row; `remove` deletes
// what it wrote.
export interface PastJob {
  plate: string;
  remove(): Promise<void>;
}

export async function pastJob(
  request: APIRequestContext,
  mechanicName: string,
): Promise<PastJob> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const plate = `B${stamp.slice(-6).toUpperCase()}`;
  const driver = `istoric-${stamp}@example.test`;
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  let requestId: string | undefined;

  const remove = async () => {
    try {
      await db.query(
        `DELETE FROM job WHERE driver_id IN (SELECT id FROM account WHERE email = $1)`,
        [driver],
      );
      if (requestId) {
        await db.query('DELETE FROM booking WHERE request_id = $1', [
          requestId,
        ]);
        await db.query('DELETE FROM quote_request WHERE id = $1', [requestId]);
      }
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
        password: 'istoric-lucrari-2026',
      },
      headers: { 'x-forwarded-for': `198.51.100.${Date.now() % 250}` },
    });
    expect(res.status()).toBe(201);
    const card = await db.query<{ id: string; garage_id: string }>(
      'SELECT id, garage_id FROM mechanic WHERE name = $1 AND removed_at IS NULL',
      [mechanicName],
    );
    const mechanic = card.rows[0];
    expect(mechanic).toBeDefined();
    const made = await db.query<{ car_id: string; driver_id: string }>(
      `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km, plate, idempotency_key)
       SELECT gen_random_uuid(), a.id, b.id, 'Logan', 2018, 'petrol', 98000, $2, $3
       FROM account a, brand b WHERE a.email = $1 AND b.key = 'dacia'
       RETURNING id AS car_id, owner_id AS driver_id`,
      [driver, plate, stamp],
    );
    const own = made.rows[0];
    const garageId = mechanic?.garage_id;
    const mechanicId = mechanic?.id;
    const sent = await db.query<{ id: string }>(
      `INSERT INTO quote_request (id, driver_id, car_id, car_brand, car_model, car_year, car_fuel,
                                  description, status, created_at, expires_at, idempotency_key)
       VALUES (gen_random_uuid(), $1, $2, 'Dacia', 'Logan', 2018, 'petrol',
               'Schimb de ulei', 'booked', now() - interval '2 days',
               now() + interval '5 days', $3)
       RETURNING id`,
      [own?.driver_id, own?.car_id, `past-job-${stamp}`],
    );
    requestId = sent.rows[0]?.id;
    const recipient = await db.query<{ id: string }>(
      `INSERT INTO request_recipient (id, request_id, garage_id, status, source, answered_at)
       VALUES (gen_random_uuid(), $1, $2, 'quoted', 'search', now() - interval '2 days')
       RETURNING id`,
      [requestId, garageId],
    );
    // Earlier today in Bucharest, and never before that day's start.
    const startsAt = `GREATEST(now() - interval '1 hour',
      date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')`;
    const quote = await db.query<{ id: string }>(
      `INSERT INTO quote (id, request_id, recipient_id, garage_id, from_bani, to_bani, duration_minutes,
                          slot, status, accepted_at, expires_at, idempotency_key)
       VALUES (gen_random_uuid(), $1, $2, $3, 45000, 60000, 60, ${startsAt}, 'accepted',
               now() - interval '2 days', now() + interval '5 days', gen_random_uuid()::text)
       RETURNING id`,
      [requestId, recipient.rows[0]?.id, garageId],
    );
    const booking = await db.query<{ id: string }>(
      `INSERT INTO booking (id, quote_id, request_id, garage_id, driver_id, starts_at, duration_minutes,
                            status, confirm_by, confirmed_at, completed_at, mechanic_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, ${startsAt}, 60, 'completed',
               now() - interval '1 day', now() - interval '2 days', now(), $5)
       RETURNING id`,
      [quote.rows[0]?.id, requestId, garageId, own?.driver_id, mechanicId],
    );
    await db.query(
      `INSERT INTO job (id, booking_id, garage_id, car_id, driver_id, mechanic_id, status,
                        started_at, finished_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'done', ${startsAt}, now())`,
      [booking.rows[0]?.id, garageId, own?.car_id, own?.driver_id, mechanicId],
    );
  } catch (error) {
    await remove();
    throw error;
  }
  return { plate, remove };
}
