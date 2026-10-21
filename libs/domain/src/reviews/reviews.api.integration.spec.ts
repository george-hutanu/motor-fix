import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { ReviewsModule } from './reviews.module';
import { outbox } from '../events/event.port';
import type { JobStatus, ReviewStatus } from '../generated/prisma/enums';
import { quotesApp } from '../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;

const confirmed = (accountId: string) =>
  prisma.account.update({
    data: { email: `${accountId}@example.ro`, emailVerifiedAt: new Date() },
    where: { id: accountId },
  });

// Andrei's job at Atelier Dinamo, its accepted quote holding the one asked
// work, and his e-mail confirmed.
async function setting(status: JobStatus = 'done') {
  const andrei = await world.account('Andrei Marin', ['driver']);
  await confirmed(andrei);
  const dinamo = await team('Atelier Dinamo');
  const { booking, quote, request } = await world.chain(
    andrei,
    dinamo.garage.id,
  );
  const [asked] = await prisma.requestJob.findMany({
    where: { requestId: request.id },
  });
  await prisma.quoteJob.create({
    data: { included: true, quoteId: quote.id, requestJobId: asked.id },
  });
  const job = await world.job(booking.id, status);
  return { andrei, as: bearer(andrei, 'driver'), asked, dinamo, job };
}

const publish = (auth: string, body: object) =>
  send('post', '/reviews', auth, body);

const reviews = (jobId: string) =>
  prisma.review.findMany({ orderBy: { createdAt: 'asc' }, where: { jobId } });

const reviewIn = (
  s: Awaited<ReturnType<typeof setting>>,
  status: ReviewStatus,
) =>
  prisma.review.create({
    data: {
      driverId: s.andrei,
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
      paidBani: 89_000,
      rating: 3,
      status,
      text: 'Au întârziat o zi.',
    },
  });

const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({ where: { kind: 'review.posted', subjectId } });

const audits = (jobId: string) =>
  prisma.activityLog.findMany({ where: { jobId, subjectType: 'review' } });

// @traces 022-FR-014
describe('reading a job for its review', () => {
  it('answers the garage, the car, the work, the status and no review', async () => {
    const s = await setting();

    const read = await get(`/reviews/job/${s.job.id}`, s.as);

    expect(read.status).toBe(200);
    expect(read.body).toEqual({
      author: { shortName: 'Andrei M.' },
      car: {
        brand: 'Mini',
        engine: '2.0 turbo',
        fuel: 'petrol',
        model: 'Cooper S',
        year: 2019,
      },
      eligibility: { jobId: s.job.id, offer: true, reason: null },
      emailConfirmed: true,
      existing: null,
      garage: {
        id: s.dinamo.garage.id,
        name: 'Atelier Dinamo',
        slug: s.dinamo.garage.slug,
      },
      hasEmail: true,
      job: { id: s.job.id, status: 'done' },
      jobs: [
        {
          id: s.asked.id,
          jobTypeId: s.asked.jobTypeId,
          nameEn: 'Oil change',
          nameRo: 'Schimb ulei',
          position: 0,
        },
      ],
    });
  });

  it('answers a job that is not done with its status', async () => {
    const s = await setting('in_work');

    const read = await get(`/reviews/job/${s.job.id}`, s.as);

    expect(read.status).toBe(200);
    expect(read.body.job).toEqual({ id: s.job.id, status: 'in_work' });
  });

  it('leaves out a work the accepted quote did not include', async () => {
    const s = await setting();
    await prisma.quoteJob.updateMany({ data: { included: false } });

    const read = await get(`/reviews/job/${s.job.id}`, s.as);

    expect(read.body.jobs).toEqual([]);
  });

  it('refuses an id that is not a UUID', async () => {
    const s = await setting();

    expect((await get('/reviews/job/not-a-job', s.as)).status).toBe(400);
  });
});

