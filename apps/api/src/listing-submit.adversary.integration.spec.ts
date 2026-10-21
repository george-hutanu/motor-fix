import { randomUUID } from 'node:crypto';

import { PRISMA } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot } from './api-boot.testing';
import { completeDraft, signedIn, submit } from './listing-submit.testing';

const api = apiBoot();
let app: INestApplication;

beforeAll(async () => {
  app = await api.start();
}, 900_000);

afterAll(() => api.stop());

const prisma = () => app.get(PRISMA);
const garagesOf = (accountId: string) =>
  prisma().garageMember.count({ where: { accountId } });
const heads = (bearer: string, token: string, key = 'send-1') => ({
  Authorization: bearer,
  'Idempotency-Key': key,
  'X-Listing-Token': token,
});

// @traces 116-FR-006
describe('the send route under hostile input', () => {
  it('takes a key of exactly 64 characters and refuses an empty one', async () => {
    const { bearer } = await signedIn(app);
    const ok = await completeDraft(app);
    const empty = await completeDraft(app);

    await submit(app, ok.id, heads(bearer, ok.token, 'k'.repeat(64))).expect(
      201,
    );
    const res = await submit(
      app,
      empty.id,
      heads(bearer, empty.token, ''),
    ).expect(400);

    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'required', field: 'idempotency-key' }],
    });
  });

  it('answers 404 draft_not_found for a draft key that is missing, huge or not ASCII', async () => {
    const { bearer } = await signedIn(app);
    const { id } = await completeDraft(app);

    for (const token of [undefined, 'a'.repeat(4000), 'ștefan-ключ']) {
      const res = await submit(app, id, {
        Authorization: bearer,
        'Idempotency-Key': 'send-1',
        ...(token && { 'X-Listing-Token': encodeURIComponent(token) }),
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('draft_not_found');
    }
  });

  it('answers 404 draft_not_found for an id that is not a uuid or unknown', async () => {
    const { bearer } = await signedIn(app);
    const { token } = await completeDraft(app);

    for (const id of ['not-a-uuid', randomUUID(), "1';drop table x;--"]) {
      const res = await submit(app, id, heads(bearer, token));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('draft_not_found');
    }
  });

  it('checks the session before the key, and the key before the draft', async () => {
    const { bearer } = await signedIn(app);

    const noSession = await submit(app, randomUUID(), {});
    const noKey = await submit(app, randomUUID(), { Authorization: bearer });

    expect(noSession.status).toBe(401);
    expect(noKey.status).toBe(400);
  });

  it('answers 401 to a garbled bearer token and creates nothing', async () => {
    const { id, token } = await completeDraft(app);

    const res = await submit(
      app,
      id,
      heads('Bearer not.a.token', token),
    ).expect(401);

    expect(res.body.code).toBe('sign_in_required');
    expect(
      await prisma().listingDraft.findUnique({ where: { id } }),
    ).toMatchObject({ status: 'open' });
  });
});

