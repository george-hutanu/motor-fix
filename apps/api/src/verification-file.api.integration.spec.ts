import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  StorageService,
  signAccessToken,
} from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

const api = apiBoot();
let app: INestApplication;
let db: Client;

type Role = 'admin' | 'driver' | 'garage' | 'receptionist' | 'mechanic';

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

// A garage with a file in `status` and its 8 checks, as a submission leaves it.
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
  await db.query(
    'INSERT INTO verification_check (id, file_id, kind) SELECT gen_random_uuid(), $1, k FROM unnest(enum_range(NULL::verification_check_kind)) AS k',
    [id],
  );
  return { garage, id };
};

const fileRow = async (id: string) =>
  (await db.query('SELECT * FROM verification_file WHERE id = $1', [id]))
    .rows[0];

const entries = async (subjectId: string) =>
  (
    await db.query(
      'SELECT action, field, new_value FROM activity_log WHERE subject_id = $1 ORDER BY at',
      [subjectId],
    )
  ).rows;

const opened = async (id: string) =>
  Number(
    (
      await db.query(
        "SELECT count(*) FROM outbox_event WHERE kind = 'verification.opened' AND subject_id = $1",
        [id],
      )
    ).rows[0].count,
  );

const read = (id: string, authorization?: string) => {
  const req = request(app.getHttpServer()).get(
    `/api/v1/admin/verification-files/${id}`,
  );
  return authorization ? req.set('Authorization', authorization) : req;
};

const open = (id: string, authorization?: string) => {
  const req = request(app.getHttpServer()).post(
    `/api/v1/admin/verification-files/${id}/open`,
  );
  return authorization ? req.set('Authorization', authorization) : req;
};

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

afterAll(async () => {
  await db.end();
  await api.stop();
});

// @traces 302-FR-001 302-FR-002 302-FR-012 302-FR-013
describe('POST /admin/verification-files/:id/open', () => {
  it('moves a submitted file to in_review once, with one entry and one event', async () => {
    const { id } = await file();

    const res = await open(id, admin);

    expect(res.status).toBe(200);
    expect(res.body.file).toMatchObject({
      id,
      openedBy: { id: adminId, name: 'Ioana' },
      status: 'in_review',
    });
    expect(typeof res.body.file.openedAt).toBe('string');
    expect(res.body.checks).toHaveLength(8);
    const row = await fileRow(id);
    expect([row.status, row.opened_by]).toEqual(['in_review', adminId]);
    expect(await entries(id)).toEqual([
      expect.objectContaining({
        action: 'update',
        field: 'status',
        new_value: 'in_review',
      }),
    ]);
    expect(await opened(id)).toBe(1);
  });

  it('answers a second opening unchanged and writes nothing more', async () => {
    const { id } = await file();
    await open(id, admin);
    const other = bearer(await account('admin', 'Dan Ene'), 'admin');

    const res = await open(id, other);

    expect(res.status).toBe(200);
    expect(res.body.file.openedBy).toEqual({ id: adminId, name: 'Ioana' });
    expect(await entries(id)).toHaveLength(1);
    expect(await opened(id)).toBe(1);
  });

  it.each(['in_review', 'approved', 'rejected', 'more_requested'])(
    'answers a %s file unchanged, with no 409',
    async (status) => {
      const { id } = await file(status);
      const before = await fileRow(id);

      const res = await open(id, admin);

      expect([res.status, res.body.file.status]).toEqual([200, status]);
      expect(await fileRow(id)).toEqual(before);
      expect(await entries(id)).toHaveLength(0);
      expect(await opened(id)).toBe(0);
    },
  );

  it('answers 401 sign_in_required with no token', async () => {
    const { id } = await file();

    const res = await open(id);

    expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
    expect((await fileRow(id)).status).toBe('submitted');
  });
});

