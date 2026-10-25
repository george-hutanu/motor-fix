import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import { TURN_WAIT_MS } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 413-FR-002 413-FR-003 413-FR-004 413-FR-005

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

const token = (accountId: string, role: Role, at = Date.now()) =>
  signAccessToken({ accountId, role } as never, TEST_TOKEN_SECRET, at);
const bearer = (accountId: string, role: Role) =>
  `Bearer ${token(accountId, role)}`;

const file = async () => {
  const garage = randomUUID();
  const id = randomUUID();
  await db.query(
    "INSERT INTO garage (id, name, slug) VALUES ($1, 'Atelier Dinamo', $2)",
    [garage, `g-${garage}`],
  );
  await db.query(
    "INSERT INTO verification_file (id, garage_id, status) VALUES ($1, $2, 'submitted')",
    [id, garage],
  );
  return id;
};

const url = (id: string) => `/api/v1/admin/verification-files/${id}/presence`;
const put = (id: string, authorization?: string) => {
  const req = request(app.getHttpServer()).put(url(id));
  return authorization ? req.set('Authorization', authorization) : req;
};
const del = (id: string, authorization?: string) => {
  const req = request(app.getHttpServer()).delete(url(id));
  return authorization ? req.set('Authorization', authorization) : req;
};

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
}, TURN_WAIT_MS);

afterAll(async () => {
  await db.end();
  await api.stop();
});

describe('presence routes with hostile credentials', () => {
  it.each([
    ['a bare scheme', 'Bearer'],
    ['an empty token', 'Bearer '],
    ['garbage', 'Bearer not.a.token'],
    ['another scheme', 'Basic YWRtaW46YWRtaW4='],
    ['a token without its scheme', 'abc'],
  ])('answers 401 sign_in_required for %s', async (_title, header) => {
    const id = await file();

    for (const call of [put, del]) {
      const res = await call(id, header);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    }
  });

  it('answers 401 before it looks at the file for a visitor on an unknown id', async () => {
    const res = await put(randomUUID());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 401 to a token signed with another secret', async () => {
    const id = await file();
    const forged = signAccessToken(
      { accountId: await account('admin'), role: 'admin' } as never,
      'another-secret-entirely-0123456789',
      Date.now(),
    );

    expect((await put(id, `Bearer ${forged}`)).status).toBe(401);
  });

  it('answers 401 to a token issued long ago', async () => {
    const id = await file();
    const old = token(
      await account('admin'),
      'admin',
      Date.now() - 365 * 24 * 3_600_000,
    );

    expect((await put(id, `Bearer ${old}`)).status).toBe(401);
  });
});

describe('presence routes with hostile ids', () => {
  it.each([
    ['not a uuid', 'abc'],
    ['a dotted path', '..'],
    ['an encoded dotted path', '%2e%2e'],
    ['a sql fragment', "1'%20OR%20'1'='1"],
    ['null', 'null'],
    ['a uuid with a suffix', `${randomUUID()}x`],
    ['an unknown uuid', randomUUID()],
    ['the nil uuid', '00000000-0000-0000-0000-000000000000'],
  ])('answers 404 not_found to an admin for %s', async (_title, id) => {
    const admin = bearer(await account('admin'), 'admin');

    for (const call of [put, del]) {
      const res = await call(id, admin);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
  });

  it('accepts the upper case spelling of a file id', async () => {
    const id = await file();
    const admin = bearer(await account('admin'), 'admin');

    const res = await put(id.toUpperCase(), admin);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ others: [] });
  });
});

describe('presence routes with unexpected requests', () => {
  it('ignores a body on the heartbeat and keeps the name from the account', async () => {
    const id = await file();
    const ana = bearer(await account('admin', 'Ana Popescu'), 'admin');
    const mihai = bearer(await account('admin', 'Mihai Ionescu'), 'admin');

    const first = await put(id, ana).send({
      name: 'Hacker H.',
      since: '1999-01-01T00:00:00.000Z',
    });
    const second = await put(id, mihai);

    expect(first.status).toBe(200);
    expect(second.body.others).toEqual([
      { name: 'Ana P.', since: expect.not.stringContaining('1999') },
    ]);
  });

  it('answers 204 with an empty body to a leave carrying a body', async () => {
    const id = await file();
    const ana = bearer(await account('admin', 'Ana Popescu'), 'admin');
    await put(id, ana);

    const res = await del(id, ana).send({ anything: true });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it.each(['get', 'post', 'patch'] as const)(
    'answers 404 or 405 to %s on the presence path, never a presence list',
    async (method) => {
      const id = await file();
      const admin = bearer(await account('admin'), 'admin');

      const res = await request(app.getHttpServer())
        [method](url(id))
        .set('Authorization', admin);

      expect([404, 405]).toContain(res.status);
      expect(res.body.others).toBeUndefined();
    },
  );

  it('answers the same on a second leave', async () => {
    const id = await file();
    const ana = bearer(await account('admin', 'Ana Popescu'), 'admin');
    await put(id, ana);

    expect((await del(id, ana)).status).toBe(204);
    expect((await del(id, ana)).status).toBe(204);
  });
});

describe('presence routes and who is an admin', () => {
  it.each(['driver', 'garage', 'mechanic'] as const)(
    'lets a %s neither appear to the admins nor remove one',
    async (role) => {
      const id = await file();
      const ana = bearer(await account('admin', 'Ana Popescu'), 'admin');
      const mihai = bearer(await account('admin', 'Mihai Ionescu'), 'admin');
      const outsider = bearer(await account(role, 'Eve Outsider'), role);
      await put(id, ana);

      const heartbeat = await put(id, outsider);
      const leave = await del(id, outsider);
      const seen = await put(id, mihai);

      expect(heartbeat.status).toBe(404);
      expect(leave.status).toBe(404);
      expect(seen.body.others).toEqual([
        { name: 'Ana P.', since: expect.any(String) },
      ]);
    },
  );

  it('never lists the caller to herself, whichever token she sends', async () => {
    const id = await file();
    const accountId = await account('admin', 'Ana Popescu');

    await put(id, bearer(accountId, 'admin'));
    const again = await put(id, bearer(accountId, 'admin'));

    expect(again.body).toEqual({ others: [] });
  });

  it('serves twenty admins at once, each seeing the other nineteen at most', async () => {
    const id = await file();
    const admins = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        account('admin', `Admin Numero${i}`),
      ),
    );

    const answers = await Promise.all(
      admins.map((admin) => put(id, bearer(admin, 'admin'))),
    );
    const final = await Promise.all(
      admins.map((admin) => put(id, bearer(admin, 'admin'))),
    );

    expect(answers.map((res) => res.status)).toEqual(Array(20).fill(200));
    expect(final.map((res) => res.body.others.length)).toEqual(
      Array(20).fill(19),
    );
  });
});