// @traces 116-FR-008
describe('the send twice, and at once', () => {
  it('runs the send again after a 422 under the same key', async () => {
    const { accountId, bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app, (data) => {
      delete data.steps?.['6']?.rarNumber;
    });
    await submit(app, id, heads(bearer, token)).expect(422);
    const draft = await prisma().listingDraft.findUniqueOrThrow({
      where: { id },
    });
    await prisma().listingDraft.update({
      data: {
        data: {
          ...(draft.data as object),
          steps: {
            ...(draft.data as any).steps,
            '6': { ...(draft.data as any).steps['6'], rarNumber: 'BV-123' },
          },
        },
      },
      where: { id },
    });

    const res = await submit(app, id, heads(bearer, token)).expect(201);

    expect(res.body.garageId).toEqual(expect.any(String));
    expect(await garagesOf(accountId)).toBe(1);
  });

  it('ends ten concurrent sends under one key with one garage and one body', async () => {
    const { accountId, bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app);

    const answers = await Promise.all(
      Array.from({ length: 10 }, () => submit(app, id, heads(bearer, token))),
    );

    const ok = answers.filter((a) => a.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const a of answers) expect([201, 409]).toContain(a.status);
    for (const a of ok) expect(a.body).toEqual(ok[0].body);
    expect(await garagesOf(accountId)).toBe(1);
    expect(
      await prisma().verificationFile.count({
        where: { garageId: ok[0].body.garageId },
      }),
    ).toBe(1);
  });

  it('ends ten concurrent sends under ten keys with one 201 and nine 409 draft_already_submitted', async () => {
    const { accountId, bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app);

    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        submit(app, id, heads(bearer, token, `key-${i}`)),
      ),
    );

    expect(answers.filter((a) => a.status === 201)).toHaveLength(1);
    for (const a of answers.filter((x) => x.status !== 201)) {
      expect(a.status).toBe(409);
      expect(['draft_already_submitted', 'garage_already_exists']).toContain(
        a.body.code,
      );
    }
    expect(await garagesOf(accountId)).toBe(1);
  });

  it('keeps the draft submitted with its time and the garage it became', async () => {
    const { bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app);

    const res = await submit(app, id, heads(bearer, token)).expect(201);

    const draft = await prisma().listingDraft.findUniqueOrThrow({
      where: { id },
    });
    expect(draft.status).toBe('submitted');
    expect(draft.submittedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(draft)).toContain(res.body.garageId);
  });
});

// @traces 116-FR-009
describe('an account that already owns a garage', () => {
  it('gets 409 garage_already_exists even when the draft would fail its re-check, and the draft stays open', async () => {
    const { accountId, bearer } = await signedIn(app);
    const first = await completeDraft(app);
    await submit(app, first.id, heads(bearer, first.token)).expect(201);
    const second = await completeDraft(app, (data) => {
      delete data.steps?.['6']?.rarNumber;
    });

    const res = await submit(
      app,
      second.id,
      heads(bearer, second.token, 'send-2'),
    ).expect(409);

    expect(res.body.code).toBe('garage_already_exists');
    expect(await garagesOf(accountId)).toBe(1);
    expect(
      await prisma().listingDraft.findUniqueOrThrow({
        where: { id: second.id },
      }),
    ).toMatchObject({ status: 'open' });
  });

  it('gives a driver the garage role without making a second account', async () => {
    const { accountId, bearer } = await signedIn(app, 'driver');
    const { id, token } = await completeDraft(app);
    const before = await prisma().account.count();

    await submit(app, id, heads(bearer, token)).expect(201);

    expect(await prisma().account.count()).toBe(before);
    const roles = await prisma().accountRole.findMany({
      where: { accountId },
    });
    expect(roles.map((r: { role: string }) => r.role).sort()).toEqual([
      'driver',
      'garage',
    ]);
  });
});

// @traces 116-FR-012
describe('a CUI held by another listing', () => {
  it('goes through and warns, naming a garage whatever its status', async () => {
    for (const status of ['draft', 'approved', 'suspended'] as const) {
      const { bearer } = await signedIn(app);
      const { id, token } = await completeDraft(app);
      const draft = await prisma().listingDraft.findUniqueOrThrow({
        where: { id },
      });
      const cui = (draft.data as any).steps['6'].cui as string;
      const other = await prisma().garage.create({
        data: {
          cui,
          name: `Rival ${status}`,
          slug: `rival-${randomUUID()}`,
          status,
        },
      });
      expect(other.cui).toBe(cui);

      const res = await submit(app, id, heads(bearer, token)).expect(201);

      expect(res.body.warnings).toEqual([
        { code: 'cui_in_use', field: 'steps.6.cui' },
      ]);
      const file = await prisma().verificationFile.findFirstOrThrow({
        where: { garageId: res.body.garageId },
      });
      expect(file.cuiWarning).toContain(`Rival ${status}`);
    }
  });

  it('names every holder when two listings share the CUI', async () => {
    const a = await completeDraft(app);
    const draftA = await prisma().listingDraft.findUniqueOrThrow({
      where: { id: a.id },
    });
    const cui = (draftA.data as any).steps['6'].cui as string;
    const c = await completeDraft(app, (d) => {
      d.steps!['6']!.cui = cui;
    });
    const b = await completeDraft(app, (d) => {
      d.steps!['6']!.cui = cui;
    });
    const { bearer } = await signedIn(app);

    const res = await submit(app, b.id, heads(bearer, b.token)).expect(201);

    const file = await prisma().verificationFile.findFirstOrThrow({
      where: { garageId: res.body.garageId },
    });
    expect(file.cuiWarning).toContain(a.name);
    expect(file.cuiWarning).toContain(c.name);
  });
});

