import { PRISMA } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot } from './api-boot.testing';
import { completeDraft, signedIn, submit } from './listing-submit.testing';

const api = apiBoot();
let app: INestApplication;

beforeAll(async () => {
  app = await api.start();
}, 120_000);

afterAll(() => api.stop());

// @traces 116-FR-013
describe('a sent listing before its approval', () => {
  it('appears in no public read: search, map pins, home, brands or its page', async () => {
    const { bearer } = await signedIn(app);
    const { brand, id, name, token } = await completeDraft(app);
    const sent = await submit(app, id, {
      Authorization: bearer,
      'Idempotency-Key': 'send-1',
      'X-Listing-Token': token,
    }).expect(201);
    const { slug, status } = await app
      .get(PRISMA)
      .garage.findUniqueOrThrow({ where: { id: sent.body.garageId } });
    expect(status).toBe('draft');
    const server = app.getHttpServer();

    for (const path of [
      `/api/v1/search/garages?brand=${brand.slug}`,
      `/api/v1/search/garages/pins?brand=${brand.slug}`,
      `/api/v1/home?brand=${brand.slug}`,
      '/api/v1/brands/popular',
    ]) {
      const res = await request(server).get(path);
      expect(res.status).toBeLessThan(500);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(sent.body.garageId);
      expect(text).not.toContain(name);
      expect(text).not.toContain(slug);
    }
    await request(server).get(`/api/v1/garages/${slug}`).expect(404);
  });
});
