import type { Role } from '@motor-fix/contracts/capabilities';
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

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, TEST_TOKEN_SECRET, Date.now())}`;

// A received job at Atelier Vlad, its mechanic Vlad's, with the owner's and
// the mechanic's bearers.
async function received() {
  const prisma = app.get(PRISMA);
  const world = quotesWorld(prisma);
  const driver = await world.account('Andrei Marin', ['driver']);
  const garage = await world.garage('Atelier Vlad');
  const owner = await world.account('Ion Popescu', ['garage']);
  const hand = await world.account('Vlad Dobre', ['mechanic']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const mechanic = await prisma.mechanic.create({
    data: { accountId: hand, garageId: garage.id, name: 'Vlad' },
  });
  const { booking } = await world.chain(driver, garage.id, {
    request: 'booked',
  });
  const created = await world.job(booking.id, 'to_do', {
    mechanicId: mechanic.id,
  });
  const job = await prisma.job.update({
    data: { receivedAt: new Date() },
    where: { id: created.id },
  });
  return {
    hand: bearer(hand, 'mechanic'),
    job,
    owner: bearer(owner, 'garage'),
  };
}

const post = (path: string, auth: string, body?: object, key?: string) => {
  const call = request(app.getHttpServer())
    .post(`/api/v1${path}`)
    .set('Authorization', auth);
  if (key) call.set('Idempotency-Key', key);
  return call.send(body);
};

// The refusals as the booted API sends them, through its ProblemFilter (the
// domain specs read the exception before it).
// @traces 395-FR-001 395-FR-004
describe('a change on a locked job on the wire', () => {
  it('answers 423 job_locked naming the holder and since when', async () => {
    const s = await received();
    const held = await post(`/garage/jobs/${s.job.id}/lock`, s.hand);
    expect(held.status).toBe(200);

    const res = await post(
      `/garage/jobs/${s.job.id}/steps`,
      s.owner,
      { text: 'Lichid verificat' },
      'k-locked',
    );

    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({
      code: 'job_locked',
      detail: expect.stringMatching(
        /^Blocat de Vlad, mecanic, de la \d\d:\d\d$/,
      ),
      holder: { firstName: 'Vlad', role: 'mechanic', since: held.body.since },
    });
  });
});

// @traces 395-FR-005
describe('a stale change on the wire', () => {
  it('answers 409 job_changed with the current job and its version', async () => {
    const s = await received();
    const before = await app
      .get(PRISMA)
      .job.findUniqueOrThrow({ where: { id: s.job.id } });
    const first = await post(
      `/garage/jobs/${s.job.id}/steps`,
      s.owner,
      { text: 'Etriere demontate' },
      'k-first',
    );
    expect(first.status).toBe(201);

    const res = await post(
      `/garage/jobs/${s.job.id}/steps`,
      s.hand,
      {
        basedOnUpdatedAt: before.updatedAt.toISOString(),
        text: 'Placute verificate',
      },
      'k-stale',
    );

    const now = await app
      .get(PRISMA)
      .job.findUniqueOrThrow({ where: { id: s.job.id } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'job_changed',
      job: { id: s.job.id, updatedAt: now.updatedAt.toISOString() },
      updatedAt: now.updatedAt.toISOString(),
    });
  });
});
