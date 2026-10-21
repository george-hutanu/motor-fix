import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';

import type { JobStatus, ReviewStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';

const reader = countedMetrics();
const { bearer, get, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;

async function setting(status: JobStatus = 'done') {
  const andrei = await world.account('Andrei Marin', ['driver']);
  await prisma.account.update({
    data: { email: `${andrei}@example.ro`, emailVerifiedAt: new Date() },
    where: { id: andrei },
  });
  const dinamo = await team('Atelier Dinamo');
  const job = await jobAt(andrei, dinamo.garage.id, status);
  return { andrei, as: bearer(andrei, 'driver'), dinamo, job };
}
type Setting = Awaited<ReturnType<typeof setting>>;

async function jobAt(driverId: string, garageId: string, status: JobStatus) {
  const { booking } = await world.chain(driverId, garageId);
  return world.job(booking.id, status);
}

const publish = (auth: string, body: object) =>
  send('post', '/reviews', auth, body);
const eligibility = (auth: string, ids: string[]) =>
  get(`/reviews/eligibility?jobIds=${ids.join(',')}`, auth);
const reviews = (jobId: string) => prisma.review.findMany({ where: { jobId } });
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
const member = (s: Setting, role: 'owner' | 'receptionist') =>
  prisma.garageMember.create({
    data: { accountId: s.andrei, garageId: s.dinamo.garage.id, role },
  });
const mechanic = (s: Setting) =>
  prisma.mechanic.create({
    data: { accountId: s.andrei, garageId: s.dinamo.garage.id, name: 'Andrei' },
  });
const unconfirm = (s: Setting) =>
  prisma.account.update({
    data: { emailVerifiedAt: null },
    where: { id: s.andrei },
  });
const english = (s: Setting) =>
  prisma.account.update({ data: { language: 'en' }, where: { id: s.andrei } });
const ruleOff = () =>
  prisma.platformRule.upsert({
    create: {
      defaultValue: true,
      key: 'reviews_only_after_confirmed_job',
      value: false,
    },
    update: { value: false },
    where: { key: 'reviews_only_after_confirmed_job' },
  });
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_reviews_posted_total', { outcome });

const OWN_GARAGE = {
  en: 'You cannot review your own garage.',
  ro: 'Nu poți scrie o recenzie pentru propriul service.',
};
const REMOVED = {
  en: 'MotorFix removed your review; you can only appeal the decision.',
  ro: 'Recenzia ta a fost ștearsă de MotorFix; poți doar contesta decizia.',
};

// @traces 023-FR-005 023-FR-011
describe('garage staff reviewing their own garage', () => {
  it.each(['owner', 'receptionist'] as const)(
    'refuses a %s of the garage with 403 own_garage',
    async (role) => {
      const s = await setting();
      await member(s, role);

      const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({
        code: 'own_garage',
        message: OWN_GARAGE.ro,
      });
      expect(await reviews(s.job.id)).toEqual([]);
    },
  );

  it('refuses a mechanic of the garage linked to the account, in English when the account reads English', async () => {
    const s = await setting();
    await mechanic(s);
    await english(s);

    const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      code: 'own_garage',
      message: OWN_GARAGE.en,
    });
  });

  it('lets staff of another garage review', async () => {
    const s = await setting();
    const nord = await team('Service Nord');
    await prisma.garageMember.create({
      data: { accountId: s.andrei, garageId: nord.garage.id, role: 'owner' },
    });

    expect((await publish(s.as, { jobId: s.job.id, rating: 5 })).status).toBe(
      201,
    );
  });

  it('lets an account review once it left the garage', async () => {
    const s = await setting();
    await member(s, 'receptionist');
    await prisma.garageMember.deleteMany({ where: { accountId: s.andrei } });

    expect((await publish(s.as, { jobId: s.job.id, rating: 5 })).status).toBe(
      201,
    );
  });
});

// @traces 023-FR-006 023-FR-007 023-FR-011
describe('a job whose review exists', () => {
  it.each(['published', 'reported'] as ReviewStatus[])(
    'answers 409 already_reviewed over a %s review',
    async (status) => {
      const s = await setting();
      await reviewIn(s, status);

      const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'already_reviewed',
        currentStatus: status,
        entity: 'review',
      });
    },
  );

  it.each([
    ['ro', REMOVED.ro],
    ['en', REMOVED.en],
  ] as const)(
    'answers 409 review_removed over a removed review, in %s',
    async (language, message) => {
      const s = await setting();
      await reviewIn(s, 'removed');
      if (language === 'en') await english(s);

      const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

      expect(refused.status).toBe(409);
      expect(refused.body).toEqual({
        code: 'review_removed',
        currentStatus: 'removed',
        entity: 'review',
        message,
      });
      expect(await reviews(s.job.id)).toHaveLength(1);
    },
  );
});

// @traces 023-FR-002
describe('the order of the refusals', () => {
  it('answers job_not_done before own_garage', async () => {
    const s = await setting('in_work');
    await member(s, 'owner');

    const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(refused.body.code).toBe('job_not_done');
  });

  it('answers own_garage before already_reviewed', async () => {
    const s = await setting();
    await member(s, 'owner');
    await reviewIn(s, 'published');

    const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(refused.body.code).toBe('own_garage');
  });

  it('answers already_reviewed before email_not_confirmed', async () => {
    const s = await setting();
    await reviewIn(s, 'published');
    await unconfirm(s);

    const refused = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(refused.body.code).toBe('already_reviewed');
  });

  it('answers own_garage before a field out of range', async () => {
    const s = await setting();
    await mechanic(s);

    const refused = await publish(s.as, { jobId: s.job.id, rating: 9 });

    expect(refused.status).toBe(403);
  });
});

