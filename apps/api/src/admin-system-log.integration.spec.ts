import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 298-FR-001 298-FR-003 298-FR-014
// @traces 299-FR-001 299-FR-003 299-FR-004 299-FR-005 299-FR-018

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
    ['a limit of 51', `from=${DAY_START}&limit=51`],
    ['a limit that is not a whole number', `from=${DAY_START}&limit=1.5`],
  ])('refuses %s with validation_failed', async (_, query) => {
    const res = await list(query);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });
});

const ids = (res: { body: { items: { id: string }[] } }) =>
  res.body.items.map((item) => item.id);
const NEXT_DAY = '2100-06-02T21:00:00.000Z';

describe('GET /admin/system-log narrowed and paged', () => {
  it('answers a limit of 20 as before, with the next page cursor', async () => {
    for (let n = 0; n < 21; n++) {
      await entry(`2100-06-02T11:${String(n).padStart(2, '0')}:00Z`);
    }

    const res = await list(`from=${DAY_START}&limit=20`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reads the next page from the cursor and ends with no cursor', async () => {
    const written: string[] = [];
    for (let n = 0; n < 55; n++) {
      written.push(
        await entry(`2100-06-02T12:${String(n).padStart(2, '0')}:00Z`),
      );
    }

    const first = await list(`from=${DAY_START}&limit=50`);
    const second = await list(
      `from=${DAY_START}&limit=50&cursor=${first.body.nextCursor}`,
    );

    expect([...ids(first), ...ids(second)]).toEqual(written.reverse());
    expect(second.body.nextCursor).toBeNull();
  });

  it('answers a null cursor on the last page', async () => {
    await entry('2100-06-02T07:00:00Z');

    expect((await list(`from=${DAY_START}`)).body).toMatchObject({
      nextCursor: null,
    });
  });

  it('leaves out the entries at or after the end', async () => {
    const kept = await entry('2100-06-02T20:59:59Z');
    await entry(NEXT_DAY);

    expect(ids(await list(`from=${DAY_START}&to=${NEXT_DAY}`))).toEqual([kept]);
  });

  it('accepts the widest range the date pickers allow', async () => {
    const day = 24 * 3_600_000;
    const from = new Date(Date.now() - 90 * day).toISOString();
    const to = new Date(Date.now() + day).toISOString();

    const res = await list(`from=${from}&to=${to}&limit=50`);

    expect(res.status).toBe(200);
  });

  it('narrows by repeated kinds, a severity and a source together', async () => {
    const failed = await entry('2100-06-02T08:00:00Z', {
      kind: 'backup_failed',
      severity: 'error',
      source: 'backup',
    });
    await entry('2100-06-02T09:00:00Z', {
      kind: 'backup_completed',
      severity: 'info',
      source: 'backup',
    });
    await entry('2100-06-02T10:00:00Z', {
      kind: 'job_failed',
      severity: 'error',
      source: 'worker',
    });

    const res = await list(
      `from=${DAY_START}&kind=backup_completed&kind=backup_failed&severity=error&source=backup`,
    );

    expect(ids(res)).toEqual([failed]);
  });

  it('finds the text ignoring case and diacritics', async () => {
    const late = await entry('2100-06-02T08:00:00Z', {
      message: 'Hartă: răspuns târziu.',
      source: 'maps',
    });
    await entry('2100-06-02T09:00:00Z', { message: 'Deployed v2.' });

    expect(ids(await list(`from=${DAY_START}&q=TARZIU`))).toEqual([late]);
  });

  it('writes no log entry and keeps the search text out of every entry', async () => {
    const before = await db.query(
      `SELECT count(*) FROM system_log_entry WHERE message LIKE '%zzsecretzz%'
         OR context::text LIKE '%zzsecretzz%'`,
    );

    await list(`from=${DAY_START}&q=zzsecretzz`);

    const after = await db.query(
      `SELECT count(*) FROM system_log_entry WHERE message LIKE '%zzsecretzz%'
         OR context::text LIKE '%zzsecretzz%'`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  it.each([
    ['an end not after the start', `from=${DAY_START}&to=${DAY_START}`],
    ['an end before the start', `from=${NEXT_DAY}&to=${DAY_START}`],
    ['a calendar day as the end', `from=${DAY_START}&to=2100-06-03`],
    ['no start with an end', `to=${NEXT_DAY}`],
    ['words as a cursor', `from=${DAY_START}&cursor=not-a-cursor`],
    [
      'a cursor of two words',
      `from=${DAY_START}&cursor=${Buffer.from('x|y').toString('base64url')}`,
    ],
    ['an unknown kind', `from=${DAY_START}&kind=backup`],
    ['an unknown severity', `from=${DAY_START}&severity=fatal`],
    ['an unknown source', `from=${DAY_START}&source=mailgun`],
    ['a search of one character', `from=${DAY_START}&q=a`],
    ['one letter between spaces', `from=${DAY_START}&q=%20%20a%20%20`],
    ['a search of 101 characters', `from=${DAY_START}&q=${'a'.repeat(101)}`],
  ])('refuses %s with validation_failed', async (_, query) => {
    const res = await list(query);

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
  });

  it.each([
    ['2', 'ab'],
    ['100', 'a'.repeat(100)],
  ])('accepts a search of %s characters', async (_, q) => {
    expect((await list(`from=${DAY_START}&q=${q}`)).status).toBe(200);
  });

  const NARROWED = `from=${DAY_START}&to=${NEXT_DAY}&kind=deploy&severity=info&source=worker&q=deploy&limit=50`;

  it.each(['receptionist', 'mechanic', 'garage', 'driver'] as const)(
    'answers not_found to a %s, with or without the narrowing',
    async (role) => {
      const { id } = await app.get(AccountsService).createAccount({
        consent: CURRENT_CONSENT,
        identity: { method: 'google', subject: `${role}-${randomUUID()}` },
        name: role,
        roles: [role],
      });
      const bearer = `Bearer ${signAccessToken({ accountId: id, role } as never, TEST_TOKEN_SECRET, Date.now())}`;

      const plain = await list(`from=${DAY_START}`, bearer);
      const narrowed = await list(NARROWED, bearer);

      expect([plain.status, narrowed.status]).toEqual([404, 404]);
      expect(narrowed.body.code).toBe('not_found');
    },
  );

  it('answers sign_in_required to a visitor, with or without the narrowing', async () => {
    const plain = await request(app.getHttpServer()).get(
      `/api/v1/admin/system-log?from=${DAY_START}`,
    );
    const narrowed = await request(app.getHttpServer()).get(
      `/api/v1/admin/system-log?${NARROWED}`,
    );

    expect([plain.status, narrowed.status]).toEqual([401, 401]);
    expect(narrowed.body.code).toBe('sign_in_required');
  });

  it('answers account_suspended to a suspended admin, with or without the narrowing', async () => {
    await db.query("UPDATE account SET status = 'suspended' WHERE id = $1", [
      adminId,
    ]);

    const plain = await list(`from=${DAY_START}`);
    const narrowed = await list(NARROWED);

    expect([plain.status, narrowed.status]).toEqual([403, 403]);
    expect(narrowed.body.code).toBe('account_suspended');
  });
});
