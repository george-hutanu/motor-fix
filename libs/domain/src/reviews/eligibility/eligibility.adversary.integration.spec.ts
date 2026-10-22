import { randomUUID } from 'node:crypto';

import type { JobStatus, ReviewStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';

const { bearer, get, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;

async function setting(status: JobStatus = 'done') {
  const andrei = await world.account('Andrei Marin', ['driver', 'garage']);
  await prisma.account.update({
    data: { email: `${andrei}@example.ro`, emailVerifiedAt: new Date() },
    where: { id: andrei },
  });
  const dinamo = await team('Atelier Dinamo');
  const job = await jobAt(andrei, dinamo.garage.id, status);
  return {
    andrei,
    as: bearer(andrei, 'driver'),
    asGarage: bearer(andrei, 'garage'),
    dinamo,
    job,
  };
}
type Setting = Awaited<ReturnType<typeof setting>>;

async function jobAt(driverId: string, garageId: string, status: JobStatus) {
  const { booking } = await world.chain(driverId, garageId);
  return world.job(booking.id, status);
}

const publish = (auth: string, body: object) =>
  send('post', '/reviews', auth, body);
const eligibility = (auth: string, raw: string) =>
  get(`/reviews/eligibility?jobIds=${raw}`, auth);
const member = (s: Setting, garageId = s.dinamo.garage.id) =>
  prisma.garageMember.create({
    data: { accountId: s.andrei, garageId, role: 'receptionist' },
  });
const reviewIn = (s: Setting, status: ReviewStatus, jobId = s.job.id) =>
  prisma.review.create({
    data: {
      driverId: s.andrei,
      garageId: s.dinamo.garage.id,
      jobId,
      rating: 3,
      status,
    },
  });
const rows = async () => ({
  events: await prisma.outboxEvent.count(),
  logs: await prisma.activityLog.count(),
  reviews: await prisma.review.count(),
});

// @traces 023-FR-003
describe('an account that holds a garage session and a driver session', () => {
  it('answers 404 on the garage session for the eligibility read and the publish, and writes no review', async () => {
    const s = await setting();
    await member(s);

    const read = await eligibility(s.asGarage, s.job.id);
    const posted = await publish(s.asGarage, { jobId: s.job.id, rating: 5 });

    expect(read.status).toBe(404);
    expect(posted.status).toBe(404);
    expect(await prisma.review.count()).toBe(0);
  });

  it('refuses its own garage on the driver session of the same account', async () => {
    const s = await setting();
    await member(s);

    const read = await eligibility(s.as, s.job.id);

    expect(read.body).toEqual([
      { jobId: s.job.id, offer: false, reason: 'own_garage' },
    ]);
  });
});

// @traces 023-FR-013
describe('the id list of the eligibility read', () => {
  it('accepts upper-case UUIDs for the caller’s job', async () => {
    const s = await setting();

    const read = await eligibility(s.as, s.job.id.toUpperCase());

    expect(read.status).toBe(200);
    expect(read.body).toHaveLength(1);
    expect(read.body[0]).toMatchObject({ offer: true, reason: null });
  });

  it.each([
    ['a space after the comma', (a: string, b: string) => `${a},%20${b}`],
    ['a trailing comma', (a: string) => `${a},`],
    ['an empty element', (a: string, b: string) => `${a},,${b}`],
    ['a braced UUID', (a: string) => `%7B${a}%7D`],
  ])('answers 400 for %s', async (_, build) => {
    const s = await setting();
    const other = await jobAt(s.andrei, s.dinamo.garage.id, 'done');

    const read = await eligibility(s.as, build(s.job.id, other.id));

    expect(read.status).toBe(400);
  });

  it('answers 400 for fifty-one ids and 200 for fifty', async () => {
    const s = await setting();
    const ids = Array.from({ length: 51 }, () => randomUUID());

    expect((await eligibility(s.as, ids.join(','))).status).toBe(400);
    expect((await eligibility(s.as, ids.slice(1).join(','))).status).toBe(200);
  });

  it('answers another driver’s done, reviewed job as not_found, same as an unknown id', async () => {
    const s = await setting();
    const bianca = await world.account('Bianca Pop', ['driver']);
    const theirs = await jobAt(bianca, s.dinamo.garage.id, 'done');
    await prisma.review.create({
      data: {
        driverId: bianca,
        garageId: s.dinamo.garage.id,
        jobId: theirs.id,
        rating: 4,
        status: 'removed',
      },
    });
    const unknown = randomUUID();

    const read = await eligibility(s.as, `${theirs.id},${s.job.id},${unknown}`);

    expect(read.body).toEqual([
      { jobId: theirs.id, offer: false, reason: 'not_found' },
      { jobId: s.job.id, offer: true, reason: null },
      { jobId: unknown, offer: false, reason: 'not_found' },
    ]);
  });
});

// @traces 023-FR-005
describe('staff status of the caller', () => {
  it('refuses a member of the garage who is also a mechanic of another, on both garages’ jobs', async () => {
    const s = await setting();
    const nord = await team('Service Nord');
    await member(s);
    await prisma.mechanic.create({
      data: { accountId: s.andrei, garageId: nord.garage.id, name: 'Andrei' },
    });
    const atNord = await jobAt(s.andrei, nord.garage.id, 'done');

    const read = await eligibility(s.as, `${s.job.id},${atNord.id}`);

    expect(read.body).toEqual([
      { jobId: s.job.id, offer: false, reason: 'own_garage' },
      { jobId: atNord.id, offer: false, reason: 'own_garage' },
    ]);
  });

  it('lets a mechanic of another garage review, on the read and the publish', async () => {
    const s = await setting();
    const nord = await team('Service Nord');
    await prisma.mechanic.create({
      data: { accountId: s.andrei, garageId: nord.garage.id, name: 'Andrei' },
    });

    const read = await eligibility(s.as, s.job.id);
    const posted = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(read.body[0]).toMatchObject({ offer: true, reason: null });
    expect(posted.status).toBe(201);
  });

  it('follows an account that left the garage and rejoined it', async () => {
    const s = await setting();
    await member(s);
    await prisma.garageMember.deleteMany({ where: { accountId: s.andrei } });
    const left = await eligibility(s.as, s.job.id);
    await member(s);

    const rejoined = await eligibility(s.as, s.job.id);
    const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(left.body[0].reason).toBeNull();
    expect(rejoined.body[0].reason).toBe('own_garage');
    expect(refused.status).toBe(403);
  });
});

// @traces 023-FR-007 023-FR-008
describe('a job with a deleted review and then a removed one', () => {
  it('answers review_removed on the read and the publish', async () => {
    const s = await setting();
    await reviewIn(s, 'deleted_by_author');
    const afterDelete = await eligibility(s.as, s.job.id);
    await reviewIn(s, 'removed');

    const read = await eligibility(s.as, s.job.id);
    const posted = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(afterDelete.body[0]).toMatchObject({ offer: true, reason: null });
    expect(read.body[0]).toEqual({
      jobId: s.job.id,
      offer: false,
      reason: 'review_removed',
    });
    expect(posted.status).toBe(409);
    expect(posted.body.code).toBe('review_removed');
    expect(posted.body.currentStatus).toBe('removed');
  });
});

// @traces 023-FR-013 023-FR-014 023-FR-017
describe('reading eligibility', () => {
  it('writes no review, outbox event or activity row, twice over', async () => {
    const s = await setting();
    await member(s);
    const done = await jobAt(s.andrei, s.dinamo.garage.id, 'done');
    const before = await rows();

    const first = await eligibility(
      s.as,
      `${s.job.id},${done.id},${randomUUID()}`,
    );
    const drawer = await get(`/reviews/job/${s.job.id}`, s.as);
    const second = await eligibility(s.as, `${s.job.id},${done.id}`);

    expect(first.status).toBe(200);
    expect(drawer.body.eligibility).toEqual({
      jobId: s.job.id,
      offer: false,
      reason: 'own_garage',
    });
    expect(second.body).toEqual(first.body.slice(0, 2));
    expect(await rows()).toEqual(before);
  });
});