// @traces 023-FR-012
describe('the platform rule for reviews', () => {
  it('changes no answer on a job when it is off', async () => {
    const s = await setting();
    const other = await jobAt(s.andrei, s.dinamo.garage.id, 'in_work');
    await ruleOff();

    expect(
      (await publish(s.as, { jobId: other.id, rating: 5 })).body.code,
    ).toBe('job_not_done');
    expect((await eligibility(s.as, [s.job.id, other.id])).body).toEqual([
      { jobId: s.job.id, offer: true, reason: null },
      { jobId: other.id, offer: false, reason: 'job_not_done' },
    ]);
    expect((await publish(s.as, { jobId: s.job.id, rating: 5 })).status).toBe(
      201,
    );
  });
});

// @traces 023-FR-001 023-FR-013 023-FR-014
describe('reading which jobs may be reviewed', () => {
  it('answers each id once, in the order first asked, and a job not the caller’s as not_found', async () => {
    const s = await setting();
    const missing = randomUUID();

    const read = await eligibility(s.as, [s.job.id, missing, s.job.id]);

    expect(read.status).toBe(200);
    expect(read.body).toEqual([
      { jobId: s.job.id, offer: true, reason: null },
      { jobId: missing, offer: false, reason: 'not_found' },
    ]);
  });

  it('offers the button only when the publish would succeed or wants the e-mail confirmed', async () => {
    const s = await setting();
    const nord = await team('Service Nord');
    await prisma.garageMember.create({
      data: { accountId: s.andrei, garageId: nord.garage.id, role: 'owner' },
    });
    const notDone = await jobAt(s.andrei, s.dinamo.garage.id, 'to_do');
    const own = await jobAt(s.andrei, nord.garage.id, 'done');
    const reviewed = await jobAt(s.andrei, s.dinamo.garage.id, 'done');
    const removed = await jobAt(s.andrei, s.dinamo.garage.id, 'done');
    const deleted = await jobAt(s.andrei, s.dinamo.garage.id, 'done');
    await reviewIn(s, 'reported', reviewed.id);
    await reviewIn(s, 'removed', removed.id);
    await reviewIn(s, 'deleted_by_author', deleted.id);
    const ids = [
      s.job.id,
      notDone.id,
      own.id,
      reviewed.id,
      removed.id,
      deleted.id,
    ];

    const read = await eligibility(s.as, ids);

    expect(read.body.map((one: { reason: string }) => one.reason)).toEqual([
      null,
      'job_not_done',
      'own_garage',
      'already_reviewed',
      'review_removed',
      null,
    ]);
    for (const one of read.body) {
      const posted = await publish(s.as, { jobId: one.jobId, rating: 4 });
      expect(one.offer).toBe(posted.status === 201);
    }
  });

  it('still offers the button when the e-mail is not confirmed, and the publish asks for it', async () => {
    const s = await setting();
    await unconfirm(s);

    const read = await eligibility(s.as, [s.job.id]);
    const posted = await publish(s.as, { jobId: s.job.id, rating: 4 });

    expect(read.body).toEqual([
      { jobId: s.job.id, offer: true, reason: 'email_not_confirmed' },
    ]);
    expect(posted.body.code).toBe('email_not_confirmed');
  });

  it('carries the same answer on the review drawer’s read', async () => {
    const s = await setting();
    await member(s, 'owner');

    const read = await get(`/reviews/job/${s.job.id}`, s.as);

    expect(read.status).toBe(200);
    expect(read.body.eligibility).toEqual({
      jobId: s.job.id,
      offer: false,
      reason: 'own_garage',
    });
  });

  it('answers fifty ids in one request', async () => {
    const s = await setting();
    const ids = [s.job.id, ...Array.from({ length: 49 }, () => randomUUID())];

    const read = await eligibility(s.as, ids);

    expect(read.status).toBe(200);
    expect(read.body).toHaveLength(50);
  });

  it.each([
    ['no id', ''],
    ['51 ids', Array.from({ length: 51 }, () => randomUUID()).join(',')],
    ['an id that is not a UUID', 'not-a-job'],
  ])('refuses %s with 400', async (_, jobIds) => {
    const s = await setting();

    const refused = await get(`/reviews/eligibility?jobIds=${jobIds}`, s.as);

    expect(refused.status).toBe(400);
  });

  it('answers 404 to a caller who is not a driver, and 401 without a session', async () => {
    const s = await setting();

    expect(
      (await eligibility(bearer(s.dinamo.owner, 'garage'), [s.job.id])).status,
    ).toBe(404);
    expect((await get(`/reviews/eligibility?jobIds=${s.job.id}`)).status).toBe(
      401,
    );
  });
});

// @traces 023-FR-017
describe('counting the publishes', () => {
  it('counts each refusal by its code, and nothing for the eligibility read', async () => {
    const s = await setting();
    await member(s, 'owner');
    const before = await counted('own_garage');
    const total = () => counterTotal(reader, 'motorfix_reviews_posted_total');
    const all = await total();

    await eligibility(s.as, [s.job.id]);
    expect(await total()).toBe(all);
    await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect(await counted('own_garage')).toBe(before + 1);
  });

  it('counts a removed review as review_removed and a live one as already_reviewed', async () => {
    const s = await setting();
    const other = await jobAt(s.andrei, s.dinamo.garage.id, 'done');
    await reviewIn(s, 'removed');
    await reviewIn(s, 'published', other.id);
    const removed = await counted('review_removed');
    const reviewed = await counted('already_reviewed');

    await publish(s.as, { jobId: s.job.id, rating: 5 });
    await publish(s.as, { jobId: other.id, rating: 5 });

    expect(await counted('review_removed')).toBe(removed + 1);
    expect(await counted('already_reviewed')).toBe(reviewed + 1);
  });
});
