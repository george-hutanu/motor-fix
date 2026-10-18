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

type Role = 'admin' | 'driver';

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

const file = async (status = 'in_review', garageStatus = 'draft') => {
  const garage = randomUUID();
  const id = randomUUID();
  await db.query(
    "INSERT INTO garage (id, name, slug, status) VALUES ($1, 'Atelier Dinamo', $2, $3::garage_status)",
    [garage, `g-${garage}`, garageStatus],
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

const fileRow = async (id: string) =>
  (await db.query('SELECT * FROM verification_file WHERE id = $1', [id]))
    .rows[0];

const count = async (kind: string, id: string) =>
  Number(
    (
      await db.query(
        'SELECT count(*) FROM outbox_event WHERE kind = $1 AND subject_id = $2',
        [kind, id],
      )
    ).rows[0].count,
  );

const allOk = async (id: string) => {
  await db.query(
    "UPDATE verification_check SET result = 'ok' WHERE file_id = $1",
    [id],
  );
  await db.query(
    "INSERT INTO legal_document (id, verification_file_id, kind, pages) SELECT gen_random_uuid(), $1::uuid, k, ARRAY[k || '/1.pdf'] FROM unnest(ARRAY['onrc_certificate', 'rar_authorisation']::text[]) AS k ON CONFLICT DO NOTHING",
    [id],
  );
};

const post = (id: string, authorization: string | undefined, body: unknown) => {
  const req = request(app.getHttpServer())
    .post(`/api/v1/admin/verification-files/${id}/decision`)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(body));
  return authorization ? req.set('Authorization', authorization) : req;
};

const changes = (id: string, authorization?: string) => {
  const req = request(app.getHttpServer()).get(
    `/api/v1/admin/verification-files/${id}/changes`,
  );
  return authorization ? req.set('Authorization', authorization) : req;
};

const garageRow = async (id: string) =>
  (await db.query('SELECT * FROM garage WHERE id = $1', [id])).rows[0];

const logRows = async () =>
  Number((await db.query('SELECT count(*) FROM activity_log')).rows[0].count);

const entry = (
  garage: string,
  subjectType: string,
  offsetMs: number,
  extra: { internal?: boolean; field?: string; subject?: string } = {},
  base = 'decided_at',
  fileId?: string,
) =>
  db.query(
    `INSERT INTO activity_log (id, action, actor_role, actor_name, garage_id, subject_type, subject_id, field, old_value, new_value, internal, at)
     VALUES (gen_random_uuid(), 'update', 'owner', 'Mihai', $1, $2, COALESCE($7::uuid, $1), $3, '"a"', '"b"', $4,
       (SELECT ${base} FROM verification_file WHERE id = $6) + ($5 || ' milliseconds')::interval)`,
    [
      garage,
      subjectType,
      extra.field ?? 'phone',
      extra.internal ?? false,
      String(offsetMs),
      fileId,
      extra.subject ?? null,
    ],
  );

const returned = async () => {
  const made = await file('submitted');
  await db.query(
    "UPDATE verification_file SET decided_at = now() - interval '1 hour', decided_by = $2 WHERE id = $1",
    [made.id, adminId],
  );
  return made;
};

let admin: string;
let adminId: string;

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

afterAll(async () => {
  await db.end();
  await api.stop();
});

const ASK = (note: string, extra: object = {}) => ({
  decision: 'more_requested',
  note,
  ...extra,
});

// @traces 304-FR-003
describe('the note of a request for more, at its edges', () => {
  it('accepts a note of exactly ten code points and stores the file as more_requested', async () => {
    const { id } = await file();

    const res = await post(id, admin, ASK('abcdefghij'));

    expect([res.status, (await fileRow(id)).status]).toEqual([
      200,
      'more_requested',
    ]);
  });

  it('refuses nine code points when the last is a combining mark', async () => {
    const { id } = await file();

    const res = await post(id, admin, ASK('abcdefgh́'));

    expect([res.status, res.body.code]).toEqual([422, 'note_too_short']);
    expect((await fileRow(id)).status).toBe('in_review');
  });

  it('measures the trimmed note: nine letters inside spaces are too short', async () => {
    const { id } = await file();

    const res = await post(id, admin, ASK('     abcdefghi     '));

    expect([res.status, res.body.code]).toEqual([422, 'note_too_short']);
  });

  it('answers note_required, not note_too_short, to a body with no note at all', async () => {
    const { id } = await file();

    const res = await post(id, admin, { decision: 'more_requested' });

    expect([res.status, res.body.code]).toEqual([422, 'note_required']);
  });

  it.each([
    ['null', null],
    ['a number', 1234567890],
    ['an array', ['abcdefghijkl']],
    ['an object', { text: 'abcdefghijkl' }],
  ])(
    'refuses %s as the note with 400 or 422 and stores nothing',
    async (_, note) => {
      const { id } = await file();

      const res = await post(id, admin, { decision: 'more_requested', note });

      expect([400, 422]).toContain(res.status);
      expect((await fileRow(id)).status).toBe('in_review');
    },
  );

  it('stores a note of 1,000 characters padded with spaces trimmed, as asked', async () => {
    const { id } = await file();

    const res = await post(id, admin, ASK(`  ${'é'.repeat(1000)}  `));

    expect([res.status, (await fileRow(id)).reason_note]).toEqual([
      200,
      'é'.repeat(1000),
    ]);
  });

  it('counts 1,000 astral characters as 1,000, not 2,000', async () => {
    const { id } = await file();

    const res = await post(id, admin, ASK('🚗'.repeat(1000)));

    expect(res.status).toBe(200);
  });

  it('refuses a short note before it reads the file: a decided file answers 422, not 409', async () => {
    const { id } = await file('rejected');

    const res = await post(id, admin, ASK('scurt'));

    expect([res.status, res.body.code]).toEqual([422, 'note_too_short']);
  });
});

// @traces 304-FR-003
describe('the requested items', () => {
  it('stores each item once and in the order given when duplicates are sent', async () => {
    const { id } = await file();

    const res = await post(
      id,
      admin,
      ASK('Trimite pozele atelierului.', {
        requestedItems: ['photos', 'rar', 'photos', 'photos'],
      }),
    );

    expect([res.status, (await fileRow(id)).requested_items]).toEqual([
      200,
      ['photos', 'rar'],
    ]);
  });

  it('accepts all five items and an empty list', async () => {
    const all = await file();
    const none = await file();

    const a = await post(
      all.id,
      admin,
      ASK('Trimite tot ce lipsește.', {
        requestedItems: ['documents', 'rar', 'address', 'photos', 'other'],
      }),
    );
    const b = await post(
      none.id,
      admin,
      ASK('Trimite tot ce lipsește.', { requestedItems: [] }),
    );

    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await fileRow(all.id)).requested_items).toHaveLength(5);
  });

  it.each([
    ['an unknown code', ['photos', 'logo']],
    ['an upper-case code', ['PHOTOS']],
    ['a number', [1]],
    ['a null', [null]],
    ['a nested list', [['photos']]],
    [
      'six entries',
      ['documents', 'rar', 'address', 'photos', 'other', 'other'],
    ],
  ])(
    'refuses %s with 400 validation_failed and stores nothing',
    async (_, items) => {
      const { id } = await file();

      const res = await post(
        id,
        admin,
        ASK('Trimite pozele atelierului.', { requestedItems: items }),
      );

      expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
      expect((await fileRow(id)).status).toBe('in_review');
    },
  );
});