// @traces 022-FR-014 022-FR-016
// @traces 022-FR-024 022-FR-025
describe('publishing a review', () => {
  it('saves a rating alone as a published review of the job', async () => {
    const s = await setting();
    const before = Date.now();

    const posted = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(posted.status).toBe(201);
    expect(posted.body).toEqual({
      id: expect.any(String),
      jobId: s.job.id,
      paidBani: null,
      postedAt: expect.any(String),
      rating: 5,
      status: 'published',
      text: null,
    });
    const [row] = await reviews(s.job.id);
    expect(row).toMatchObject({
      driverId: s.andrei,
      garageId: s.dinamo.garage.id,
      id: posted.body.id,
      mechanicId: null,
      paidBani: null,
      rating: 5,
      source: 'job',
      status: 'published',
      text: null,
    });
    expect(row.postedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.postedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('writes its audit entry and its event with it', async () => {
    const s = await setting();

    const posted = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(await audits(s.job.id)).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: s.andrei,
        actorRole: 'driver',
        carId: s.job.carId,
        garageId: s.dinamo.garage.id,
        jobId: s.job.id,
        subjectId: posted.body.id,
        subjectType: 'review',
      }),
    ]);
    const [event] = await events(posted.body.id);
    expect(event.payload).toEqual({
      driverId: s.andrei,
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
      rating: 5,
      reviewId: posted.body.id,
    });
  });

  it('saves the comment and the amount', async () => {
    const s = await setting();

    const posted = await publish(s.as, {
      jobId: s.job.id,
      paidBani: 420_050,
      rating: 4,
      text: '  Gata la timp.  ',
    });

    expect(posted.status).toBe(201);
    expect(await reviews(s.job.id)).toEqual([
      expect.objectContaining({ paidBani: 420_050, text: 'Gata la timp.' }),
    ]);
  });

  it('leaves no review, audit entry or event when the event cannot be written', async () => {
    const s = await setting();
    const posted = () =>
      prisma.outboxEvent.count({ where: { kind: 'review.posted' } });
    const before = await posted();
    jest
      .spyOn(outbox, 'record')
      .mockRejectedValueOnce(new Error('outbox down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(refused.status).toBe(500);
    expect(await reviews(s.job.id)).toEqual([]);
    expect(await audits(s.job.id)).toEqual([]);
    expect(await posted()).toBe(before);
  });

  it('needs a session', async () => {
    const s = await setting();

    expect((await get(`/reviews/job/${s.job.id}`)).status).toBe(401);
  });
});

// @traces 022-FR-015 022-FR-017
// @traces 022-FR-018 022-FR-023
describe('what a review may hold', () => {
  it.each([420_000, 420_050, 1, 100_000_000])(
    'saves %p bani exactly',
    async (paidBani) => {
      const s = await setting();

      const posted = await publish(s.as, {
        jobId: s.job.id,
        paidBani,
        rating: 4,
      });

      expect(posted.status).toBe(201);
      expect((await reviews(s.job.id))[0].paidBani).toBe(paidBani);
    },
  );

  it.each([
    [{ paidBani: 0 }, 'paidBani', 'range'],
    [{ paidBani: -1 }, 'paidBani', 'range'],
    [{ paidBani: 100_000_001 }, 'paidBani', 'range'],
    [{ rating: 0 }, 'rating', 'range'],
    [{ rating: 6 }, 'rating', 'range'],
    [{ text: 'x'.repeat(2001) }, 'text', 'length'],
  ])('refuses %p with 422', async (over, field, code) => {
    const s = await setting();

    const refused = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      ...over,
    });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code, field }],
    });
    expect(await reviews(s.job.id)).toEqual([]);
  });

  it('saves a comment of 2,000 characters', async () => {
    const s = await setting();

    const posted = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      text: 'x'.repeat(2000),
    });

    expect(posted.status).toBe(201);
  });

  it('stores a blank comment as none', async () => {
    const s = await setting();

    await publish(s.as, { jobId: s.job.id, rating: 4, text: '   ' });

    expect((await reviews(s.job.id))[0].text).toBeNull();
  });

  it.each([
    [{ rating: 4.5 }],
    [{ rating: '4' }],
    [{ paidBani: 4200.5 }],
    [{ car: { brand: 'BMW', model: '320d' } }],
    [{ jobs: ['Schimb ulei'] }],
    [{ driverId: randomUUID() }],
  ])('refuses %p with 400 before reading it', async (over) => {
    const s = await setting();

    const refused = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      ...over,
    });

    expect(refused.status).toBe(400);
    expect(await reviews(s.job.id)).toEqual([]);
  });
});

