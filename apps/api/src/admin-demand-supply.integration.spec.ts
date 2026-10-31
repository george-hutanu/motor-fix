import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import { TURN_WAIT_MS } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 106-FR-008

const api = apiBoot();
let app: INestApplication;
let admin: string;

beforeAll(async () => {
  app = await api.start();
}, TURN_WAIT_MS);

beforeEach(async () => {
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `admin-${randomUUID()}` },
    name: 'admin',
    roles: ['admin'],
  });
  admin = `Bearer ${signAccessToken({ accountId: id, role: 'admin' } as never, TEST_TOKEN_SECRET, Date.now())}`;
});

afterAll(async () => {
  await api.stop();
});

describe('GET /api/v1/admin/demand/supply through the API', () => {
  it.each([
    ['an empty brand', '?brand='],
    ['a brand over 80 characters', `?brand=${'a'.repeat(81)}`],
    ['a malformed area', '?area=Sector%203'],
    ['an area that is not one', '?area=nowhere'],
    ['an unknown key', '?city=cluj-napoca'],
  ])('answers 400 validation_failed to %s', async (_, query) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/demand/supply${query}`)
      .set('Authorization', admin);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', status: 400 });
  });
});
