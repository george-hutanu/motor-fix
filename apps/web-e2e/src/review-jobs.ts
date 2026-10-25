import type { Client } from 'pg';

import { ACCOUNTS } from './accounts.js';

// A done job at the garage for the seeded second driver, with the request,
// quote and booking it rests on, so the driver can post a review of it; its id
// is returned; with a mechanic's e-mail, that mechanic of the garage did the
// job. Written straight to the tables, as the seed writes its own.
export async function doneJob(
  db: Client,
  garageId: string,
  mechanicEmail?: string,
) {
  const { rows } = await db.query<{ job: string }>(
    `WITH driver AS (
       SELECT a.id, c.id AS car FROM account a JOIN car c ON c.owner_id = a.id
       WHERE a.email = $2 ORDER BY c.created_at LIMIT 1
     ), request AS (
       INSERT INTO quote_request (id, driver_id, car_id, car_brand, car_model, car_year, car_fuel,
                                  car_engine, description, status, created_at, expires_at,
                                  idempotency_key)
       SELECT gen_random_uuid(), d.id, d.car, 'Dacia', 'Logan', 2018, 'petrol', '1.0 TCe',
              'Frânele scârțâie', 'done', now() - interval '3 days', now() + interval '4 days',
              'e2e-reviews-' || gen_random_uuid()::text
       FROM driver d
       RETURNING id, driver_id, car_id
     ), recipient AS (
       INSERT INTO request_recipient (id, request_id, garage_id, status, source, answered_at)
       SELECT gen_random_uuid(), r.id, $1, 'quoted', 'search', now() FROM request r
       RETURNING id, request_id
     ), quote AS (
       INSERT INTO quote (id, request_id, recipient_id, garage_id, from_bani, to_bani,
                          duration_minutes, slot, status, accepted_at, expires_at, idempotency_key)
       SELECT gen_random_uuid(), p.request_id, p.id, $1, 45000, 60000, 90,
              now() - interval '1 day', 'accepted', now() - interval '2 days',
              now() + interval '4 days', gen_random_uuid()::text
       FROM recipient p
       RETURNING id, request_id, slot
     ), booking AS (
       INSERT INTO booking (id, quote_id, request_id, garage_id, driver_id, starts_at,
                            duration_minutes, status, confirm_by, confirmed_at, completed_at)
       SELECT gen_random_uuid(), q.id, q.request_id, $1, r.driver_id, q.slot, 90, 'completed',
              q.slot, now() - interval '2 days', now()
       FROM quote q JOIN request r ON r.id = q.request_id
       RETURNING id, driver_id
     )
     INSERT INTO job (id, booking_id, garage_id, car_id, driver_id, mechanic_id, status,
                      started_at, finished_at, handed_over_at)
     SELECT gen_random_uuid(), b.id, $1, r.car_id, b.driver_id,
            (SELECT m.id FROM mechanic m JOIN account a ON a.id = m.account_id
             WHERE m.garage_id = $1 AND a.email = $3),
            'done', now() - interval '1 day', now(), now()
     FROM booking b JOIN request r ON r.driver_id = b.driver_id
     RETURNING id AS job`,
    [garageId, ACCOUNTS.otherDriver, mechanicEmail ?? null],
  );
  const [made] = rows;
  if (!made) throw new Error('the seeded second driver has no car');
  return made.job;
}

// The job, its review and everything it rests on, gone again: each row
// down from the request is removed with it.
export async function removeJob(db: Client, jobId: string) {
  await db.query(
    `DELETE FROM quote_request WHERE id = (
       SELECT b.request_id FROM job j JOIN booking b ON b.id = j.booking_id
       WHERE j.id = $1)`,
    [jobId],
  );
}

// garage-reviews.spec.ts and garage-reviews-dashboard.spec.ts post reviews on
// Atelier Test, read its counts and put its stored figures back: each of
// their tests holds this lock on its own connection, so one file's review
// never lands in the other's counts or above its review.
export async function holdReviews(db: Client, garageId: string) {
  await db.query("SELECT pg_advisory_lock(hashtext('reviews:' || $1))", [
    garageId,
  ]);
}

export async function releaseReviews(db: Client, garageId: string) {
  await db.query("SELECT pg_advisory_unlock(hashtext('reviews:' || $1))", [
    garageId,
  ]);
}
