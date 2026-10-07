// @traces 472-FR-001 472-FR-002
import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// Signed-in 400s through the app as production sets it up, ProblemFilter
// included, so the answer's code is checked and not only its status.
const api = apiBoot();

let app: INestApplication;
let bearer: string;

beforeAll(async () => {
  app = await api.start();
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `garage-${randomUUID()}` },
    name: 'Ion',
    roles: ['garage', 'driver'],
  });
  bearer = `Bearer ${signAccessToken({ accountId: id, role: 'garage' }, TEST_TOKEN_SECRET, Date.now())}`;
}, 120_000);

afterAll(() => api.stop());

describe('a signed-in request that fails validation', () => {
  it('answers validation_failed on the audit history', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-history')
      .query({ limit: '100' })
      .set('Authorization', bearer);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', status: 400 });
  });

  it('answers validation_failed on the role switch', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/roles/switch')
      .send({ role: 'owner' })
      .set('Authorization', bearer);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', status: 400 });
  });
});
