import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

const api = apiBoot();
let app: INestApplication;
let db: Client;

type Role = 'admin' | 'driver' | 'garage';

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

const file = async (status = 'in_review') => {
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
  await db.query(
    'INSERT INTO verification_check (id, file_id, kind) SELECT gen_random_uuid(), $1, k FROM unnest(enum_range(NULL::verification_check_kind)) AS k',
    [id],
  );
  return { garage, id };
};

const checked = (id: string, kind: string, result: string) =>
  db.query(
    'UPDATE verification_check SET result = $3::verification_check_result WHERE file_id = $1 AND kind = $2::verification_check_kind',
    [id, kind, result],
  );

const refused = async (id: string) =>
  (
    await db.query(
      "SELECT actor_id, actor_role, new_value, garage_id FROM activity_log WHERE subject_id = $1 AND kind = 'verification_approval_refused' ORDER BY at",
      [id],
    )
  ).rows;

const statusOf = async (id: string) =>
  (await db.query('SELECT status FROM verification_file WHERE id = $1', [id]))
    .rows[0].status;

const post = (
  id: string,
  action: 'decision' | 'reopen',
  authorization?: string,
  body: object = {},
) => {
  const req = request(app.getHttpServer())
    .post(`/api/v1/admin/verification-files/${id}/${action}`)
    .send(body);
  return authorization ? req.set('Authorization', authorization) : req;
};

const setRule = (key: string, value: unknown) =>
  db.query('UPDATE platform_rule SET value = $2::jsonb WHERE key = $1', [
    key,
    JSON.stringify(value),
  ]);

let adminId: string;
let admin: string;

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
}, 120_000);

beforeEach(async () => {
  adminId = await account('admin', 'Ioana Popa');
  admin = bearer(adminId, 'admin');
});

afterEach(async () => {
  await setRule('skip_rar_check', false);
  await setRule('skip_manual_approval', false);
});

afterAll(async () => {
  await db.end();
  await api.stop();
});

// @traces 259-FR-005
describe('refused approvals written to the history', () => {
  it('writes the rar refusal alone when rar and caen are both not ok', async () => {
    const { id, garage } = await file();

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect([res.status, res.body.code]).toEqual([409, 'rar_check_required']);
    expect(await refused(id)).toEqual([
      {
        actor_id: adminId,
        actor_role: 'admin',
        garage_id: garage,
        new_value: 'rar_check_required',
      },
    ]);
  });

  it('writes one entry for each of twenty concurrent refused attempts', async () => {
    const { id } = await file();

    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        post(id, 'decision', admin, { decision: 'approved' }),
      ),
    );

    expect(answers.map((a) => a.status)).toEqual(Array(20).fill(409));
    expect(await refused(id)).toHaveLength(20);
  }, 20_000);

  it('writes an entry when a reopened file is refused again', async () => {
    const { id } = await file('rejected');
    await post(id, 'reopen', admin);

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect([res.status, res.body.code]).toEqual([409, 'rar_check_required']);
    expect(await refused(id)).toHaveLength(1);
    expect(await statusOf(id)).toBe('in_review');
  });

  it('writes an entry for an approval with a whitespace note, as for none', async () => {
    const { id } = await file();
    await checked(id, 'rar', 'ok');
    await checked(id, 'caen', 'ok');
    await checked(id, 'photos', 'failed');

    const res = await post(id, 'decision', admin, {
      decision: 'approved',
      note: '   ',
    });

    expect([res.status, res.body.code]).toEqual([422, 'note_required']);
    expect((await refused(id)).map((e) => e.new_value)).toEqual([
      'note_required',
    ]);
  });

  it('adds no entry for the approval that finally succeeds, nor for one after it', async () => {
    const { id } = await file();
    await checked(id, 'rar', 'ok');
    await checked(id, 'caen', 'ok');
    const body = { decision: 'approved', note: 'Checked' };
    const first = await post(id, 'decision', admin, body);

    const second = await post(id, 'decision', admin, body);
    expect(first.status).toBe(200);

    expect([second.status, second.body.code]).toEqual([
      409,
      'verification_transition_refused',
    ]);
    expect(await refused(id)).toHaveLength(0);
  });

  it('writes nothing when a request for more owes a note it lacks', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
    });

    expect([res.status, res.body.code]).toEqual([422, 'note_required']);
    expect(await refused(id)).toHaveLength(0);
  });

  it('writes nothing when a rejection is taken on a file whose rar is not ok', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'RAR missing',
      reason: 'rar',
    });

    expect(res.status).toBe(200);
    expect(await refused(id)).toHaveLength(0);
  });

  it('answers 404 for an unknown file and writes no entry', async () => {
    const id = randomUUID();

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect(res.status).toBe(404);
    expect(await refused(id)).toHaveLength(0);
  });

  it('answers 404 to a driver and writes no entry', async () => {
    const { id } = await file();
    const driver = bearer(await account('driver'), 'driver');

    const res = await post(id, 'decision', driver, { decision: 'approved' });

    expect(res.status).toBe(404);
    expect(await refused(id)).toHaveLength(0);
  });

  it('answers 401 with no token and writes no entry', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', undefined, {
      decision: 'approved',
    });

    expect(res.status).toBe(401);
    expect(await refused(id)).toHaveLength(0);
  });
});

