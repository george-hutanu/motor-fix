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

const checked = (id: string, kind: 'rar' | 'caen', result: string) =>
  db.query(
    'UPDATE verification_check SET result = $3::verification_check_result WHERE file_id = $1 AND kind = $2::verification_check_kind',
    [id, kind, result],
  );

// Every check ok and both legal documents held: an approval then owes no note.
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

const post = (
  id: string,
  action: 'decision' | 'reopen',
  authorization?: string,
  body?: unknown,
) => {
  const req = request(app.getHttpServer())
    .post(`/api/v1/admin/verification-files/${id}/${action}`)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(body ?? {}));
  return authorization ? req.set('Authorization', authorization) : req;
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

// @traces 306-FR-001
describe('decision payload boundaries', () => {
  it('accepts a note of exactly 1,000 characters', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'a'.repeat(1000),
      reason: 'other',
    });

    expect([res.status, res.body.file?.reasonNote?.length]).toEqual([
      200, 1000,
    ]);
  });

  it('accepts a 1,000 character note padded with spaces and stores it trimmed', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note: `  ${'a'.repeat(1000)}  `,
      reason: 'other',
    });

    expect(res.status).toBe(200);
    expect((await fileRow(id)).reason_note).toBe('a'.repeat(1000));
  });

  it('refuses a note of 1,001 characters', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'a'.repeat(1001),
      reason: 'other',
    });

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
  });

  it('keeps multi-byte characters intact in a stored note', async () => {
    const { id } = await file();
    const note = 'Lipsește certificatul ONRC — ăâîșț 🚗 日本語';

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note,
      reason: 'documents',
    });

    expect([res.status, res.body.file.reasonNote]).toEqual([200, note]);
    expect((await fileRow(id)).reason_note).toBe(note);
  });

  it('keeps line breaks and tabs in a note', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'Linia 1\r\nLinia 2\tcoloana',
    });

    expect([res.status, res.body.file.reasonNote]).toEqual([
      200,
      'Linia 1\r\nLinia 2\tcoloana',
    ]);
  });

  it.each([
    ['a NUL byte', 'abc\u0000def'],
    ['an escape character', 'abc\u001bdef'],
    ['a DEL character', 'abc\u007fdef'],
    ['a C1 control', 'abc\u0085def'],
  ])('refuses a note holding %s', async (_name, note) => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note,
      reason: 'other',
    });

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
    expect((await fileRow(id)).status).toBe('in_review');
  });

  it.each([
    ['a number', 42],
    ['an array', ['a']],
    ['an object', { a: 1 }],
    ['null', null],
    ['a boolean', true],
  ])(
    'answers 400 or 422, never 200 or 500, to a note that is %s',
    async (_n, note) => {
      const { id } = await file();

      const res = await post(id, 'decision', admin, {
        decision: 'rejected',
        note,
        reason: 'other',
      });

      expect([400, 422]).toContain(res.status);
      expect((await fileRow(id)).status).toBe('in_review');
    },
  );

  it('stores a blank approval note as null', async () => {
    const { id } = await file();
    await allOk(id);

    const res = await post(id, 'decision', admin, {
      decision: 'approved',
      note: '   \n\t ',
    });

    expect([res.status, res.body.file.reasonNote]).toEqual([200, null]);
    expect((await fileRow(id)).reason_note).toBeNull();
  });

  it('answers 422 note_required to a note of only whitespace on a request for more', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: '   ',
    });

    expect([res.status, res.body.code]).toEqual([422, 'note_required']);
  });

  it.each([
    [
      'null reason on a rejection',
      { decision: 'rejected', note: 'x', reason: null },
    ],
    ['null decision', { decision: null, note: 'x' }],
    ['no decision', { note: 'x' }],
    ['an uppercase decision', { decision: 'APPROVED' }],
    ['a numeric decision', { decision: 1 }],
    ['an array decision', { decision: ['approved'] }],
    [
      'a string requestedItems',
      { decision: 'more_requested', note: 'x', requestedItems: 'photos' },
    ],
    [
      'null requestedItems',
      { decision: 'more_requested', note: 'x', requestedItems: null },
    ],
    [
      'snake_case requested_items',
      { decision: 'more_requested', note: 'x', requested_items: ['photos'] },
    ],
  ])('refuses %s with a 4xx and changes nothing', async (_n, body) => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, body);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await fileRow(id)).status).toBe('in_review');
    expect(await count('verification.decided', id)).toBe(0);
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"approved"'],
  ])('refuses a body that is %s', async (_n, raw) => {
    const { id } = await file();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/verification-files/${id}/decision`)
      .set('Authorization', admin)
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(400);
  });

  it('refuses more than five requested items', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'x',
      requestedItems: [
        'photos',
        'documents',
        'rar',
        'address',
        'other',
        'photos',
      ],
    });

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
  });

  it('accepts all five requested items', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'x',
      requestedItems: ['photos', 'documents', 'rar', 'address', 'other'],
    });

    expect(res.status).toBe(200);
    expect(res.body.file.requestedItems).toEqual([
      'photos',
      'documents',
      'rar',
      'address',
      'other',
    ]);
  });

  it('stores an empty requestedItems list as empty', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'x',
      requestedItems: [],
    });

    expect([res.status, res.body.file.requestedItems]).toEqual([200, []]);
  });

  it('does not store the same item twice when it is listed twice', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'x',
      requestedItems: ['photos', 'photos'],
    });

    expect(res.status).toBe(200);
    expect(res.body.file.requestedItems).toEqual(['photos']);
  });

  it('accepts a reason on a request for more and stores it', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'x',
      reason: 'photos',
    });

    expect([res.status, res.body.file.reasonCode]).toEqual([200, 'photos']);
  });

  it('refuses an approval carrying empty requestedItems', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'approved',
      requestedItems: [],
    });

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
  });

  it('refuses a rejection with a reason and empty requestedItems', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'x',
      reason: 'other',
      requestedItems: [],
    });

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
  });
});

// @traces 306-FR-006
describe('ids and callers', () => {
  it.each(['decision', 'reopen'] as const)(
    'answers 404 to %s for an id that is not a uuid',
    async (action) => {
      const res = await post(
        "x'; drop table verification_file--",
        action,
        admin,
        {
          decision: 'approved',
        },
      );

      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    },
  );

  it.each(['decision', 'reopen'] as const)(
    'answers 404 to %s for an unknown uuid',
    async (action) => {
      const res = await post(randomUUID(), action, admin, {
        decision: 'approved',
      });

      expect(res.status).toBe(404);
    },
  );

  it.each(['decision', 'reopen'] as const)(
    'answers 404 to a driver on %s and leaves the file as it was',
    async (action) => {
      const { id } = await file('rejected');
      const driver = bearer(await account('driver'), 'driver');

      const res = await post(id, action, driver, { decision: 'approved' });

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Atelier');
      expect((await fileRow(id)).status).toBe('rejected');
    },
  );

  it('answers 401 with a garbage bearer token on both routes', async () => {
    const { id } = await file();

    const a = await post(id, 'decision', 'Bearer not.a.token', {
      decision: 'approved',
    });
    const b = await post(id, 'reopen', 'Bearer not.a.token');

    expect([a.status, b.status]).toEqual([401, 401]);
  });

  it('answers 401 with a token signed by another secret', async () => {
    const { id } = await file();
    const forged = `Bearer ${signAccessToken({ accountId: adminId, role: 'admin' } as never, 'x'.repeat(48), Date.now())}`;

    const res = await post(id, 'decision', forged, { decision: 'approved' });

    expect(res.status).toBe(401);
    expect((await fileRow(id)).status).toBe('in_review');
  });
});

// @traces 306-FR-002 306-FR-003
describe('decisions racing and repeating', () => {
  it('lets exactly one of two concurrent decisions commit', async () => {
    const { id } = await file();
    const other = bearer(await account('admin', 'Dan Ene'), 'admin');

    const [a, b] = await Promise.all([
      post(id, 'decision', admin, {
        decision: 'rejected',
        note: 'a',
        reason: 'other',
      }),
      post(id, 'decision', other, { decision: 'more_requested', note: 'b' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await count('verification.decided', id)).toBe(1);
    const audits = await db.query(
      "SELECT count(*) FROM activity_log WHERE subject_id = $1 AND field = 'status'",
      [id],
    );
    expect(Number(audits.rows[0].count)).toBe(1);
  });

  it('lets exactly one of ten concurrent decisions commit', async () => {
    const { id } = await file();

    const all = await Promise.all(
      Array.from({ length: 10 }, () =>
        post(id, 'decision', admin, {
          decision: 'rejected',
          note: 'n',
          reason: 'other',
        }),
      ),
    );

    expect(all.filter((r) => r.status === 200)).toHaveLength(1);
    expect(all.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await count('verification.decided', id)).toBe(1);
  });

  it('refuses the same decision sent twice with 409 and writes nothing the second time', async () => {
    const { id } = await file();
    const body = { decision: 'rejected', note: 'n', reason: 'other' };
    await post(id, 'decision', admin, body);
    const before = await fileRow(id);

    const res = await post(id, 'decision', admin, body);

    expect([res.status, res.body.code, res.body.decidedBy]).toEqual([
      409,
      'verification_transition_refused',
      'Ioana',
    ]);
    expect(await fileRow(id)).toEqual(before);
    expect(await count('verification.decided', id)).toBe(1);
  });

  it('checks the file is decided before the gates, so a decided file answers transition_refused not rar_check_required', async () => {
    const { id } = await file('rejected');

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect([res.status, res.body.code]).toEqual([
      409,
      'verification_transition_refused',
    ]);
  });

  it('asks for rar before caen when both are not ok', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect([res.status, res.body.code]).toEqual([409, 'rar_check_required']);
  });

  it.each(['failed', 'warning', 'not_run', 'pending'])(
    'refuses approval when rar is %s even if caen is ok',
    async (result) => {
      const { id } = await file();
      await checked(id, 'rar', result).catch(() => undefined);
      await checked(id, 'caen', 'ok');

      const res = await post(id, 'decision', admin, { decision: 'approved' });

      expect([res.status, res.body.code]).toEqual([409, 'rar_check_required']);
    },
  );

  it('lets a rejection through while rar and caen are not ok', async () => {
    const { id } = await file();

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'n',
      reason: 'rar',
    });

    expect(res.status).toBe(200);
  });

  it('does not publish the garage when the gate refuses an approval', async () => {
    const { garage, id } = await file();

    await post(id, 'decision', admin, { decision: 'approved' });

    const row = await db.query(
      'SELECT status, approved_at FROM garage WHERE id = $1',
      [garage],
    );
    expect([row.rows[0].status, row.rows[0].approved_at]).toEqual([
      'draft',
      null,
    ]);
  });

  it('refuses to approve a file of a suspended garage and writes nothing', async () => {
    const { garage, id } = await file('in_review', 'suspended');
    await checked(id, 'rar', 'ok');
    await checked(id, 'caen', 'ok');

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect(res.status).toBe(409);
    const row = await db.query('SELECT status FROM garage WHERE id = $1', [
      garage,
    ]);
    expect(row.rows[0].status).toBe('suspended');
    expect(await count('verification.decided', id)).toBe(0);
  });

  it('stores null reason_code on an approval even when the file kept an earlier rejection reason', async () => {
    const { id } = await file();
    await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'n',
      reason: 'documents',
    });
    await post(id, 'reopen', admin);
    await allOk(id);

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.file).toMatchObject({
      reasonCode: null,
      reasonNote: null,
      requestedItems: [],
      status: 'approved',
    });
  });

  it('clears earlier requested items when a later decision is a rejection', async () => {
    const { id } = await file();
    await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'n',
      requestedItems: ['photos'],
    });
    await post(id, 'reopen', admin);

    const res = await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'n',
      reason: 'other',
    });

    expect([res.status, res.body.file.requestedItems]).toEqual([200, []]);
  });
});

// @traces 306-FR-005
describe('reopening', () => {
  it.each(['approved', 'rejected', 'more_requested'])(
    'reopens a %s file once and a second reopening is refused',
    async (status) => {
      const { id } = await file(status);

      const first = await post(id, 'reopen', admin);
      const second = await post(id, 'reopen', admin);

      expect([first.status, first.body.file.status]).toEqual([
        200,
        'in_review',
      ]);
      expect([second.status, second.body.code]).toEqual([
        409,
        'verification_transition_refused',
      ]);
      expect(await count('verification.reopened', id)).toBe(1);
    },
  );

  it('lets exactly one of five concurrent reopenings commit', async () => {
    const { id } = await file('rejected');

    const all = await Promise.all(
      Array.from({ length: 5 }, () => post(id, 'reopen', admin)),
    );

    expect(all.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await count('verification.reopened', id)).toBe(1);
  });

  it('keeps the earlier decision columns and resets submittedAt on reopening', async () => {
    const { id } = await file();
    await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'Lipsă',
      reason: 'documents',
    });
    const decided = await fileRow(id);

    const res = await post(id, 'reopen', admin);

    expect(res.status).toBe(200);
    const row = await fileRow(id);
    expect([row.decided_by, row.reason_code, row.reason_note]).toEqual([
      decided.decided_by,
      'documents',
      'Lipsă',
    ]);
    expect(row.submitted_at.getTime()).toBeGreaterThanOrEqual(
      decided.submitted_at.getTime(),
    );
    expect([row.reopened_by, res.body.file.reopenReason]).toEqual([
      adminId,
      null,
    ]);
  });

  it('carries adminId in the reopened event', async () => {
    const { id } = await file('approved');

    await post(id, 'reopen', admin);

    const rows = await db.query(
      "SELECT payload FROM outbox_event WHERE kind = 'verification.reopened' AND subject_id = $1",
      [id],
    );
    expect(rows.rows[0].payload).toMatchObject({ adminId });
  });

  it('keeps an approved garage public after its file is reopened', async () => {
    const { id } = await file();
    await allOk(id);
    const approved = await post(id, 'decision', admin, {
      decision: 'approved',
    });
    expect(approved.status).toBe(200);
    const before = await db.query(
      'SELECT g.status, g.approved_at FROM garage g JOIN verification_file f ON f.garage_id = g.id WHERE f.id = $1',
      [id],
    );

    await post(id, 'reopen', admin);

    const after = await db.query(
      'SELECT g.status, g.approved_at FROM garage g JOIN verification_file f ON f.garage_id = g.id WHERE f.id = $1',
      [id],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0].status).toBe('approved');
  });

  it('ignores a body sent to reopen', async () => {
    const { id } = await file('rejected');

    const res = await post(id, 'reopen', admin, { reason: 'garage_report' });

    expect(res.status).toBe(200);
    expect(res.body.file.reopenReason).toBeNull();
  });

  it('refuses reopening when another live file of the garage exists', async () => {
    const { garage, id } = await file('rejected');
    await db.query(
      "INSERT INTO verification_file (id, garage_id, status) VALUES (gen_random_uuid(), $1, 'submitted')",
      [garage],
    );

    const res = await post(id, 'reopen', admin);

    expect([res.status, res.body.code]).toEqual([
      409,
      'verification_transition_refused',
    ]);
    expect((await fileRow(id)).status).toBe('rejected');
  });

  it('lets a reopened file be decided again with the full cycle audited', async () => {
    const { id } = await file();
    await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'n',
      reason: 'other',
    });
    await post(id, 'reopen', admin);

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'again',
    });

    expect([res.status, res.body.file.status]).toEqual([200, 'more_requested']);
    expect(await count('verification.decided', id)).toBe(2);
    expect(await count('verification.reopened', id)).toBe(1);
  });
});
