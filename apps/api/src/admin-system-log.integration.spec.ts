import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 298-FR-001 298-FR-003 298-FR-014

const api = apiBoot();
let app: INestApplication;
let db: Client;
let admin: string;
let adminId: string;

// The database is shared with the specs that write real entries, so these
// entries live in a far-off year that only this file reads and clears.
const FUTURE = '2100-01-01T00:00:00Z';
// 00:00 on 2 June 2100 in Bucharest (summer time, UTC+3).
const DAY_START = '2100-06-01T21:00:00.000Z';

const entry = async (
  at: string,
  extra: Partial<{
    id: string;
    kind: string;
    source: string;
    severity: string;
    message: string;
    context: object;
    count: number;
  }> = {},
) => {
  const row = {
    context: { version: 'v1' },
    count: 1,
    id: randomUUID(),
    kind: 'deploy',
    message: 'Deployed v1.',
    severity: 'info',
    source: 'worker',
    ...extra,
  };
  await db.query(
    `INSERT INTO system_log_entry
       (id, at, minute, kind, source, severity, fingerprint, message, context, count)
     VALUES ($1, $2, date_trunc('minute', $2::timestamptz), $3::system_log_kind,
       $4::system_log_source, $5::system_log_severity, $6, $7, $8, $9)`,
    [
      row.id,
      at,
      row.kind,
      row.source,
      row.severity,
      randomUUID(),
      row.message,
      JSON.stringify(row.context),
      row.count,
    ],
  );
  return row.id;
};

const list = (query: string, authorization = admin) =>
  request(app.getHttpServer())
    .get(`/api/v1/admin/system-log?${query}`)
    .set('Authorization', authorization);

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
}, 120_000);

beforeEach(async () => {
  await db.query('DELETE FROM system_log_entry WHERE at >= $1', [FUTURE]);
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `admin-${randomUUID()}` },
    name: 'admin',
    roles: ['admin'],
  });
  adminId = id;
  admin = `Bearer ${signAccessToken({ accountId: id, role: 'admin' } as never, TEST_TOKEN_SECRET, Date.now())}`;
});

afterAll(async () => {
  await db.query('DELETE FROM system_log_entry WHERE at >= $1', [FUTURE]);
  await db.end();
  await api.stop();
});

describe('GET /admin/system-log', () => {
  it("answers today's entries in Bucharest, leaving out yesterday's last minute", async () => {
    await entry('2100-06-01T20:59:00Z');
    const early = await entry('2100-06-01T21:01:00Z');

    const res = await list(`from=${DAY_START}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([early]);
  });

  it('answers newest first, entries of the same time by id descending', async () => {
    const older = await entry('2100-06-02T07:00:00Z');
    const [low, high] = [randomUUID(), randomUUID()].sort();
    await entry('2100-06-02T08:00:00.000Z', { id: low });
    await entry('2100-06-02T08:00:00.000Z', { id: high });
    const newest = await entry('2100-06-02T09:00:00Z');

    const res = await list(`from=${DAY_START}`);

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      newest,
      high,
      low,
      older,
    ]);
  });

  it('answers the newest 20 by default and fewer when asked', async () => {
    const ids: string[] = [];
    for (let n = 0; n < 22; n++) {
      ids.push(await entry(`2100-06-02T10:${String(n).padStart(2, '0')}:00Z`));
    }
    const newest = ids.reverse();

    const all = await list(`from=${DAY_START}`);
    const five = await list(`from=${DAY_START}&limit=5`);

    expect(all.body.items.map((i: { id: string }) => i.id)).toEqual(
      newest.slice(0, 20),
    );
    expect(five.body.items.map((i: { id: string }) => i.id)).toEqual(
      newest.slice(0, 5),
    );
  });

  it('answers each entry with its fields as stored', async () => {
    const id = await entry('2100-06-02T07:40:12.512Z', {
      context: {
        figure: 'latency_ms',
        latency_ms: 1900,
        limit: 1500,
        state: 'amber',
      },
      count: 3,
      kind: 'status_changed',
      message: 'Maps: response time went above 1.5 s.',
      severity: 'warning',
      source: 'maps',
    });

    const res = await list(`from=${DAY_START}`);

    expect(res.body.items).toEqual([
      {
        at: '2100-06-02T07:40:12.512Z',
        context: {
          figure: 'latency_ms',
          latency_ms: 1900,
          limit: 1500,
          state: 'amber',
        },
        count: 3,
        id,
        kind: 'status_changed',
        message: 'Maps: response time went above 1.5 s.',
        severity: 'warning',
        source: 'maps',
      },
    ]);
  });

  // @traces 298-FR-012
  it('writes no log entry and no audit row when read', async () => {
    await entry('2100-06-02T07:00:00Z');
    // Other specs write to both tables at the same time, so only what this
    // read could have written is counted.
    const counts = async () =>
      (
        await db.query(
          `SELECT (SELECT count(*) FROM system_log_entry
                    WHERE context->>'route' LIKE '%system-log%') AS log,
                  (SELECT count(*) FROM activity_log WHERE actor_id = $1) AS audit`,
          [adminId],
        )
      ).rows[0];
    const before = await counts();

    await list(`from=${DAY_START}`);

    expect(await counts()).toEqual(before);
  });

  it.each([
    ['no from', 'limit=5'],
    ['a calendar day as from', 'from=2100-06-02'],
    ['a time without a zone', 'from=2100-06-02T00:00:00'],
    ['a limit of 0', `from=${DAY_START}&limit=0`],
    ['a limit of 21', `from=${DAY_START}&limit=21`],
    ['a limit that is not a whole number', `from=${DAY_START}&limit=1.5`],
  ])('refuses %s with validation_failed', async (_, query) => {
    const res = await list(query);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });
});
