import { randomUUID } from 'node:crypto';

import { ReviewsModule } from './reviews.module';
import type { JobStatus } from '../generated/prisma/enums';
import { quotesApp } from '../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;

async function setting(status: JobStatus = 'done') {
  const andrei = await world.account('Andrei Marin', ['driver']);
  await prisma.account.update({
    data: { email: `${andrei}@example.ro`, emailVerifiedAt: new Date() },
    where: { id: andrei },
  });
  const dinamo = await team('Atelier Dinamo');
  const { booking } = await world.chain(andrei, dinamo.garage.id);
  const job = await world.job(booking.id, status);
  return { andrei, as: bearer(andrei, 'driver'), dinamo, job };
}
type Setting = Awaited<ReturnType<typeof setting>>;

const publish = (auth: string, body: object) =>
  send('post', '/reviews', auth, body);
const reviews = (jobId: string) => prisma.review.findMany({ where: { jobId } });
const unconfirm = (s: Setting) =>
  prisma.account.update({
    data: { emailVerifiedAt: null },
    where: { id: s.andrei },
  });
const live = (s: Setting) =>
  prisma.review.create({
    data: {
      driverId: s.andrei,
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
      rating: 3,
      status: 'published',
    },
  });

// @traces 022-FR-018
describe('the comment length', () => {
  it('counts a 2,000 character comment with surrounding spaces by its trimmed length', async () => {
    const s = await setting();

    const posted = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      text: `   ${'x'.repeat(2000)}   `,
    });

    expect(posted.status).toBe(201);
    expect((await reviews(s.job.id))[0].text).toBe('x'.repeat(2000));
  });

  it('refuses 2,001 characters between spaces', async () => {
    const s = await setting();

    const refused = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      text: ` ${'x'.repeat(2001)} `,
    });

    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([
      expect.objectContaining({ code: 'length', field: 'text' }),
    ]);
  });

  it('counts 2,000 emoji as 2,000 characters', async () => {
    const s = await setting();

    const posted = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      text: '😀'.repeat(2000),
    });

    expect(posted.status).toBe(201);
    expect((await reviews(s.job.id))[0].text).toBe('😀'.repeat(2000));
  });

  it('refuses 2,001 emoji', async () => {
    const s = await setting();

    const refused = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      text: '😀'.repeat(2001),
    });

    expect(refused.status).toBe(422);
  });

  it('counts 2,000 Romanian letters as 2,000 characters', async () => {
    const s = await setting();

    const posted = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      text: 'ț'.repeat(2000),
    });

    expect(posted.status).toBe(201);
  });

  it.each(['   ', '  ', '\t\n', ''])(
    'stores the comment %j as none',
    async (text) => {
      const s = await setting();

      const posted = await publish(s.as, { jobId: s.job.id, rating: 4, text });

      expect(posted.status).toBe(201);
      expect(posted.body.text).toBeNull();
      expect((await reviews(s.job.id))[0].text).toBeNull();
    },
  );

  it('keeps line breaks inside a comment', async () => {
    const s = await setting();

    await publish(s.as, { jobId: s.job.id, rating: 4, text: 'a\n\nb' });

    expect((await reviews(s.job.id))[0].text).toBe('a\n\nb');
  });

  it.each(['a\u0000b', '\ud800'])(
    'never answers a server error for the comment %j',
    async (text) => {
      const s = await setting();

      const answer = await publish(s.as, { jobId: s.job.id, rating: 4, text });

      expect(answer.status).toBeLessThan(500);
    },
  );
});

// @traces 022-FR-015 022-FR-017 022-FR-018
describe('fields at and past their bounds', () => {
  it.each([
    [{ rating: 1 }, 201],
    [{ rating: 5 }, 201],
    [{ rating: -1 }, 422],
    [{ rating: 1e21 }, 422],
    [{ rating: 2.5 }, 400],
    [{ rating: '5' }, 400],
    [{ rating: null }, 400],
    [{ rating: undefined }, 400],
    [{ paidBani: 1e21 }, 422],
    [{ paidBani: Number.MAX_SAFE_INTEGER }, 422],
    [{ paidBani: '420000' }, 400],
    [{ paidBani: 0.5 }, 400],
  ])('answers %j with %p', async (over, status) => {
    const s = await setting();

    const answer = await publish(s.as, { jobId: s.job.id, rating: 4, ...over });

    expect(answer.status).toBe(status);
    expect((await reviews(s.job.id)).length).toBe(status === 201 ? 1 : 0);
  });

  it('reports every field problem of one body', async () => {
    const s = await setting();

    const refused = await publish(s.as, {
      jobId: s.job.id,
      paidBani: 0,
      rating: 9,
      text: 'x'.repeat(2001),
    });

    expect(refused.status).toBe(422);
    expect(
      refused.body.errors.map((e: { field: string }) => e.field).sort(),
    ).toEqual(['paidBani', 'rating', 'text']);
  });

  it.each([
    [{}],
    [{ rating: 4 }],
    [{ jobId: 'nope', rating: 4 }],
    [{ jobId: randomUUID() }],
  ])('answers 400 for the body %j', async (body) => {
    const s = await setting();

    expect((await publish(s.as, body)).status).toBe(400);
  });

  it.each([
    ['status', 'removed'],
    ['id', randomUUID()],
    ['garageId', randomUUID()],
    ['mechanicId', randomUUID()],
    ['postedAt', '2001-01-01T00:00:00Z'],
    ['source', 'mechanic'],
    ['car', null],
    ['jobs', []],
  ])('refuses an extra %s member and writes nothing', async (field, value) => {
    const s = await setting();

    const refused = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      [field]: value,
    });

    expect(refused.status).toBe(400);
    expect(await reviews(s.job.id)).toEqual([]);
  });

  it('refuses a body that is an array', async () => {
    const s = await setting();

    expect((await publish(s.as, [{ jobId: s.job.id, rating: 4 }])).status).toBe(
      400,
    );
  });

  it('takes a null comment as none', async () => {
    const s = await setting();

    const posted = await publish(s.as, {
      jobId: s.job.id,
      rating: 4,
      text: null,
    });

    expect(posted.status).toBe(201);
    expect(posted.body.text).toBeNull();
  });

  it('takes a null amount as none', async () => {
    const s = await setting();

    const posted = await publish(s.as, {
      jobId: s.job.id,
      paidBani: null,
      rating: 4,
    });

    expect(posted.status).toBe(201);
    expect(posted.body.paidBani).toBeNull();
  });
});

