import { randomBytes } from 'node:crypto';

import { NotificationsService } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot } from './api-boot.testing';

const api = apiBoot();
let app: INestApplication;
let sent: jest.SpyInstance;
const webUrl = process.env['PUBLIC_WEB_URL'];

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

const address = () =>
  `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;

// A JSON object of exactly this many bytes.
const jsonOf = (bytes: number) => {
  const shell = '{"pad":""}'.length;
  return `{"pad":"${'a'.repeat(bytes - shell)}"}`;
};

const post = (path: string, raw: string) =>
  request(app.getHttpServer())
    .post(path)
    .set('X-Forwarded-For', address())
    .set('Content-Type', 'application/json')
    .send(raw);

const LIMIT = 100 * 1024;
const DRAFT_LIMIT = 320 * 1024;

// @traces 116-FR-030
describe('the JSON body limit on routes outside the listing drafts', () => {
  it('reads a body of exactly 100 KB and refuses one byte more with 413 payload_too_large', async () => {
    const at = await post('/api/v1/quote-requests', jsonOf(LIMIT));
    const over = await post('/api/v1/quote-requests', jsonOf(LIMIT + 1));

    expect(at.status).not.toBe(413);
    expect(over.status).toBe(413);
    expect(over.body).toMatchObject({ code: 'payload_too_large', status: 413 });
  });

  it.each([
    '/api/v1/quote-requests',
    '/api/v1/auth/sign-in',
    '/api/v1/auth/password-reset',
    '/api/v1/quotes',
  ])('answers 413 to 200 KB on %s before any session check', async (path) => {
    const res = await post(path, jsonOf(200 * 1024));

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload_too_large');
  });

  it('does not give a path that only starts like the listing drafts their larger limit', async () => {
    for (const path of [
      '/api/v1/listing-drafts-extra',
      '/api/v1/listing-draftsx/anything',
      '/api/v1/x/listing-drafts',
    ]) {
      const res = await post(path, jsonOf(200 * 1024));
      expect(res.status).toBe(413);
    }
  });

  it('gives the 413 no stack trace', async () => {
    const res = await post('/api/v1/quote-requests', jsonOf(200 * 1024));

    expect(res.text).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });
});

// @traces 116-FR-030
describe('the JSON body limit under the listing drafts', () => {
  it('reads a body of exactly 320 KB past the 100 KB of the rest, and refuses one byte more', async () => {
    const at = await post('/api/v1/listing-drafts', jsonOf(DRAFT_LIMIT));
    const over = await post('/api/v1/listing-drafts', jsonOf(DRAFT_LIMIT + 1));

    expect(at.status).not.toBe(413);
    expect(over.status).toBe(413);
    expect(over.body).toMatchObject({ code: 'payload_too_large', status: 413 });
  });

  it('reads 200 KB on the send route and the continue link too', async () => {
    const id = '3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10';
    for (const path of [
      `/api/v1/listing-drafts/${id}/submit`,
      `/api/v1/listing-drafts/${id}/continue-link`,
      `/api/v1/listing-drafts/${id}/check`,
    ]) {
      const res = await post(path, jsonOf(200 * 1024));
      expect(res.status).not.toBe(413);
    }
  });
});

// @traces 116-FR-031
describe('the draft e-mail cap', () => {
  const email = (length: number) => {
    const domain = 'b'.repeat(61 + (length - 254));
    return `${'a'.repeat(64)}@${'b'.repeat(63)}.${'b'.repeat(63)}.${domain}`;
  };
  const create = (value: unknown) =>
    request(app.getHttpServer())
      .post('/api/v1/listing-drafts')
      .set('X-Forwarded-For', address())
      .send({
        data: { steps: { '1': { name: 'Service' } } },
        email: value,
        language: 'ro',
        step: 1,
      });

  it('refuses 255 characters with 400 validation_failed', async () => {
    expect(email(254)).toHaveLength(254);
    const res = await create(email(255));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('counts the characters after trimming, so padding does not turn 254 into a refusal', async () => {
    const res = await create(`   ${email(254)}   `);

    expect(res.status).toBe(201);
  });

  it.each([[null], [12345], [['a@b.co']], [{}]])(
    'refuses %j as an e-mail with 400',
    async (value) => {
      const res = await create(value);

      expect(res.status).toBe(400);
    },
  );

  it('refuses an e-mail that is only spaces', async () => {
    const res = await create(' '.repeat(10));

    expect(res.status).toBe(400);
  });
});
