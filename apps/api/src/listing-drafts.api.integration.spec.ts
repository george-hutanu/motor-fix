import { createHash, randomBytes } from 'node:crypto';

import { NotificationsService, ROUTE_LIMITS } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';

import { apiBoot } from './api-boot.testing';
import { openApiDocument } from './bootstrap';

const api = apiBoot();
const webUrl = process.env['PUBLIC_WEB_URL'];

let app: INestApplication;
let sent: jest.SpyInstance;

beforeAll(async () => {
  process.env['PUBLIC_WEB_URL'] = 'https://motorfix.test';
  sent = jest
    .spyOn(NotificationsService.prototype, 'sendToDraft')
    .mockResolvedValue(undefined);
  app = await api.start();
}, 120_000);

afterAll(async () => {
  try {
    await api.stop();
  } finally {
    sent.mockRestore();
    if (webUrl === undefined) delete process.env['PUBLIC_WEB_URL'];
    else process.env['PUBLIC_WEB_URL'] = webUrl;
  }
});

// A caller of its own, so no test counts toward another's create limit.
const freshAddress = () =>
  `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;

const body = (overrides: Record<string, unknown> = {}) => ({
  data: { steps: { '1': { name: 'Service Popescu' } } },
  email: 'owner@example.test',
  language: 'ro',
  step: 1,
  ...overrides,
});

const create = (payload: object = body(), address = freshAddress()) =>
  request(app.getHttpServer())
    .post('/api/v1/listing-drafts')
    .set('X-Forwarded-For', address)
    .send(payload);

// A survey holds no free text any more, so the size is made of photo keys.
const PHOTO = `garage-photos/3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10/${'x'.repeat(64)}`;
const filesOf = (bytes: number) =>
  Array.from({ length: Math.ceil(bytes / (PHOTO.length + 3)) }, () => PHOTO);

describe('the listing draft routes', () => {
  it('creates a draft without a session and answers its key', async () => {
    const res = await create().expect(201);

    expect(res.body).toMatchObject({
      email: 'owner@example.test',
      linkSent: true,
      status: 'open',
      step: 1,
    });
    expect(res.body.token).toMatch(/^[\w-]{43}$/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reads, saves and re-sends the link with the key', async () => {
    const { body: created } = await create().expect(201);
    const server = app.getHttpServer();

    const read = await request(server)
      .get('/api/v1/listing-drafts/current')
      .set('X-Listing-Token', created.token)
      .expect(200);
    expect(read.body).toMatchObject({ id: created.id, status: 'open' });
    expect(read.headers['cache-control']).toBe('no-store');

    const saved = await request(server)
      .patch(`/api/v1/listing-drafts/${created.id}`)
      .set('X-Listing-Token', created.token)
      .send(body({ step: 3 }))
      .expect(200);
    expect(saved.body).toMatchObject({ id: created.id, step: 3 });

    const link = await request(server)
      .post(`/api/v1/listing-drafts/${created.id}/continue-link`)
      .set('X-Listing-Token', created.token)
      .expect(202);
    expect(Date.parse(link.body.sentAt)).not.toBeNaN();
  });

  it('answers a missing, an unknown and another draft’s key alike', async () => {
    const { body: mine } = await create().expect(201);
    const { body: theirs } = await create().expect(201);
    const server = app.getHttpServer();

    const answers = await Promise.all([
      request(server).get('/api/v1/listing-drafts/current'),
      request(server)
        .get('/api/v1/listing-drafts/current')
        .set('X-Listing-Token', 'x'.repeat(43)),
      request(server)
        .patch(`/api/v1/listing-drafts/${theirs.id}`)
        .set('X-Listing-Token', mine.token)
        .send(body()),
      request(server)
        .post(`/api/v1/listing-drafts/${theirs.id}/continue-link`)
        .set('X-Listing-Token', mine.token),
    ]);

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toBe(answers[0]?.text);
    }
    expect(answers[0]?.body).toMatchObject({
      code: 'not_found',
      detail: 'No such draft',
    });
  });

  // @traces 115-FR-010
  it('checks the stored draft with the key, refusing what it lacks', async () => {
    const { body: created } = await create().expect(201);
    const server = app.getHttpServer();

    const res = await request(server)
      .post(`/api/v1/listing-drafts/${created.id}/check`)
      .set('X-Listing-Token', created.token)
      .expect(422);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      code: 'listing_incomplete',
      status: 422,
      warnings: [
        { code: 'document_missing', field: 'documents.onrc_certificate' },
        { code: 'document_missing', field: 'documents.rar_authorisation' },
      ],
    });
    expect(res.body.errors).toContainEqual({
      code: 'required',
      field: 'steps.1.phone',
    });
    expect(res.body.errors).not.toContainEqual(
      expect.objectContaining({ field: 'steps.1.name' }),
    );

    await request(server)
      .post(`/api/v1/listing-drafts/${created.id}/check`)
      .expect(404);
  });

  it('refuses a bad address with the field error the form shows', async () => {
    const res = await create(body({ email: 'not-an-email' })).expect(400);

    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'email_invalid', field: 'email' }],
    });
  });

  // @traces 1191-FR-006
  it.each([
    ['a photo', 'photos/upload-url', 'image/jpeg'],
    [
      'a document page',
      'documents/onrc_certificate/upload-url',
      'application/pdf',
    ],
  ])(
    'refuses %s address asked without a sound checksum with validation_failed',
    async (_what, path, contentType) => {
      const { body: created } = await create().expect(201);
      const ask = (extra: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/api/v1/listing-drafts/${created.id}/${path}`)
          .set('X-Listing-Token', created.token)
          .send({ contentType, size: 1024, ...extra });

      for (const extra of [
        {},
        { checksum: 'c8f43926' },
        { checksum: 'yPQ5Jh==' },
      ]) {
        const res = await ask(extra).expect(400);
        expect(res.body).toMatchObject({ code: 'validation_failed' });
      }
    },
  );

  it('takes a draft above the default body limit, up to its own', async () => {
    // Valid data no longer reaches 200 KB, so JSON's own whitespace does.
    const padded = `${JSON.stringify(body())}${' '.repeat(200 * 1024)}`;

    await request(app.getHttpServer())
      .post('/api/v1/listing-drafts')
      .set('X-Forwarded-For', freshAddress())
      .set('Content-Type', 'application/json')
      .send(padded)
      .expect(201);
  });

  it('refuses a draft above its limit with draft_too_large', async () => {
    const res = await create(
      body({ data: { files: filesOf(300 * 1024) } }),
    ).expect(413);

    expect(res.body).toMatchObject({ code: 'draft_too_large' });
  });

  it('refuses a body past what the API reads with 413, not a server error', async () => {
    const note = 'x'.repeat(340_000);

    const res = await create(body({ data: { survey: { note } } })).expect(413);

    expect(res.body).toMatchObject({ code: 'payload_too_large', status: 413 });
  });

  it('refuses a body that is not JSON', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/listing-drafts')
      .set('X-Forwarded-For', freshAddress())
      .type('form')
      .send('email=owner@example.test')
      .expect(415);
  });

  it('refuses the eleventh draft an hour from one address, naming the wait', async () => {
    const address = freshAddress();
    for (let i = 0; i < 10; i++) {
      await create(body(), address).expect(201);
    }
    sent.mockClear();

    const res = await create(body(), address).expect(429);

    expect(res.body).toMatchObject({ code: 'draft_rate_limited' });
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBe(String(res.body.retryAfterSeconds));
    expect(sent).not.toHaveBeenCalled();
  });

  it('documents exactly the draft, photo and document operations, and none that finds a draft by address', () => {
    const operations = Object.entries(openApiDocument(app).paths).flatMap(
      ([path, item]) =>
        Object.entries(item)
          .filter(([, op]) => op?.tags?.includes('listing-drafts'))
          .map(([method]) => `${method.toUpperCase()} ${path}`),
    );

    expect(operations.sort()).toEqual([
      'DELETE /api/v1/listing-drafts/{id}/documents/{kind}/{key}',
      'DELETE /api/v1/listing-drafts/{id}/photos/{key}',
      'GET /api/v1/listing-drafts/current',
      'GET /api/v1/listing-drafts/{id}/photos',
      'PATCH /api/v1/listing-drafts/{id}',
      'POST /api/v1/listing-drafts',
      'POST /api/v1/listing-drafts/{id}/check',
      'POST /api/v1/listing-drafts/{id}/continue-link',
      'POST /api/v1/listing-drafts/{id}/documents/{kind}',
      'POST /api/v1/listing-drafts/{id}/documents/{kind}/upload-url',
      'POST /api/v1/listing-drafts/{id}/photos',
      'POST /api/v1/listing-drafts/{id}/photos/upload-url',
    ]);
  });

  it("tags the admin's document page address apart, so the web's first download carries no client for it until a screen calls it", () => {
    const op =
      openApiDocument(app).paths[
        '/api/v1/admin/verification-files/{id}/documents/{documentId}/pages/{n}/download-url'
      ]?.get;

    expect(op?.tags).toEqual(['verification-documents']);
  });
});

