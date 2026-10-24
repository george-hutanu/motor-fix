import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 413-FR-005 413-FR-013 413-FR-014

const api = apiBoot();
let app: INestApplication;
let db: Client;

type Role = 'admin' | 'driver' | 'garage' | 'mechanic';

const account = async (role: Role, name: string = role) =>
  (
    await app.get(AccountsService).createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: `${role}-${randomUUID()}` },
      name,
      roles: [role],
    })
  ).id;

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role } as never, TEST_TOKEN_SECRET, Date.now())}`;

const file = async (status = 'submitted') => {
  const garage = randomUUID();
  const id = randomUUID();
  await db.query(
    "INSERT INTO garage (id, name, slug) VALUES ($1, 'Atelier Dinamo', $2)",
    [garage, `g-${garage}`],
  );
  await db.query(
    'INSERT INTO verification_file (id, garage_id, status) VALUES ($1, $2, $3::verification_file_status)',
    [id, garage, status],
  );
  return { garage, id };
};

const presence = (
  method: 'put' | 'delete',
  id: string,
  authorization?: string,
) => {
  const req = request(app.getHttpServer())[method](
    `/api/v1/admin/verification-files/${id}/presence`,
  );
  return authorization ? req.set('Authorization', authorization) : req;
};

const historyOf = async (subjectId: string) =>
  Number(
    (
      await db.query(
        'SELECT count(*) FROM activity_log WHERE subject_id = $1 OR garage_id = $1',
        [subjectId],
      )
    ).rows[0].count,
  );

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
}, 120_000);

afterAll(async () => {
  await db.end();
  await api.stop();
});

describe('PUT /admin/verification-files/:id/presence', () => {
  it('answers the other admins with the file open, by short name and start', async () => {
    const { id } = await file();
    const ana = bearer(await account('admin', 'Ana Maria Popescu'), 'admin');
    const mihai = bearer(await account('admin', 'Mihai Ionescu'), 'admin');

    const first = await presence('put', id, ana);
    const second = await presence('put', id, mihai);

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ others: [] });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      others: [{ name: 'Ana P.', since: expect.any(String) }],
    });
    expect(new Date(second.body.others[0].since).toISOString()).toBe(
      second.body.others[0].since,
    );
  });

  it.each(['submitted', 'in_review', 'more_requested', 'approved', 'rejected'])(
    'accepts a file that is %s',
    async (status) => {
      const { id } = await file(status);
      const admin = bearer(await account('admin'), 'admin');

      expect((await presence('put', id, admin)).status).toBe(200);
    },
  );

  it.each(['driver', 'garage', 'mechanic'] as const)(
    'answers 404 to a %s',
    async (role) => {
      const { id } = await file();

      const res = await presence('put', id, bearer(await account(role), role));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    },
  );

  it('answers 404 for an unknown or malformed id', async () => {
    const admin = bearer(await account('admin'), 'admin');

    expect((await presence('put', randomUUID(), admin)).status).toBe(404);
    expect((await presence('put', 'not-a-file', admin)).status).toBe(404);
  });

  it('answers 401 sign_in_required with no session', async () => {
    const { id } = await file();

    const res = await presence('put', id);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('writes nothing to the history', async () => {
    const { garage, id } = await file();
    const admin = bearer(await account('admin'), 'admin');

    await presence('put', id, admin);
    await presence('delete', id, admin);

    expect(await historyOf(id)).toBe(0);
    expect(await historyOf(garage)).toBe(0);
  });
});

describe('DELETE /admin/verification-files/:id/presence', () => {
  it('answers 204 and the admin is gone for the others at once', async () => {
    const { id } = await file();
    const ana = bearer(await account('admin', 'Ana Popescu'), 'admin');
    const mihai = bearer(await account('admin', 'Mihai Ionescu'), 'admin');
    await presence('put', id, ana);

    const left = await presence('delete', id, ana);

    expect(left.status).toBe(204);
    expect(left.text).toBe('');
    expect((await presence('put', id, mihai)).body).toEqual({ others: [] });
  });

  it('answers 204 when the admin had no entry', async () => {
    const { id } = await file();
    const admin = bearer(await account('admin'), 'admin');

    expect((await presence('delete', id, admin)).status).toBe(204);
  });

  it('answers 404 to a driver and 401 with no session', async () => {
    const { id } = await file();

    const driver = await presence(
      'delete',
      id,
      bearer(await account('driver'), 'driver'),
    );

    expect(driver.status).toBe(404);
    expect((await presence('delete', id)).status).toBe(401);
  });
});