// @traces 022-FR-012 022-FR-019
// @traces 022-FR-020 022-FR-021 022-FR-026
// @traces 023-FR-004 023-FR-010
describe('who may review a job, and when', () => {
  it('answers 404 for a job that does not exist', async () => {
    const s = await setting();

    const id = randomUUID();
    expect((await get(`/reviews/job/${id}`, s.as)).status).toBe(404);
    expect((await publish(s.as, { jobId: id, rating: 4 })).status).toBe(404);
  });

  it('answers 404 for another driver’s job', async () => {
    const s = await setting();
    const ioana = await world.account('Ioana Pop', ['driver']);
    await confirmed(ioana);
    const as = bearer(ioana, 'driver');

    expect((await get(`/reviews/job/${s.job.id}`, as)).status).toBe(404);
    expect((await publish(as, { jobId: s.job.id, rating: 4 })).status).toBe(
      404,
    );
    expect(await reviews(s.job.id)).toEqual([]);
  });

  it('answers 404 to garage staff, never 403', async () => {
    const s = await setting();
    const owner = bearer(s.dinamo.owner, 'garage');

    expect((await get(`/reviews/job/${s.job.id}`, owner)).status).toBe(404);
    expect((await publish(owner, { jobId: s.job.id, rating: 4 })).status).toBe(
      404,
    );
  });

  it.each(['to_do', 'in_work', 'cancelled'] as JobStatus[])(
    'answers 409 job_not_done for a job %s',
    async (status) => {
      const s = await setting(status);

      const refused = await publish(s.as, { jobId: s.job.id, rating: 4 });

      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'job_not_done',
        currentStatus: status,
        entity: 'job',
      });
      expect(await reviews(s.job.id)).toEqual([]);
    },
  );

  it.each([
    ['published', 'already_reviewed'],
    ['reported', 'already_reviewed'],
    ['removed', 'review_removed'],
  ] as [ReviewStatus, string][])(
    'answers a %s review with 409 %s, and reads it back',
    async (status, code) => {
      const s = await setting();
      const first = await reviewIn(s, status);

      const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code,
        currentStatus: status,
        entity: 'review',
      });
      expect(await reviews(s.job.id)).toHaveLength(1);
      const read = await get(`/reviews/job/${s.job.id}`, s.as);
      expect(read.body.existing).toEqual({
        id: first.id,
        jobId: s.job.id,
        paidBani: 89_000,
        postedAt: first.postedAt.toISOString(),
        rating: 3,
        status,
        text: 'Au întârziat o zi.',
      });
    },
  );

  it('lets a new review in after the author deleted theirs', async () => {
    const s = await setting();
    await reviewIn(s, 'deleted_by_author');

    const read = await get(`/reviews/job/${s.job.id}`, s.as);
    const posted = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(read.body.existing).toBeNull();
    expect(posted.status).toBe(201);
  });

  it('keeps one review when two are posted at once', async () => {
    const s = await setting();

    const answers = await Promise.all([
      publish(s.as, { jobId: s.job.id, rating: 5 }),
      publish(s.as, { jobId: s.job.id, rating: 2 }),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(answers.find((a) => a.status === 409)?.body).toMatchObject({
      code: 'already_reviewed',
      currentStatus: 'published',
    });
    expect(await reviews(s.job.id)).toHaveLength(1);
    expect(await audits(s.job.id)).toHaveLength(1);
  });

  it('answers already_reviewed before a field error', async () => {
    const s = await setting();
    await reviewIn(s, 'published');

    const refused = await publish(s.as, {
      jobId: s.job.id,
      paidBani: 0,
      rating: 4,
    });

    expect(refused.body.code).toBe('already_reviewed');
  });
});

// @traces 022-FR-014 022-FR-022 022-FR-026
describe('an e-mail that is not confirmed', () => {
  it.each([
    ['an unconfirmed e-mail', { emailVerifiedAt: null }, true],
    ['no e-mail', { email: null, emailVerifiedAt: null }, false],
  ])('with %s answers 409 email_not_confirmed', async (_, data, hasEmail) => {
    const s = await setting();
    await prisma.account.update({ data, where: { id: s.andrei } });

    const read = await get(`/reviews/job/${s.job.id}`, s.as);
    const refused = await publish(s.as, { jobId: s.job.id, rating: 4 });

    expect(read.body.emailConfirmed).toBe(false);
    expect(read.body.hasEmail).toBe(hasEmail);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('email_not_confirmed');
    expect(await reviews(s.job.id)).toEqual([]);
  });
});