// @traces 1181-FR-001
// @traces 1181-FR-003
// @traces 1181-FR-004
// @traces 1181-FR-011
describe('the upload addresses of a draft past their limit', () => {
  const store = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  const { key, limit, windowSeconds } = ROUTE_LIMITS.uploadUrl;
  const countOf = (draftId: string) =>
    `${key}:${createHash('sha256').update(draftId).digest('hex')}`;
  // Brings the draft to `calls` addresses in the window without asking them.
  const used = (draftId: string, calls: number) =>
    store.set(countOf(draftId), calls, 'EX', windowSeconds);
  const photo = (draft: { id: string; token: string }, token = draft.token) =>
    request(app.getHttpServer())
      .post(`/api/v1/listing-drafts/${draft.id}/photos/upload-url`)
      .set('X-Listing-Token', token)
      .send({ checksum: 'yPQ5Jg==', contentType: 'image/jpeg', size: 1024 });
  const page = (draft: { id: string; token: string }) =>
    request(app.getHttpServer())
      .post(
        `/api/v1/listing-drafts/${draft.id}/documents/onrc_certificate/upload-url`,
      )
      .set('X-Listing-Token', draft.token)
      .send({
        checksum: 'yPQ5Jg==',
        contentType: 'application/pdf',
        size: 1024,
      });

  afterAll(() => store.quit());

  it('counts photos and document pages as one, refuses the address past the limit with the wait, and issues it again once the window is over', async () => {
    const { body: draft } = await create().expect(201);
    await used(draft.id, limit - 1);

    const last = await photo(draft).expect(201);
    expect(last.body.url).toEqual(expect.any(String));
    const refused = await page(draft).expect(429);

    expect(refused.body).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(refused.body.url).toBeUndefined();
    const wait = Number(refused.headers['retry-after']);
    expect(wait).toBe(refused.body.retryAfterSeconds);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(windowSeconds);
    await photo(draft).expect(429);

    await store.del(countOf(draft.id));
    await page(draft).expect(201);
  });

  it('never refuses a second draft for the first one’s count', async () => {
    const { body: first } = await create().expect(201);
    const { body: second } = await create().expect(201);
    await used(first.id, limit);

    await photo(second).expect(201);
  });

  it('spends no count on a call whose draft key is wrong', async () => {
    const { body: draft } = await create().expect(201);

    await photo(draft, 'not-the-key').expect(404);

    expect(await store.get(countOf(draft.id))).toBeNull();
  });
});
