import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { ReviewsModule } from './reviews.module';
import { mechanicReviews } from './reviews.testing';
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
async function setting(
  status: JobStatus = 'done',
  pick: (dinamo: Awaited<ReturnType<typeof team>>) => string | undefined = () =>
    undefined,
) {
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
  const job = await world.job(booking.id, status, {
    mechanicId: pick(dinamo),
  });
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
      mechanicId: null,
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

const posting = (subjectId: string) =>
  prisma.outboxEvent.findFirstOrThrow({
    where: { kind: 'review.posted', subjectId },
  });

// @traces 025-FR-001 025-FR-003
// @traces 025-FR-004
describe('the mechanic a review names', () => {
  it('names the job’s mechanic, in the row, the event and its audience', async () => {
    const s = await setting('done', (d) => d.plainMechanic.id);

    const posted = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(posted.status).toBe(201);
    const [row] = await reviews(s.job.id);
    expect(row.mechanicId).toBe(s.dinamo.plainMechanic.id);
    const event = await posting(posted.body.id);
    expect(event.payload).toEqual({
      driverId: s.andrei,
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
      mechanicId: s.dinamo.plainMechanic.id,
      rating: 5,
      reviewId: posted.body.id,
    });
    expect(event.audience).toContain(
      `public:mechanic:${s.dinamo.plainMechanic.id}`,
    );
  });

  it('names the mechanic the job moved to before the review', async () => {
    const s = await setting('done', (d) => d.plainMechanic.id);
    await prisma.job.update({
      data: { mechanicId: s.dinamo.answeringMechanic.id },
      where: { id: s.job.id },
    });

    await publish(s.as, { jobId: s.job.id, rating: 4 });

    expect((await reviews(s.job.id))[0].mechanicId).toBe(
      s.dinamo.answeringMechanic.id,
    );
  });

  it('names the owner’s own row when the garage has no team', async () => {
    const s = await setting();
    const own = await prisma.mechanic.create({
      data: {
        accountId: s.dinamo.owner,
        garageId: s.dinamo.garage.id,
        name: 'Owner',
      },
    });
    await prisma.job.update({
      data: { mechanicId: own.id },
      where: { id: s.job.id },
    });

    await publish(s.as, { jobId: s.job.id, rating: 4 });

    expect((await reviews(s.job.id))[0].mechanicId).toBe(own.id);
  });

  it('names none for a job with no mechanic, and no mechanic page hears it', async () => {
    const s = await setting();

    const posted = await publish(s.as, { jobId: s.job.id, rating: 4 });

    expect((await reviews(s.job.id))[0].mechanicId).toBeNull();
    const event = await posting(posted.body.id);
    expect(event.payload).toMatchObject({ mechanicId: null });
    expect(
      event.audience.some((key) => key.startsWith('public:mechanic:')),
    ).toBe(false);
  });

  it('keeps the mechanic hidden from the profile or whose account was deleted', async () => {
    const s = await setting('done', (d) => d.plainMechanic.id);
    await publish(s.as, { jobId: s.job.id, rating: 4 });

    await prisma.mechanic.update({
      data: { onProfile: false },
      where: { id: s.dinamo.plainMechanic.id },
    });
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: s.dinamo.plain },
    });

    expect((await reviews(s.job.id))[0].mechanicId).toBe(
      s.dinamo.plainMechanic.id,
    );
  });

  it('keeps the review and empties its mechanic when the mechanic row goes', async () => {
    const s = await setting('done', (d) => d.plainMechanic.id);
    await publish(s.as, { jobId: s.job.id, rating: 4 });

    await prisma.mechanic.delete({ where: { id: s.dinamo.plainMechanic.id } });

    expect(await reviews(s.job.id)).toEqual([
      expect.objectContaining({ mechanicId: null, status: 'published' }),
    ]);
  });
});

const { elena, reviewed } = mechanicReviews(world);

const listOf = (mechanicId: string, page?: unknown) =>
  get(
    `/reviews/mechanic/${mechanicId}${page === undefined ? '' : `?page=${page}`}`,
  );