// @traces 302-FR-001 302-FR-012 302-FR-013
describe('GET /admin/verification-files/:id', () => {
  it('reads the file and writes nothing', async () => {
    const { garage, id } = await file();

    const res = await read(id, admin);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      documents: [
        { kind: 'onrc_certificate', present: false, stale: null },
        { kind: 'rar_authorisation', present: false, stale: null },
      ],
      file: { id, openedBy: null, status: 'submitted' },
      garage: { brands: [], id: garage, name: 'Atelier Dinamo', photos: [] },
      previousRejection: null,
      reports: [],
      timeline: { entries: [], total: 0 },
    });
    expect(res.body.checks.map((c: { kind: string }) => c.kind)).toEqual([
      'company',
      'caen',
      'rar',
      'activities',
      'representative',
      'address',
      'photos',
      'documents',
    ]);
    expect(typeof res.body.storageReady).toBe('boolean');
    expect((await fileRow(id)).status).toBe('submitted');
    expect(await entries(id)).toHaveLength(0);
  });

  it.each(['an unknown id', 'a malformed id'])(
    'answers 404 for %s, never 400',
    async (which) => {
      const id = which === 'an unknown id' ? randomUUID() : 'not-a-uuid';

      expect((await read(id, admin)).status).toBe(404);
      expect((await open(id, admin)).status).toBe(404);
    },
  );

  it.each(['driver', 'garage', 'receptionist', 'mechanic'] as const)(
    'answers 404 to a %s of the garage, with no garage data',
    async (role) => {
      const { garage, id } = await file();
      const accountId = await account(role);
      if (role === 'garage' || role === 'receptionist') {
        await db.query(
          'INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, $3::garage_member_role)',
          [garage, accountId, role === 'garage' ? 'owner' : 'receptionist'],
        );
      }
      if (role === 'mechanic') {
        await db.query(
          "INSERT INTO mechanic (id, garage_id, account_id, name) VALUES (gen_random_uuid(), $1, $2, 'Vlad')",
          [garage, accountId],
        );
      }
      const token = bearer(accountId, role);

      const [got, posted] = [await read(id, token), await open(id, token)];

      expect([got.status, posted.status]).toEqual([404, 404]);
      expect(JSON.stringify(got.body)).not.toContain('Atelier Dinamo');
      expect((await fileRow(id)).status).toBe('submitted');
    },
  );

  it('answers 401 with no token', async () => {
    const { id } = await file();

    expect((await read(id)).status).toBe(401);
  });
});

