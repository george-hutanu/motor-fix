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

// A done job at Garaj Nordic, already handed over at 1.150 lei, and its
// owner's bearer.
async function handedOver() {
  const prisma = app.get(PRISMA);
  const world = quotesWorld(prisma);
  const driver = await world.account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Garaj Nordic');
  const owner = await world.account('Nordic Owner', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const { booking } = await world.chain(driver, garage.id, {
    booking: 'completed',
    request: 'done',
  });
  const created = await world.job(booking.id, 'done');
  const job = await prisma.job.update({
    data: {
      finalPriceBani: 115_000,
      finalPriceRecordedById: owner,
      handedOverAt: new Date(),
    },
    where: { id: created.id },
  });
  const auth = `Bearer ${signAccessToken({ accountId: owner, role: 'garage' }, TEST_TOKEN_SECRET, Date.now())}`;
  return { auth, job };
}

// The refusal as the booted API sends it, through its ProblemFilter (the
// domain specs read the exception before it).
// @traces 406-FR-002
describe('a second handover on the wire', () => {
  it('answers 409 already_handed_over naming the price recorded', async () => {
    const { auth, job } = await handedOver();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/garage/jobs/${job.id}/handover`)
      .set('Authorization', auth)
      .send({ finalPriceBani: 120_000 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'already_handed_over',
      finalPriceBani: 115_000,
    });
  });
});
