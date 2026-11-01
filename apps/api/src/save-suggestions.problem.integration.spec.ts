import { PRISMA, signAccessToken } from '@motor-fix/domain';
import { quotesWorld, TURN_WAIT_MS } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

const api = apiBoot();
let app: INestApplication;

beforeAll(async () => {
  app = await api.start();
}, TURN_WAIT_MS);

afterAll(() => api.stop());

// The refusal of a malformed garage id as the booted API sends it, through
// its ProblemFilter (the domain spec reads the status before it).
// @traces 293-FR-002 293-FR-007
describe('a malformed garage id on the wire', () => {
  it('answers 400 validation_failed and records nothing', async () => {
    const prisma = app.get(PRISMA);
    const driver = await quotesWorld(prisma).account('Andrei Marin', [
      'driver',
    ]);
    const auth = `Bearer ${signAccessToken({ accountId: driver, role: 'driver' }, TEST_TOKEN_SECRET, Date.now())}`;

    const res = await request(app.getHttpServer())
      .post('/api/v1/me/save-suggestions/not-a-uuid/dismiss')
      .set('Authorization', auth);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
    expect(
      await prisma.saveSuggestionDismissal.count({
        where: { accountId: driver },
      }),
    ).toBe(0);
  });
});
