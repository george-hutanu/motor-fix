import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import { TURN_WAIT_MS } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

const api = apiBoot();
let app: INestApplication;
let db: Client;

type Role = 'driver' | 'garage';

const account = async (role: Role) =>
  (
    await app.get(AccountsService).createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: `${role}-${randomUUID()}` },
      name: role,
      roles: [role],
    })
  ).id;

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role } as never, TEST_TOKEN_SECRET, Date.now())}`;

const KEY = 'Idempotency-Key';

// The stamp the price row carries when the owner reads it, before a range write.
const READ_AT = '2026-10-30T08:00:00.000Z';

// One toggle write: a fresh state before each call, the call itself, what of
// its answer stays the same from one fresh state to the next, and the row it
// leaves behind.
type Write = {
  reset(): Promise<void>;
  call(key: string | undefined): request.Test;
  seen(
    body: Record<string, unknown>,
    previous: Record<string, unknown> | undefined,
  ): unknown;
  stored(): Promise<unknown>;
  // The status a write refused by design answers, with or without the key.
  refused?: number;
};

const send = (call: request.Test, auth: string, key: string | undefined) => {
  call.set('Authorization', auth);
  return key === undefined ? call : call.set(KEY, key);
};

const http = () => request(app.getHttpServer());

let writes: Write[] = [];

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();

  const driver = await account('driver');
  const owner = await account('garage');
  const garageId = randomUUID();
  await db.query(
    "INSERT INTO garage (id, name, slug, status, approved_at) VALUES ($1, 'Service Auto Nord', $2, 'approved'::garage_status, now())",
    [garageId, `nord-${garageId}`],
  );
  await db.query(
    "INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'owner')",
    [garageId, owner],
  );
  const jobTypeId = randomUUID();
  await db.query(
    "INSERT INTO job_type (id, key, name_ro, name_en, status, updated_at) VALUES ($1, $2, 'Frâne față', 'Front brakes', 'approved', now())",
    [jobTypeId, `brakes-${jobTypeId}`],
  );
  const priceId = randomUUID();
  await db.query(
    'INSERT INTO garage_price (id, garage_id, job_type_id, from_bani, to_bani, duration_minutes, position, updated_at, updated_by) VALUES ($1, $2, $3, 89000, 140000, 120, 0, now(), $4)',
    [priceId, garageId, jobTypeId, owner],
  );
  const notificationId = randomUUID();
  const driverAuth = bearer(driver, 'driver');
  const ownerAuth = bearer(owner, 'garage');

  // The driver's bell back to two unread rows, the first one fixed by id.
  const unread = async () => {
    await db.query('DELETE FROM notification WHERE account_id = $1', [driver]);
    await db.query(
      "INSERT INTO notification (id, account_id, kind, channel, status, event_id, created_at) VALUES ($1, $2, 'TEST_MESSAGE', 'in_app', 'sent', $3, '2026-10-30T08:00:00Z'), ($4, $2, 'TEST_MESSAGE', 'in_app', 'sent', $5, '2026-10-30T09:00:00Z')",
      [notificationId, driver, randomUUID(), randomUUID(), randomUUID()],
    );
    await db.query('UPDATE account SET unread_count = 2 WHERE id = $1', [
      driver,
    ]);
  };
  const bell = async () =>
    (
      await db.query(
        'SELECT (read_at IS NOT NULL) AS read FROM notification WHERE account_id = $1 ORDER BY created_at',
        [driver],
      )
    ).rows.concat(
      (
        await db.query('SELECT unread_count FROM account WHERE id = $1', [
          driver,
        ])
      ).rows,
    );

  const price = async () =>
    (
      await db.query(
        'SELECT visible, from_bani, to_bani, duration_minutes FROM garage_price WHERE id = $1',
        [priceId],
      )
    ).rows;
  // The stamp is the moment of the write, so only whether a repeat kept
  // the one before it is compared; the rest of the answer is compared whole.
  const stampless = (
    { updatedAt, ...rest }: Record<string, unknown>,
    previous: Record<string, unknown> | undefined,
  ) => ({
    ...rest,
    stamp:
      previous === undefined
        ? typeof updatedAt
        : updatedAt === previous['updatedAt'],
  });
  // The row as the owner read it: its first range, at a known stamp.
  const rangeAsRead = async () => {
    await db.query(
      'UPDATE garage_price SET visible = true, from_bani = 89000, to_bani = 140000, duration_minutes = 120, updated_at = $2 WHERE id = $1',
      [priceId, READ_AT],
    );
  };

  writes = [
    {
      call: (key) =>
        send(
          http()
            .put('/api/v1/notification-preferences')
            .send({ groups: [{ enabled: false, key: 'due_dates' }] }),
          driverAuth,
          key,
        ),
      reset: async () => {
        await db.query(
          'DELETE FROM notification_preference WHERE account_id = $1',
          [driver],
        );
      },
      seen: (body) => body,
      stored: async () =>
        (
          await db.query(
            'SELECT type, channel, enabled FROM notification_preference WHERE account_id = $1 ORDER BY type, channel',
            [driver],
          )
        ).rows,
    },
    {
      call: (key) =>
        send(
          http().post(`/api/v1/notifications/${notificationId}/read`),
          driverAuth,
          key,
        ),
      reset: unread,
      // The time it was read is the moment of the call; that it was is not.
      seen: ({ readAt, ...rest }) => ({ ...rest, read: readAt !== null }),
      stored: bell,
    },
    {
      call: (key) =>
        send(http().post('/api/v1/notifications/read-all'), driverAuth, key),
      reset: unread,
      seen: (body) => body,
      stored: bell,
    },
    {
      call: (key) =>
        send(
          http()
            .patch(`/api/v1/garages/${garageId}/prices/${priceId}`)
            .send({ visible: false }),
          ownerAuth,
          key,
        ),
      reset: async () => {
        await db.query('UPDATE garage_price SET visible = true WHERE id = $1', [
          priceId,
        ]);
      },
      seen: stampless,
      stored: price,
    },
    {
      // The range against the stamp it was read with: the first call saves,
      // and a repeat of it carries a stamp the save replaced, so it is stale.
      call: (key) =>
        send(
          http().patch(`/api/v1/garages/${garageId}/prices/${priceId}`).send({
            durationMinutes: 90,
            expectedUpdatedAt: READ_AT,
            fromBani: 90000,
            toBani: 150000,
          }),
          ownerAuth,
          key,
        ),
      reset: rangeAsRead,
      seen: stampless,
      stored: price,
    },
    {
      // A stamp older than the row's: refused as stale, the row untouched.
      call: (key) =>
        send(
          http().patch(`/api/v1/garages/${garageId}/prices/${priceId}`).send({
            expectedUpdatedAt: '2026-10-30T07:00:00.000Z',
            fromBani: 90000,
          }),
          ownerAuth,
          key,
        ),
      refused: 409,
      reset: rangeAsRead,
      seen: (body) => body,
      stored: price,
    },
  ];
}, TURN_WAIT_MS);

afterAll(async () => {
  await db.end();
  await api.stop();
});

// What a fresh state answers and keeps after the given calls, one per key.
async function run(write: Write, keys: (string | undefined)[]) {
  await write.reset();
  const answers: { body: unknown; status: number }[] = [];
  let previous: Record<string, unknown> | undefined;
  for (const key of keys) {
    const res = await write.call(key);
    answers.push({
      body: write.seen(res.body ?? {}, previous),
      status: res.status,
    });
    previous = res.body ?? {};
  }
  return { answers, stored: await write.stored() };
}

const KEYS: [string, string][] = [
  ['a 1-character key', 'k'],
  ['a 64-character key', 'k'.repeat(64)],
  ['a 65-character key', 'k'.repeat(65)],
  ['an empty value', ''],
  ['a random UUID', randomUUID()],
];

// In the order of the writes above.
const NAMES = [
  'PUT /notification-preferences',
  'POST /notifications/:id/read',
  'POST /notifications/read-all',
  'PATCH /garages/:garageId/prices/:priceId (visible)',
  'PATCH /garages/:garageId/prices/:priceId (range)',
  'PATCH /garages/:garageId/prices/:priceId (stale)',
].map((name, index) => [name, index] as [string, number]);

// @traces 1407-FR-001 1407-FR-002 1407-FR-003 1407-FR-004 1407-FR-007
describe.each(NAMES)('%s', (_, index) => {
  const write = () => writes[index];

  it('answers without the key as before', async () => {
    const { answers } = await run(write(), [undefined]);
    const { status } = answers[0];

    expect(status < 300 ? 'saved' : status).toBe(write().refused ?? 'saved');
  });

  it.each(KEYS)(
    'answers and stores with %s exactly what it does without one',
    async (_, key) => {
      const without = await run(write(), [undefined]);

      expect(await run(write(), [key])).toEqual(without);
    },
  );

  it('lands a repeat with the same key where a repeat without one lands', async () => {
    const key = randomUUID();
    const without = await run(write(), [undefined, undefined]);

    expect(await run(write(), [key, key])).toEqual(without);
  });
});
