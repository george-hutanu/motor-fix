import { randomBytes } from 'node:crypto';

import { NotificationsService } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
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

  it('refuses a bad address with the field error the form shows', async () => {
    const res = await create(body({ email: 'not-an-email' })).expect(400);

    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'email_invalid', field: 'email' }],
    });
  });

  it('takes a draft above the default body limit, up to its own', async () => {
    const note = 'x'.repeat(200 * 1024);

    await create(body({ data: { survey: { note } } })).expect(201);
  });

  it('refuses a draft above its limit with draft_too_large', async () => {
    const note = 'x'.repeat(300 * 1024);

    const res = await create(body({ data: { survey: { note } } })).expect(413);

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
