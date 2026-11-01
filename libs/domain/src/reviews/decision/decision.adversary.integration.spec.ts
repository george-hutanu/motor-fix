import { randomUUID } from 'node:crypto';

import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews } from '../reviews.testing';

const { bearer, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);

const HOUR = 3_600_000;
const REMOVE = { decision: 'remove', reason: 'insults' };

// A reported review of Atelier Dinamo with its one pending report, and two
// admins who may decide it.
async function setting() {
  const dinamo = await team('Atelier Dinamo');
  const ana = await world.account('Ana Popescu', ['admin']);
  const dan = await world.account('Dan Ionescu', ['admin']);
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const one = await review(dinamo.garage.id, andrei, {
    rating: 1,
    status: 'reported',
  });
  const report = await prisma.reviewReport.create({
    data: {
      dueAt: new Date(Date.now() + 47 * HOUR),
      reason: 'insults',
      reporterId: dinamo.owner,
      reviewId: one.id,
      source: 'garage',
    },
  });
  return { ana, andrei, dan, dinamo, one, report };
}

const decide = (auth: string | undefined, reviewId: string, body: object) =>
  auth
    ? send('post', `/admin/review-reports/${reviewId}/decision`, auth, body)
    : send('post', `/admin/review-reports/${reviewId}/decision`, '', body);

const decided = (reviewId: string) =>
  prisma.outboxEvent.count({
    where: { kind: 'review.decided', subjectId: reviewId },
  });

// @traces 179-FR-005
describe('two admins deciding at once', () => {
  it('lets exactly one of several parallel decisions through', async () => {
    const s = await setting();
    const admins = [s.ana, s.dan, s.ana, s.dan];

    const answers = await Promise.all(
      admins.map((admin) => decide(bearer(admin, 'admin'), s.one.id, REMOVE)),
    );

    const statuses = answers.map((answer) => answer.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409]);
    for (const lost of answers.filter((answer) => answer.status === 409)) {
      expect(lost.body.code).toBe('already_decided');
    }
    expect(await decided(s.one.id)).toBe(1);
    expect(
      await prisma.activityLog.count({ where: { subjectId: s.report.id } }),
    ).toBe(1);
  });
});

// @traces 179-FR-002
describe('a report no longer waiting', () => {
  it('names the admin who decided first', async () => {
    const s = await setting();
    await decide(bearer(s.ana, 'admin'), s.one.id, REMOVE);

    const again = await decide(bearer(s.dan, 'admin'), s.one.id, REMOVE);

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'already_decided',
      decidedBy: 'Ana P.',
    });
    expect(typeof again.body.message).toBe('string');
  });

  it('answers in English for an admin who reads English', async () => {
    const s = await setting();
    await decide(bearer(s.ana, 'admin'), s.one.id, REMOVE);
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: s.dan },
    });

    const ro = await decide(bearer(s.ana, 'admin'), s.one.id, REMOVE);
    const en = await decide(bearer(s.dan, 'admin'), s.one.id, REMOVE);

    expect(en.body.code).toBe('already_decided');
    expect(en.body.message).not.toBe(ro.body.message);
  });

  it('refuses a review whose reports are all closed', async () => {
    const s = await setting();
    await prisma.reviewReport.update({
      data: { status: 'closed' },
      where: { id: s.report.id },
    });

    const res = await decide(bearer(s.ana, 'admin'), s.one.id, REMOVE);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_pending_report');
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: s.one.id } }))
        .status,
    ).toBe('reported');
  });

  it('refuses a review nobody reported', async () => {
    const s = await setting();
    const plain = await review(s.dinamo.garage.id, s.andrei, { rating: 4 });

    const res = await decide(bearer(s.ana, 'admin'), plain.id, REMOVE);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_pending_report');
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: plain.id } }))
        .status,
    ).toBe('published');
  });

  it('answers not_found for a review that does not exist', async () => {
    const s = await setting();

    const res = await decide(bearer(s.ana, 'admin'), randomUUID(), REMOVE);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

// @traces 179-FR-001
describe('a body the operation does not take', () => {
  it.each([
    ['the rule other', { decision: 'remove', reason: 'other' }],
    ['a rule that does not exist', { decision: 'remove', reason: 'rude' }],
    ['no rule', { decision: 'remove' }],
    ['the decision keep', { decision: 'keep', reason: 'insults' }],
    ['no decision', { reason: 'insults' }],
    ['an extra member', { ...REMOVE, note: 'x' }],
  ])('refuses %s with 400, writing nothing', async (_, body) => {
    const s = await setting();

    const res = await decide(bearer(s.ana, 'admin'), s.one.id, body);

    expect(res.status).toBe(400);
    expect(
      (
        await prisma.reviewReport.findUniqueOrThrow({
          where: { id: s.report.id },
        })
      ).status,
    ).toBe('pending');
  });

  it('refuses an id that is not a uuid', async () => {
    const s = await setting();

    const res = await decide(bearer(s.ana, 'admin'), 'not-a-uuid', REMOVE);

    expect(res.status).toBe(400);
  });
});

// @traces 179-FR-001 179-FR-002
describe('anyone but an admin', () => {
  it('learns nothing: 404 for a driver, the owner, the desk and a mechanic', async () => {
    const s = await setting();
    const others = [
      bearer(s.andrei, 'driver'),
      bearer(s.dinamo.owner, 'garage'),
      bearer(s.dinamo.receptionist, 'receptionist'),
      bearer(s.dinamo.answering, 'mechanic'),
    ];

    for (const auth of others) {
      const res = await decide(auth, s.one.id, REMOVE);
      expect(res.status).toBe(404);
    }
    expect(await decided(s.one.id)).toBe(0);
  });

  it('answers a non-admin 404 before reading the body', async () => {
    const s = await setting();

    const res = await decide(bearer(s.andrei, 'driver'), s.one.id, {
      decision: 'keep',
    });

    expect(res.status).toBe(404);
  });

  it('asks a visitor to sign in', async () => {
    const s = await setting();

    const res = await decide(undefined, s.one.id, REMOVE);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('refuses a suspended admin', async () => {
    const s = await setting();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: s.ana },
    });

    const res = await decide(bearer(s.ana, 'admin'), s.one.id, REMOVE);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
  });
});