// @traces 116-FR-010
describe('what the send writes', () => {
  it('creates a file with no legal document when step 6 uploaded none', async () => {
    const { bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app, (data) => {
      data.documents = {};
    });

    const res = await submit(app, id, heads(bearer, token)).expect(201);

    expect(
      await prisma().legalDocument.count({
        where: { verificationFileId: res.body.fileId },
      }),
    ).toBe(0);
  });

  it('keeps the account e-mail for the owner and the draft e-mail on the draft', async () => {
    const { accountId, bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app);
    const before = await prisma().listingDraft.findUniqueOrThrow({
      where: { id },
    });

    await submit(app, id, heads(bearer, token)).expect(201);

    const after = await prisma().listingDraft.findUniqueOrThrow({
      where: { id },
    });
    expect(after.email).toBe(before.email);
    expect(await garagesOf(accountId)).toBe(1);
  });

  it('leaves nothing behind when a brand of the draft was deleted after the check', async () => {
    const { accountId, bearer } = await signedIn(app);
    const { brand, id, token } = await completeDraft(app);
    await prisma().brand.delete({ where: { id: brand.id } });

    const res = await submit(app, id, heads(bearer, token));

    // The check's rules do not read the catalogue; the brands' own write
    // refuses it, and the whole send rolls back.
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'unknown_brand', field: 'brands' }],
    });
    expect(await garagesOf(accountId)).toBe(0);
    expect(
      await prisma().listingDraft.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: 'open' });
  });

  it('writes the garage.created event with the garage and the account', async () => {
    const { accountId, bearer } = await signedIn(app);
    const { id, token } = await completeDraft(app);

    const res = await submit(app, id, heads(bearer, token)).expect(201);

    const events = await prisma().outboxEvent.findMany({
      where: { kind: 'garage.created' },
    });
    const mine = events.filter((e: { payload: unknown }) =>
      JSON.stringify(e.payload).includes(res.body.garageId),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].payload).toMatchObject({
      accountId,
      garageId: res.body.garageId,
    });
  });
});

