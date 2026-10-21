import { randomUUID } from 'node:crypto';

import type { JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';

const { bearer, get, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;

async function setting(status: JobStatus = 'done') {
  const andrei = await world.account('Andrei Marin', ['driver', 'garage']);
  await prisma.account.update({
    data: { email: `${andrei}@example.ro`, emailVerifiedAt: new Date() },
    where: { id: andrei },
  });
  const dinamo = await team('Atelier Dinamo');
  const job = await jobAt(andrei, dinamo.garage.id, status);
  return { andrei, as: bearer(andrei, 'driver'), dinamo, job };
}

async function jobAt(driverId: string, garageId: string, status: JobStatus) {
  const { booking } = await world.chain(driverId, garageId);
  return world.job(booking.id, status);
}

const read = (auth: string | undefined, query: string) =>
  get(`/reviews/eligibility${query}`, auth);

// @traces 023-FR-013
describe('the query string of the eligibility read', () => {
  it('answers 400 when jobIds is given twice as separate keys', async () => {
    const s = await setting();
    const other = await jobAt(s.andrei, s.dinamo.garage.id, 'done');

    const res = await read(s.as, `?jobIds=${s.job.id}&jobIds=${other.id}`);

    expect(res.status).toBe(400);
  });

  it('answers 400 when jobIds is missing or empty', async () => {
    const s = await setting();

    expect((await read(s.as, '')).status).toBe(400);
    expect((await read(s.as, '?jobIds=')).status).toBe(400);
  });

  it('answers 400 for an unrelated key alone', async () => {
    const s = await setting();

    expect((await read(s.as, `?ids=${s.job.id}`)).status).toBe(400);
  });

  it('answers a mixed-case UUID in lower case, once, with its lower-case twin', async () => {
    const s = await setting();
    const other = await jobAt(s.andrei, s.dinamo.garage.id, 'done');
    const mixed = s.job.id.replace(/[a-f]/, (c) => c.toUpperCase());

    const res = await read(
      s.as,
      `?jobIds=${mixed},${other.id},${s.job.id.toUpperCase()},${s.job.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { jobId: s.job.id, offer: true, reason: null },
      { jobId: other.id, offer: true, reason: null },
    ]);
  });

  it('answers an upper-case unknown id in lower case as not_found', async () => {
    const s = await setting();
    const unknown = randomUUID();

    const res = await read(s.as, `?jobIds=${unknown.toUpperCase()}`);

    expect(res.body).toEqual([
      { jobId: unknown, offer: false, reason: 'not_found' },
    ]);
  });

  it('answers 400 for fifty-one ids of which two are the same, since the cap counts what was sent', async () => {
    const s = await setting();
    const ids = Array.from({ length: 50 }, () => randomUUID());

    const res = await read(s.as, `?jobIds=${[...ids, ids[0]].join(',')}`);

    expect(res.status).toBe(400);
  });

  it('answers 400 for fifty-one upper-case and lower-case spellings of fifty ids', async () => {
    const s = await setting();
    const ids = Array.from({ length: 50 }, () => randomUUID());

    const res = await read(
      s.as,
      `?jobIds=${[...ids, ids[0].toUpperCase()].join(',')}`,
    );

    expect(res.status).toBe(400);
  });

  it('answers 200 with fifty answers for fifty distinct upper-case ids', async () => {
    const s = await setting();
    const ids = Array.from({ length: 50 }, () => randomUUID());

    const res = await read(
      s.as,
      `?jobIds=${ids.map((i) => i.toUpperCase()).join(',')}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.map((r: { jobId: string }) => r.jobId)).toEqual(ids);
  });

  it.each([
    ['a leading space', (a: string) => `%20${a}`],
    ['a trailing space', (a: string) => `${a}%20`],
    ['a tab', (a: string) => `${a}%09`],
    ['a newline', (a: string) => `${a}%0A`],
    ['a leading comma', (a: string) => `,${a}`],
  ])('answers 400 for %s', async (_, build) => {
    const s = await setting();

    const res = await read(s.as, `?jobIds=${build(s.job.id)}`);

    expect(res.status).toBe(400);
  });
});

// @traces 023-FR-003
describe('who may read eligibility', () => {
  it('answers 404 to an account that only has the garage role, with its own garage’s job id', async () => {
    const s = await setting();

    const res = await read(
      bearer(s.dinamo.owner, 'garage'),
      `?jobIds=${s.job.id}`,
    );

    expect(res.status).toBe(404);
  });

  it('answers 401 without a session, even for a malformed list', async () => {
    expect((await read(undefined, '?jobIds=nope')).status).toBe(401);
    expect((await read(undefined, '')).status).toBe(401);
  });

  it('answers 404 before 400 to a non-driver sending a malformed list', async () => {
    const s = await setting();

    const res = await read(bearer(s.dinamo.owner, 'garage'), '?jobIds=nope');

    expect(res.status).toBe(404);
  });
});
