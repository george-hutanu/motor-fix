import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import { TURN_WAIT_MS } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

const api = apiBoot();

let app: INestApplication;
let authorization: string;

beforeAll(async () => {
  app = await api.start();
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `admin-${randomUUID()}` },
    name: 'admin',
    roles: ['admin'],
  });
  authorization = `Bearer ${signAccessToken({ accountId: id, role: 'admin' }, TEST_TOKEN_SECRET, Date.now())}`;
}, TURN_WAIT_MS);

afterAll(() => api.stop());

const server = () => request(app.getHttpServer());
const unique = () => `Zq${randomUUID().replace(/-/g, '').slice(0, 10)}`;

// The admin brand refusals as the booted API sends them, through its
// ProblemFilter (the domain specs read the exception before it).
describe('the admin brand refusals on the wire', () => {
  // @traces 105-FR-006
  it('answer a stale save with the current brand', async () => {
    const created = await server()
      .post('/api/v1/admin/brands')
      .set('Authorization', authorization)
      .send({ name: unique() });
    expect(created.status).toBe(201);
    const renamed = unique();
    const first = await server()
      .patch(`/api/v1/admin/brands/${created.body.id}`)
      .set('Authorization', authorization)
      .send({ name: renamed, seenUpdatedAt: created.body.updatedAt });
    expect(first.status).toBe(200);

    const late = await server()
      .patch(`/api/v1/admin/brands/${created.body.id}`)
      .set('Authorization', authorization)
      .send({ active: false, seenUpdatedAt: created.body.updatedAt });

    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({
      brand: {
        id: created.body.id,
        name: renamed,
        state: 'active',
        updatedAt: first.body.updatedAt,
      },
      code: 'stale_value',
      status: 409,
    });
  });

  // @traces 105-FR-005
  it('answer a duplicate name with its words as the detail', async () => {
    const name = unique();
    await server()
      .post('/api/v1/admin/brands')
      .set('Authorization', authorization)
      .send({ name });

    const again = await server()
      .post('/api/v1/admin/brands')
      .set('Authorization', authorization)
      .send({ name: name.toUpperCase() });

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'brand_exists',
      detail: `Marca există deja: ${name}`,
    });
  });
});