// @traces 259-FR-006
describe('the file read after many refused attempts', () => {
  it('holds the newest 50 entries and counts all of them', async () => {
    const { id } = await file();
    await db.query(
      `INSERT INTO activity_log (id, at, action, actor_id, actor_role, actor_name, field, garage_id, kind, new_value, subject_id, subject_type)
       SELECT gen_random_uuid(), now() - (g || ' minutes')::interval, 'update', $2::uuid, 'admin', 'Ioana', 'decision', (SELECT garage_id FROM verification_file WHERE id = $1), 'verification_approval_refused', '"note_required"'::jsonb, $1, 'verification_file'
       FROM generate_series(1, 60) g`,
      [id, adminId],
    );

    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/verification-files/${id}`)
      .set('Authorization', admin);

    expect(res.body.timeline.entries).toHaveLength(50);
    expect(res.body.timeline.total).toBe(60);
    const times = res.body.timeline.entries.map((e: { at: string }) =>
      Date.parse(e.at),
    );
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

// @traces 259-FR-004
describe('the RAR switch stored on over the API', () => {
  it('approves with rar and caen not run, leaving no refusal', async () => {
    const { id } = await file();
    await setRule('skip_rar_check', true);
    await db.query(
      "INSERT INTO legal_document (id, verification_file_id, kind, pages) SELECT gen_random_uuid(), $1::uuid, k, ARRAY[k || '/1.pdf'] FROM unnest(ARRAY['onrc_certificate', 'rar_authorisation']::text[]) AS k",
      [id],
    );
    await db.query(
      "UPDATE verification_check SET result = 'ok' WHERE file_id = $1 AND kind NOT IN ('rar', 'caen')",
      [id],
    );

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect([res.status, res.body.file?.status]).toEqual([200, 'approved']);
    expect(await refused(id)).toHaveLength(0);
  });

  it('still refuses a missing note and writes the entry', async () => {
    const { id } = await file();
    await setRule('skip_rar_check', true);

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect([res.status, res.body.code]).toEqual([422, 'note_required']);
    expect((await refused(id)).map((e) => e.new_value)).toEqual([
      'note_required',
    ]);
    expect(await statusOf(id)).toBe('in_review');
  });

  it('approves with a note, though no check is ok', async () => {
    const { id } = await file();
    await setRule('skip_rar_check', true);

    const res = await post(id, 'decision', admin, {
      decision: 'approved',
      note: 'Checked by phone',
    });

    expect([res.status, res.body.file?.status]).toEqual([200, 'approved']);
    expect(await refused(id)).toHaveLength(0);
  });
});