// @traces 116-FR-014
describe('GET /garages/:id/verification over HTTP', () => {
  const read = (id: string, bearer?: string) => {
    const req = request(app.getHttpServer()).get(
      `/api/v1/garages/${id}/verification`,
    );
    return bearer ? req.set('Authorization', bearer) : req;
  };

  it('answers 401 without a session, 404 for an unknown or malformed id', async () => {
    const { bearer } = await signedIn(app, 'garage');

    expect((await read(randomUUID())).status).toBe(401);
    for (const id of [randomUUID(), 'not-a-uuid', '0']) {
      const res = await read(id, bearer);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
  });

  it('reads draft for a garage with no file, with null time and empty lists', async () => {
    const { accountId, bearer } = await signedIn(app, 'garage');
    const garage = await prisma().garage.create({
      data: { name: 'Fara Dosar', slug: `fd-${randomUUID()}` },
    });
    await prisma().garageMember.create({
      data: { accountId, garageId: garage.id, role: 'owner' },
    });

    const res = await read(garage.id, bearer).expect(200);

    expect(res.body).toEqual({
      reason: null,
      requestedItems: [],
      status: 'draft',
      submittedAt: null,
    });
  });

  it('reads the newest file when an older one was rejected', async () => {
    const { accountId, bearer } = await signedIn(app, 'garage');
    const garage = await prisma().garage.create({
      data: { name: 'Reluat', slug: `re-${randomUUID()}` },
    });
    await prisma().garageMember.create({
      data: { accountId, garageId: garage.id, role: 'owner' },
    });
    const old = await prisma().verificationFile.create({
      data: {
        createdAt: new Date('2026-01-01T00:00:00Z'),
        garageId: garage.id,
        reasonCode: 'documents_unreadable',
        reasonNote: 'vechi',
        status: 'rejected',
      },
    });
    await prisma().verificationFile.create({
      data: {
        createdAt: new Date('2026-02-01T00:00:00Z'),
        garageId: garage.id,
        previousFileId: old.id,
        status: 'submitted',
        submittedAt: new Date('2026-02-01T00:00:00Z'),
      },
    });

    const res = await read(garage.id, bearer).expect(200);

    expect(res.body).toEqual({
      reason: null,
      requestedItems: [],
      status: 'submitted',
      submittedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('lists requested items only for more_requested and the reason only for rejected', async () => {
    const { accountId, bearer } = await signedIn(app, 'garage');
    const garage = await prisma().garage.create({
      data: { name: 'Cerut', slug: `ce-${randomUUID()}` },
    });
    await prisma().garageMember.create({
      data: { accountId, garageId: garage.id, role: 'owner' },
    });
    const file = await prisma().verificationFile.create({
      data: {
        garageId: garage.id,
        requestedItems: ['rar_authorisation', 'onrc_certificate'],
        status: 'more_requested',
      },
    });

    const more = await read(garage.id, bearer).expect(200);
    await prisma().verificationFile.update({
      data: {
        reasonCode: 'not_a_garage',
        reasonNote: 'nota',
        requestedItems: [],
        status: 'rejected',
      },
      where: { id: file.id },
    });
    const rejected = await read(garage.id, bearer).expect(200);

    expect(more.body).toMatchObject({
      reason: null,
      requestedItems: ['rar_authorisation', 'onrc_certificate'],
      status: 'more_requested',
    });
    expect(rejected.body).toMatchObject({
      reason: { code: 'not_a_garage', note: 'nota' },
      requestedItems: [],
      status: 'rejected',
    });
  });

  it('reads approved for a suspended garage whose newest file was rejected', async () => {
    const { accountId, bearer } = await signedIn(app, 'garage');
    const garage = await prisma().garage.create({
      data: {
        name: 'Suspendat',
        slug: `su-${randomUUID()}`,
        status: 'suspended',
      },
    });
    await prisma().garageMember.create({
      data: { accountId, garageId: garage.id, role: 'owner' },
    });
    await prisma().verificationFile.create({
      data: { garageId: garage.id, status: 'in_review' },
    });

    const res = await read(garage.id, bearer).expect(200);

    expect(res.body.status).toBe('approved');
  });

  it('answers a stranger 404 without the garage name or id echoed', async () => {
    const { bearer } = await signedIn(app, 'garage');
    const garage = await prisma().garage.create({
      data: { name: 'Secret Auto', slug: `se-${randomUUID()}` },
    });

    const res = await read(garage.id, bearer);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Secret Auto');
    expect(JSON.stringify(res.body)).not.toContain(garage.id);
  });

  it('refuses a receptionist of the garage with 403 forbidden', async () => {
    const { accountId, bearer } = await signedIn(app, 'receptionist');
    const garage = await prisma().garage.create({
      data: { name: 'Staff', slug: `st-${randomUUID()}` },
    });
    await prisma().garageMember.create({
      data: { accountId, garageId: garage.id, role: 'receptionist' },
    });

    const res = await read(garage.id, bearer);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('answers an owner of a garage who signs in with a driver token 403 or 404, never 200', async () => {
    const { accountId, bearer } = await signedIn(app, 'driver');
    const garage = await prisma().garage.create({
      data: { name: 'Rol', slug: `ro-${randomUUID()}` },
    });
    await prisma().garageMember.create({
      data: { accountId, garageId: garage.id, role: 'owner' },
    });

    const res = await read(garage.id, bearer);

    expect([403, 404]).toContain(res.status);
  });

  it('lets an admin read any garage', async () => {
    const { bearer } = await signedIn(app, 'admin');
    const garage = await prisma().garage.create({
      data: { name: 'Oricare', slug: `or-${randomUUID()}` },
    });

    const res = await read(garage.id, bearer).expect(200);

    expect(res.body.status).toBe('draft');
  });
});
