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

// @traces 302-FR-001 302-FR-002
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

// @traces 302-FR-001
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