// @traces 022-FR-019 022-FR-020 022-FR-021
// @traces 022-FR-022 022-FR-026
describe('the order of the checks', () => {
  const badFields = { paidBani: 0, rating: 9, text: 'x'.repeat(2001) };

  it('answers 404 before a field error for an unknown job', async () => {
    const s = await setting();

    const refused = await publish(s.as, { jobId: randomUUID(), ...badFields });

    expect(refused.status).toBe(404);
  });

  it('answers 400 before 404 when the body has an unknown member', async () => {
    const s = await setting();

    const refused = await publish(s.as, {
      car: {},
      jobId: randomUUID(),
      rating: 4,
    });

    expect(refused.status).toBe(400);
  });

  it('answers 404 for another driver whose e-mail is unconfirmed and job not done', async () => {
    const s = await setting('in_work');
    const ioana = await world.account('Ioana Pop', ['driver']);

    const refused = await publish(bearer(ioana, 'driver'), {
      jobId: s.job.id,
      rating: 4,
    });

    expect(refused.status).toBe(404);
  });

  it('answers job_not_done before email_not_confirmed, review_exists and field errors', async () => {
    const s = await setting('cancelled');
    await unconfirm(s);
    await live(s);

    const refused = await publish(s.as, { jobId: s.job.id, ...badFields });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('job_not_done');
  });

  it('answers email_not_confirmed before review_exists and field errors', async () => {
    const s = await setting();
    await unconfirm(s);
    await live(s);

    const refused = await publish(s.as, { jobId: s.job.id, ...badFields });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('email_not_confirmed');
  });

  it('answers 422 last, once the job can be reviewed', async () => {
    const s = await setting();

    const refused = await publish(s.as, { jobId: s.job.id, ...badFields });

    expect(refused.status).toBe(422);
  });
});

// @traces 022-FR-021 022-FR-024
describe('posting twice', () => {
  it('answers 201 then 409 and leaves one review, one audit entry and one event', async () => {
    const s = await setting();

    const first = await publish(s.as, { jobId: s.job.id, rating: 5 });
    const second = await publish(s.as, { jobId: s.job.id, rating: 5 });

    expect([first.status, second.status]).toEqual([201, 409]);
    expect(second.body.code).toBe('review_exists');
    expect(await reviews(s.job.id)).toHaveLength(1);
    expect(
      await prisma.activityLog.count({
        where: { jobId: s.job.id, subjectType: 'review' },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'review.posted', subjectId: first.body.id },
      }),
    ).toBe(1);
  });

  it('leaves one review when ten are posted at once', async () => {
    const s = await setting();

    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        publish(s.as, { jobId: s.job.id, rating: (i % 5) + 1 }),
      ),
    );

    expect(answers.filter((a) => a.status === 201)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(9);
    expect(await reviews(s.job.id)).toHaveLength(1);
  });

  it('records nothing for a refused post', async () => {
    const s = await setting();

    await publish(s.as, { jobId: s.job.id, rating: 9 });

    expect(
      await prisma.activityLog.count({
        where: { jobId: s.job.id, subjectType: 'review' },
      }),
    ).toBe(0);
  });
});

// @traces 022-FR-014 022-FR-019
describe('reading a job for its review with odd ids', () => {
  it.each(['', 'null', '123', 'not-a-uuid', `${randomUUID()}x`])(
    'answers 400 or 404 for the id %j, never a server error',
    async (id) => {
      const s = await setting();

      const read = await get(`/reviews/job/${id}`, s.as);

      expect([400, 404]).toContain(read.status);
    },
  );

  it('answers 400 for an id that is not a UUID', async () => {
    const s = await setting();

    const read = await get('/reviews/job/123', s.as);

    expect(read.status).toBe(400);
  });

  it('answers 404 for the all-zero UUID', async () => {
    const s = await setting();

    const read = await get(
      '/reviews/job/00000000-0000-0000-0000-000000000000',
      s.as,
    );

    expect(read.status).toBe(404);
  });

  it('answers emailConfirmed false for an account with no e-mail', async () => {
    const s = await setting();
    await prisma.account.update({
      data: { email: null, emailVerifiedAt: null },
      where: { id: s.andrei },
    });

    const read = await get(`/reviews/job/${s.job.id}`, s.as);

    expect(read.body.emailConfirmed).toBe(false);
  });

  it('answers 404 to a visitor-less other driver for a job not done', async () => {
    const s = await setting('in_work');
    const ioana = await world.account('Ioana Pop', ['driver']);

    expect(
      (await get(`/reviews/job/${s.job.id}`, bearer(ioana, 'driver'))).status,
    ).toBe(404);
  });
});