// The page address this story's drawer calls is unchanged: an address valid
// five minutes and one `open` entry per press, for an admin only.
// @traces 302-FR-005
describe('a document page of the file', () => {
  const page = (
    fileId: string,
    documentId: string,
    authorization: string,
    n = 1,
  ) =>
    request(app.getHttpServer())
      .get(
        `/api/v1/admin/verification-files/${fileId}/documents/${documentId}/pages/${n}/download-url`,
      )
      .set('Authorization', authorization);

  const document = async (fileId: string, garageId: string) => {
    const key = `legal_document/${garageId}/${randomUUID()}`;
    await app.get(StorageService).putObject(key, 'pdf', 'application/pdf');
    const id = randomUUID();
    await db.query(
      "INSERT INTO legal_document (id, verification_file_id, kind, pages, issued_on) VALUES ($1, $2, 'onrc_certificate', $3, current_date)",
      [id, fileId, [key]],
    );
    return id;
  };

  it('gives an admin a five-minute address and one open entry per press', async () => {
    const { garage, id } = await file();
    const documentId = await document(id, garage);

    const first = await page(id, documentId, admin);
    const second = await page(id, documentId, admin);

    expect([first.status, second.status]).toEqual([200, 200]);
    const minutes = (Date.parse(first.body.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4);
    expect(minutes).toBeLessThanOrEqual(5);
    expect(
      (await entries(documentId)).filter((e) => e.action === 'open'),
    ).toHaveLength(2);
  });

  it("answers 403 to the garage's own owner and 404 to a driver, issuing no address", async () => {
    const { garage, id } = await file();
    const documentId = await document(id, garage);
    const owner = await account('garage');
    await db.query(
      "INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'owner')",
      [garage, owner],
    );

    const own = await page(id, documentId, bearer(owner, 'garage'));
    const driver = await page(
      id,
      documentId,
      bearer(await account('driver'), 'driver'),
    );

    expect([own.status, driver.status]).toEqual([403, 404]);
    expect(own.body.url).toBeUndefined();
    expect(await entries(documentId)).toHaveLength(0);
  });
});

const post = (
  id: string,
  action: 'decision' | 'reopen',
  authorization?: string,
  body?: object,
) => {
  const req = request(app.getHttpServer())
    .post(`/api/v1/admin/verification-files/${id}/${action}`)
    .send(body ?? {});
  return authorization ? req.set('Authorization', authorization) : req;
};

const checked = (id: string, kind: 'rar' | 'caen', result: string) =>
  db.query(
    'UPDATE verification_check SET result = $3::verification_check_result WHERE file_id = $1 AND kind = $2::verification_check_kind',
    [id, kind, result],
  );

const decided = async (id: string) =>
  (
    await db.query(
      "SELECT payload FROM outbox_event WHERE kind = 'verification.decided' AND subject_id = $1",
      [id],
    )
  ).rows;

// @traces 306-FR-001 306-FR-006
describe('POST /admin/verification-files/:id/decision', () => {
  it('stores a request for more and answers with the file read, its items included', async () => {
    const { id } = await file('in_review');

    const res = await post(id, 'decision', admin, {
      decision: 'more_requested',
      note: 'Trimite pozele atelierului.',
      requestedItems: ['photos', 'documents'],
    });

    expect(res.status).toBe(200);
    expect(res.body.file).toMatchObject({
      decidedBy: { id: adminId, name: 'Ioana' },
      id,
      reasonCode: null,
      reasonNote: 'Trimite pozele atelierului.',
      requestedItems: ['photos', 'documents'],
      status: 'more_requested',
    });
    expect(res.body.checks).toHaveLength(8);
    expect(await decided(id)).toHaveLength(1);
  });

  it('approves a file whose rar and caen checks are ok', async () => {
    const { id } = await file('in_review');
    await checked(id, 'rar', 'ok');
    await checked(id, 'caen', 'ok');

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect([res.status, res.body.file.status]).toEqual([200, 'approved']);
    expect(res.body.file.requestedItems).toEqual([]);
  });

  it.each([
    ['rar_check_required', 'warning', 'ok'],
    ['caen_check_required', 'ok', 'not_run'],
  ])('answers 409 %s and writes nothing', async (code, rar, caen) => {
    const { id } = await file('in_review');
    await checked(id, 'rar', rar);
    await checked(id, 'caen', caen);

    const res = await post(id, 'decision', admin, { decision: 'approved' });

    expect([res.status, res.body.code]).toEqual([409, code]);
    expect((await fileRow(id)).status).toBe('in_review');
    expect(await entries(id)).toHaveLength(0);
    expect(await decided(id)).toHaveLength(0);
  });

  it('answers 409 naming who decided first, and when', async () => {
    const { id } = await file('in_review');
    await post(id, 'decision', admin, {
      decision: 'rejected',
      note: 'Lipsește certificatul ONRC.',
      reason: 'documents',
    });
    const at = (await fileRow(id)).decided_at.toISOString();
    const other = bearer(await account('admin', 'Dan Ene'), 'admin');

    const res = await post(id, 'decision', other, {
      decision: 'more_requested',
      note: 'Trimite pozele.',
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'verification_transition_refused',
      currentStatus: 'rejected',
      decidedAt: at,
      decidedBy: 'Ioana',
      detail: `already decided by Ioana at ${at}`,
    });
    expect(await decided(id)).toHaveLength(1);
  });

  it.each([
    ['an unknown decision', { decision: 'maybe', note: 'x' }],
    [
      'an unknown reason',
      { decision: 'rejected', note: 'x', reason: 'weather' },
    ],
    [
      'an unknown requested item',
      { decision: 'more_requested', note: 'x', requestedItems: ['cake'] },
    ],
    [
      'a note over 1,000 characters',
      { decision: 'rejected', note: 'a'.repeat(1001), reason: 'other' },
    ],
    ['an unknown field', { decision: 'approved', urgent: true }],
    ['a reason with an approval', { decision: 'approved', reason: 'rar' }],
    [
      'requested items with a rejection',
      {
        decision: 'rejected',
        note: 'x',
        reason: 'other',
        requestedItems: ['photos'],
      },
    ],
  ])('answers 400 validation_failed to %s', async (_name, body) => {
    const { id } = await file('in_review');

    const res = await post(id, 'decision', admin, body);

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
    expect((await fileRow(id)).status).toBe('in_review');
  });

  it.each([
    ['reason_required', { decision: 'rejected', note: 'Lipsește ONRC' }],
    [
      'note_required',
      { decision: 'rejected', note: '   ', reason: 'documents' },
    ],
    ['note_required', { decision: 'more_requested' }],
  ])('answers 422 %s', async (code, body) => {
    const { id } = await file('in_review');

    const res = await post(id, 'decision', admin, body);

    expect([res.status, res.body.code]).toEqual([422, code]);
    expect((await fileRow(id)).status).toBe('in_review');
  });

  it('reads a file never asked for more with no requested items', async () => {
    const { id } = await file();

    const res = await read(id, admin);

    expect(res.body.file.requestedItems).toEqual([]);
  });
});

// @traces 306-FR-006
describe('POST /admin/verification-files/:id/reopen', () => {
  it('reopens a rejected file and answers with the file read', async () => {
    const { id } = await file('rejected');

    const res = await post(id, 'reopen', admin);

    expect(res.status).toBe(200);
    expect(res.body.file).toMatchObject({ id, status: 'in_review' });
    expect((await fileRow(id)).reopened_by).toBe(adminId);
  });

  it('answers 409 to a file already under review', async () => {
    const { id } = await file('in_review');

    const res = await post(id, 'reopen', admin);

    expect([res.status, res.body.code]).toEqual([
      409,
      'verification_transition_refused',
    ]);
  });
});

// @traces 306-FR-006 306-FR-012
describe('who may decide or reopen', () => {
  it.each(['driver', 'garage', 'receptionist', 'mechanic'] as const)(
    'answers 404 to a %s of the garage on both, with no garage data',
    async (role) => {
      const { garage, id } = await file('rejected');
      const accountId = await account(role);
      if (role === 'garage' || role === 'receptionist') {
        await db.query(
          'INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, $3::garage_member_role)',
          [garage, accountId, role === 'garage' ? 'owner' : 'receptionist'],
        );
      }
      if (role === 'mechanic') {
        await db.query(
          "INSERT INTO mechanic (id, garage_id, account_id, name) VALUES (gen_random_uuid(), $1, $2, 'Vlad')",
          [garage, accountId],
        );
      }
      const token = bearer(accountId, role);

      const decision = await post(id, 'decision', token, {
        decision: 'approved',
      });
      const reopen = await post(id, 'reopen', token);

      expect([decision.status, reopen.status]).toEqual([404, 404]);
      expect(JSON.stringify([decision.body, reopen.body])).not.toContain(
        'Atelier Dinamo',
      );
      expect((await fileRow(id)).status).toBe('rejected');
    },
  );

  it('answers 401 sign_in_required with no token on both', async () => {
    const { id } = await file('rejected');

    const decision = await post(id, 'decision', undefined, {
      decision: 'approved',
    });
    const reopen = await post(id, 'reopen');

    expect([decision.body.code, reopen.body.code]).toEqual([
      'sign_in_required',
      'sign_in_required',
    ]);
    expect([decision.status, reopen.status]).toEqual([401, 401]);
  });

  it.each([randomUUID(), 'not-a-uuid'])(
    'answers 404 for the file %s on both',
    async (id) => {
      const decision = await post(id, 'decision', admin, {
        decision: 'approved',
      });
      const reopen = await post(id, 'reopen', admin);

      expect([decision.status, reopen.status]).toEqual([404, 404]);
    },
  );
});