// @traces 025-FR-011 025-FR-012 025-FR-013 025-FR-015
describe("reading a mechanic's reviews", () => {
  it('lists 20 a page, newest first, each with its garage, to a visitor', async () => {
    const e = await elena();
    const written = [];
    for (let i = 0; i < 25; i++) {
      written.push(
        await reviewed(
          e.driver,
          i < 10 ? e.dinamo.id : e.nord.id,
          e.mechanic.id,
          i,
        ),
      );
    }

    const first = await listOf(e.mechanic.id);
    const second = await listOf(e.mechanic.id, 2);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 20, total: 25 });
    expect(first.body.items.map((r: { id: string }) => r.id)).toEqual(
      written.slice(0, 20).map((r) => r.id),
    );
    expect(second.body.items.map((r: { id: string }) => r.id)).toEqual(
      written.slice(20).map((r) => r.id),
    );
    expect(first.body.items[0]).toEqual({
      author: { shortName: 'Andrei M.' },
      garage: { id: e.dinamo.id, name: 'Atelier Dinamo', slug: e.dinamo.slug },
      id: written[0].id,
      postedAt: written[0].postedAt.toISOString(),
      rating: written[0].rating,
      text: 'Recenzia 0',
    });
    expect(first.body.items[1].text).toBeNull();
    expect(first.body.items[19].garage.name).toBe('Service Nord');
  });

  it('orders reviews posted at the same moment by id', async () => {
    const e = await elena();
    const a = await reviewed(e.driver, e.nord.id, e.mechanic.id, 3);
    const b = await reviewed(e.driver, e.nord.id, e.mechanic.id, 3);
    await prisma.review.updateMany({
      data: { postedAt: a.postedAt },
      where: { id: b.id },
    });

    const read = await listOf(e.mechanic.id);

    expect(read.body.items.map((r: { id: string }) => r.id)).toEqual(
      [a.id, b.id].sort().reverse(),
    );
  });

  it('answers a page past the last with no items and the real total', async () => {
    const e = await elena();
    await reviewed(e.driver, e.nord.id, e.mechanic.id, 1);

    const read = await listOf(e.mechanic.id, 3);

    expect(read.status).toBe(200);
    expect(read.body).toEqual({ items: [], page: 3, pageSize: 20, total: 1 });
  });

  it('lists only the published reviews', async () => {
    const e = await elena();
    const shown = await reviewed(e.driver, e.nord.id, e.mechanic.id, 1);
    for (const status of [
      'reported',
      'removed',
      'deleted_by_author',
    ] as const) {
      await reviewed(e.driver, e.nord.id, e.mechanic.id, 2, { status });
    }

    const read = await listOf(e.mechanic.id);

    expect(read.body.total).toBe(1);
    expect(read.body.items.map((r: { id: string }) => r.id)).toEqual([
      shown.id,
    ]);
  });

  it('shows no plate, phone, e-mail or account id of the author', async () => {
    const e = await elena();
    await prisma.account.update({
      data: { email: 'andrei@example.ro', phone: '+40722123456' },
      where: { id: e.driver },
    });
    await reviewed(e.driver, e.nord.id, e.mechanic.id, 1);

    const body = JSON.stringify((await listOf(e.mechanic.id)).body);

    for (const kept of [
      'B123ABC',
      '+40722123456',
      'andrei@example.ro',
      e.driver,
    ]) {
      expect(body).not.toContain(kept);
    }
  });

  it('answers 404, alike, for a mechanic unknown, off the profile or whose account was deleted', async () => {
    const e = await elena();
    const hidden = await prisma.mechanic.create({
      data: { garageId: e.nord.id, name: 'Ionuț' },
    });
    const gone = await world.account('Costel Dan', ['mechanic']);
    const deleted = await prisma.mechanic.create({
      data: {
        accountId: gone,
        garageId: e.nord.id,
        name: 'Costel',
        onProfile: true,
      },
    });
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: gone },
    });

    const answers = await Promise.all(
      [randomUUID(), hidden.id, deleted.id].map((id) => listOf(id)),
    );

    expect(answers.map((a) => a.status)).toEqual([404, 404, 404]);
    expect(new Set(answers.map((a) => JSON.stringify(a.body))).size).toBe(1);
    expect(answers[0].body.code).toBe('not_found');
  });

  // The code, validation_failed, is the API's ProblemFilter's: see
  // apps/api/src/public-routes.integration.spec.ts.
  it.each(['0', '-1', '1.5', 'x'])('refuses page %p with 400', async (page) => {
    const e = await elena();

    const refused = await listOf(e.mechanic.id, page);

    expect(refused.status).toBe(400);
  });

  it('refuses an id that is not a UUID', async () => {
    expect((await listOf('not-a-mechanic')).status).toBe(400);
  });
});