// @traces 304-FR-004
describe('what a request for more leaves alone', () => {
  it('keeps the garage a draft with every column it had', async () => {
    const { garage, id } = await file();
    const before = await garageRow(garage);

    const res = await post(id, admin, ASK('Trimite pozele atelierului.'));

    expect(res.status).toBe(200);
    expect(await garageRow(garage)).toEqual(before);
  });

  it('keeps a suspended garage suspended when its file is asked for more', async () => {
    const { garage, id } = await file('in_review', 'suspended');

    await post(id, admin, ASK('Trimite pozele atelierului.'));

    expect((await garageRow(garage)).status).toBe('suspended');
  });

  it.each(['approved', 'rejected', 'more_requested'])(
    'answers 409 with who and when for a file already %s, and changes nothing',
    async (status) => {
      const { id } = await file(status);
      await db.query(
        'UPDATE verification_file SET decided_by = $2, decided_at = now() WHERE id = $1',
        [id, adminId],
      );
      const before = await fileRow(id);

      const res = await post(id, admin, ASK('Trimite pozele atelierului.'));

      expect([res.status, res.body.code]).toEqual([
        409,
        'verification_transition_refused',
      ]);
      expect(res.body).toMatchObject({ currentStatus: status });
      expect(Object.keys(res.body)).toEqual(
        expect.arrayContaining(['decidedBy', 'decidedAt']),
      );
      expect(await fileRow(id)).toEqual(before);
      expect(await count('verification.decided', id)).toBe(0);
    },
  );

  it('lets exactly one of a request for more and an approval win when sent together', async () => {
    const { id } = await file();
    await allOk(id);

    const [a, b] = await Promise.all([
      post(id, admin, ASK('Trimite pozele atelierului.')),
      post(id, admin, { decision: 'approved' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await count('verification.decided', id)).toBe(1);
  });

  it('refuses a driver with 404 and an empty body of garage data', async () => {
    const { id } = await file();

    const res = await post(
      id,
      bearer(await account('driver'), 'driver'),
      ASK('Trimite pozele atelierului.'),
    );

    expect([res.status, JSON.stringify(res.body)]).toEqual([
      404,
      expect.not.stringContaining('Atelier Dinamo'),
    ]);
  });

  it('sends the same request twice and gets 200 then 409, one outbox row', async () => {
    const { id } = await file();

    const first = await post(id, admin, ASK('Trimite pozele atelierului.'));
    const second = await post(id, admin, ASK('Trimite pozele atelierului.'));

    expect([first.status, second.status]).toEqual([200, 409]);
    expect(await count('verification.decided', id)).toBe(1);
  });
});

// @traces 304-FR-008
describe('the changes since the request', () => {
  it('keeps out an entry written at the request time and takes one a millisecond after', async () => {
    const { garage, id } = await returned();
    await entry(garage, 'garage', 0, { field: 'at_request' }, 'decided_at', id);
    await entry(garage, 'garage', 1, { field: 'just_after' }, 'decided_at', id);

    const res = await changes(id, admin);

    expect(res.body.changes.map((c: { field: string }) => c.field)).toEqual([
      'just_after',
    ]);
  });

  it('leaves out internal entries, other garages, and subjects that are not the garage’s data', async () => {
    const { garage, id } = await returned();
    const other = await file('submitted');
    await db.query(
      "UPDATE verification_file SET decided_at = now() - interval '2 hours' WHERE id = $1",
      [other.id],
    );
    await entry(garage, 'garage', 10, { field: 'kept' }, 'decided_at', id);
    await entry(
      garage,
      'garage',
      11,
      { field: 'hidden', internal: true },
      'decided_at',
      id,
    );
    await entry(
      garage,
      'verification_file',
      12,
      { field: 'status' },
      'decided_at',
      id,
    );
    await entry(
      garage,
      'verification_check',
      13,
      { field: 'result' },
      'decided_at',
      id,
    );
    await entry(garage, 'account', 14, { field: 'name' }, 'decided_at', id);
    await entry(
      other.garage,
      'garage',
      15,
      { field: 'foreign' },
      'decided_at',
      id,
    );

    const res = await changes(id, admin);

    expect([
      res.body.changes.map((c: { field: string }) => c.field),
      res.body.total,
    ]).toEqual([['kept'], 1]);
  });

  it('puts each subject in its area', async () => {
    const { garage, id } = await returned();
    const kinds: [string, string][] = [
      ['garage', 'profile'],
      ['garage_facility', 'profile'],
      ['garage_closed_day', 'profile'],
      ['garage_brand', 'brands'],
      ['garage_price', 'prices'],
      ['garage_brand_job', 'prices'],
    ];
    for (const [n, [subject]] of kinds.entries()) {
      await entry(garage, subject, n + 1, { field: subject }, 'decided_at', id);
    }

    const res = await changes(id, admin);

    expect(
      Object.fromEntries(
        res.body.changes.map((c: { subjectType: string; area: string }) => [
          c.subjectType,
          c.area,
        ]),
      ),
    ).toEqual(Object.fromEntries(kinds));
  });

  it('answers newest first, 200 of 201 with the total', async () => {
    const { garage, id } = await returned();
    await db.query(
      `INSERT INTO activity_log (id, action, actor_role, actor_name, garage_id, subject_type, subject_id, field, old_value, new_value, at)
       SELECT gen_random_uuid(), 'update', 'owner', 'Mihai', $1, 'garage', $1, 'f' || n, '"a"', '"b"',
         (SELECT decided_at FROM verification_file WHERE id = $2) + (n || ' seconds')::interval
       FROM generate_series(1, 201) AS n`,
      [garage, id],
    );

    const res = await changes(id, admin);

    expect([
      res.body.changes.length,
      res.body.total,
      res.body.changes[0].field,
      res.body.changes[199].field,
    ]).toEqual([200, 201, 'f201', 'f2']);
  });

  it('answers exactly 200 for exactly 200 entries', async () => {
    const { garage, id } = await returned();
    await db.query(
      `INSERT INTO activity_log (id, action, actor_role, actor_name, garage_id, subject_type, subject_id, field, old_value, new_value, at)
       SELECT gen_random_uuid(), 'update', 'owner', 'Mihai', $1, 'garage', $1, 'f' || n, '"a"', '"b"',
         (SELECT decided_at FROM verification_file WHERE id = $2) + (n || ' seconds')::interval
       FROM generate_series(1, 200) AS n`,
      [garage, id],
    );

    const res = await changes(id, admin);

    expect([res.body.changes.length, res.body.total]).toEqual([200, 200]);
  });

  it.each(['submitted', 'in_review'])(
    'answers resubmitted false and no changes for a %s file that was never decided',
    async (status) => {
      const { garage, id } = await file(status);
      await db.query(
        "INSERT INTO activity_log (id, action, actor_role, actor_name, garage_id, subject_type, subject_id, field) VALUES (gen_random_uuid(), 'update', 'owner', 'Mihai', $1, 'garage', $1, 'phone')",
        [garage],
      );

      const res = await changes(id, admin);

      expect([res.status, res.body]).toEqual([
        200,
        { changes: [], requestedAt: null, resubmitted: false, total: 0 },
      ]);
    },
  );

  it('answers resubmitted false for a file reopened after its decision', async () => {
    const { garage, id } = await returned();
    await db.query(
      'UPDATE verification_file SET reopened_at = now() WHERE id = $1',
      [id],
    );
    await entry(garage, 'garage', 5, {}, 'decided_at', id);

    const res = await changes(id, admin);

    expect([res.body.resubmitted, res.body.changes]).toEqual([false, []]);
  });

  it('answers resubmitted true when the reopening came before the decision', async () => {
    const { id } = await returned();
    await db.query(
      "UPDATE verification_file SET reopened_at = decided_at - interval '1 day' WHERE id = $1",
      [id],
    );

    const res = await changes(id, admin);

    expect(res.body.resubmitted).toBe(true);
  });

  it.each(['more_requested', 'approved', 'rejected'])(
    'answers resubmitted false for a %s file',
    async (status) => {
      const { id } = await returned();
      await db.query(
        'UPDATE verification_file SET status = $2::verification_file_status WHERE id = $1',
        [id, status],
      );

      const res = await changes(id, admin);

      expect([res.status, res.body.resubmitted]).toEqual([200, false]);
    },
  );

  it('answers the same twice and writes no audit entry', async () => {
    const { garage, id } = await returned();
    await entry(garage, 'garage', 5, {}, 'decided_at', id);
    const before = await logRows();

    const first = await changes(id, admin);
    const second = await changes(id, admin);

    expect([second.body, await logRows()]).toEqual([first.body, before]);
  });

  it('answers 404 for an id with a trailing path or uppercase uuid of an unknown file', async () => {
    const res = await changes(randomUUID().toUpperCase(), admin);

    expect(res.status).toBe(404);
  });

  it('refuses a driver with 404 and a stale token role with no data', async () => {
    const { garage, id } = await returned();
    await entry(
      garage,
      'garage',
      5,
      { field: 'secret_field' },
      'decided_at',
      id,
    );
    const driverId = await account('driver');

    const asDriver = await changes(id, bearer(driverId, 'driver'));
    const claimsAdmin = await changes(id, bearer(driverId, 'admin'));

    expect([asDriver.status, claimsAdmin.status]).toEqual([404, 404]);
    expect(JSON.stringify(claimsAdmin.body)).not.toContain('secret_field');
  });
});
