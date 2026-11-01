import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews, reviewReply } from '../reviews.testing';

const { bearer, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);
const reply = reviewReply(world);

const HOUR = 3_600_000;
const REMOVE = { decision: 'remove', reason: 'insults' };

async function setting(adminName = 'Ana Popescu') {
  const dinamo = await team('Atelier Dinamo');
  const admin = await world.account(adminName, ['admin']);
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const one = await review(dinamo.garage.id, andrei, {
    rating: 2,
    status: 'reported',
  });
  return { admin, andrei, auth: bearer(admin, 'admin'), dinamo, one };
}

const report = (
  reviewId: string,
  reporterId: string,
  extra: Record<string, unknown> = {},
) =>
  prisma.reviewReport.create({
    data: {
      dueAt: new Date(Date.now() + 47 * HOUR),
      reason: 'insults',
      reporterId,
      reviewId,
      source: 'garage',
      ...extra,
    },
  });

const decide = (auth: string, reviewId: string, body: unknown) =>
  send(
    'post',
    `/admin/review-reports/${reviewId}/decision`,
    auth,
    body as object,
  );

const events = (reviewId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'review.decided', subjectId: reviewId },
  });

// @traces 179-FR-001
describe('a reason or body written the wrong way', () => {
  it.each([
    ['a leading space', ' insults'],
    ['a trailing newline', 'insults\n'],
    ['capitals', 'INSULTS'],
    ['a trailing NUL', 'insults\u0000'],
    ['a dotless i', 'ınsults'],
    ['a fullwidth letter', 'ｉnsults'],
    ['an empty string', ''],
    ['a number', 1],
    ['null', null],
    ['a list of rules', ['insults']],
    ['ten thousand characters', 'a'.repeat(10_000)],
  ])(
    'refuses %s as the reason with 400, deciding nothing',
    async (_, reason) => {
      const s = await setting();
      const pending = await report(s.one.id, s.dinamo.owner);

      const res = await decide(s.auth, s.one.id, {
        decision: 'remove',
        reason,
      });

      expect(res.status).toBe(400);
      expect(
        (
          await prisma.reviewReport.findUniqueOrThrow({
            where: { id: pending.id },
          })
        ).status,
      ).toBe('pending');
      expect(await events(s.one.id)).toHaveLength(0);
    },
  );

  it.each([
    ['capitals', 'REMOVE'],
    ['a trailing space', 'remove '],
    ['a list', ['remove']],
    ['null', null],
  ])('refuses %s as the decision with 400', async (_, decision) => {
    const s = await setting();
    await report(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, { decision, reason: 'insults' });

    expect(res.status).toBe(400);
  });

  it.each([
    ['an empty object', {}],
    ['a list', []],
    ['null', null],
    ['a string', 'remove'],
  ])('refuses %s as the body with 400', async (_, body) => {
    const s = await setting();
    await report(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, body);

    expect(res.status).toBe(400);
  });

  it('refuses an extra member that repeats a real column', async () => {
    const s = await setting();
    await report(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, {
      ...REMOVE,
      status: 'removed',
    });

    expect(res.status).toBe(400);
  });
});

// @traces 179-FR-002
describe('a decision asked twice in a row', () => {
  it('answers the second with already_decided and writes nothing more', async () => {
    const s = await setting();
    await report(s.one.id, s.dinamo.owner);
    const first = await decide(s.auth, s.one.id, REMOVE);
    const removed = await prisma.review.findUniqueOrThrow({
      where: { id: s.one.id },
    });
    const logged = await prisma.activityLog.count();

    const second = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'hate',
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('already_decided');
    expect(
      await prisma.review.findUniqueOrThrow({ where: { id: s.one.id } }),
    ).toEqual(removed);
    expect(removed.removalReason).toBe('insults');
    expect(await events(s.one.id)).toHaveLength(1);
    expect(await prisma.activityLog.count()).toBe(logged);
  });

  it('names a deciding admin with an accented surname by its first letter', async () => {
    const s = await setting('Ana Țuțuianu');
    const other = await world.account('Dan Ionescu', ['admin']);
    await report(s.one.id, s.dinamo.owner);
    await decide(s.auth, s.one.id, REMOVE);

    const again = await decide(bearer(other, 'admin'), s.one.id, REMOVE);

    expect(again.body).toMatchObject({
      code: 'already_decided',
      decidedBy: 'Ana Ț.',
    });
  });

  it('refuses a review already removed whose report was decided, leaving it as it was', async () => {
    const s = await setting();
    const gone = new Date(Date.now() - HOUR);
    await prisma.review.update({
      data: {
        removalReason: 'ads',
        removedAt: gone,
        removedById: s.admin,
        status: 'removed',
      },
      where: { id: s.one.id },
    });
    await report(s.one.id, s.dinamo.owner, {
      decidedAt: gone,
      decidedById: s.admin,
      decision: 'removed',
      status: 'decided',
    });

    const res = await decide(s.auth, s.one.id, REMOVE);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_decided');
    const row = await prisma.review.findUniqueOrThrow({
      where: { id: s.one.id },
    });
    expect(row.removalReason).toBe('ads');
    expect(row.removedAt?.toISOString()).toBe(gone.toISOString());
  });

  it('decides a newer pending report after an older one was decided', async () => {
    const s = await setting();
    const old = await report(s.one.id, s.dinamo.owner, {
      createdAt: new Date(Date.now() - 48 * HOUR),
      decidedAt: new Date(Date.now() - 24 * HOUR),
      decidedById: s.admin,
      decision: 'removed',
      status: 'decided',
    });
    const fresh = await report(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, REMOVE);

    expect(res.status).toBe(200);
    expect(res.body.reportId).toBe(fresh.id);
    expect(
      (await prisma.reviewReport.findUniqueOrThrow({ where: { id: old.id } }))
        .decidedAt,
    ).not.toBeNull();
  });
});

// @traces 179-FR-004
describe('a reply report whose reply is not there to remove', () => {
  it('decides the report and leaves the review as it was, answering 200 with no reply', async () => {
    const s = await setting();
    await prisma.review.update({
      data: { status: 'published' },
      where: { id: s.one.id },
    });
    const pending = await report(s.one.id, s.andrei, {
      source: 'author',
      target: 'reply',
    });

    const res = await decide(s.auth, s.one.id, REMOVE);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      replyId: null,
      reportId: pending.id,
      target: 'reply',
    });
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: s.one.id } }))
        .status,
    ).toBe('published');
  });

  it('removes only the reported reply and keeps the review published', async () => {
    const s = await setting();
    await prisma.review.update({
      data: { status: 'published' },
      where: { id: s.one.id },
    });
    const answer = await reply(s.one.id, { status: 'reported' });
    await report(s.one.id, s.andrei, { source: 'author', target: 'reply' });

    await decide(s.auth, s.one.id, REMOVE);

    expect(
      (await prisma.reviewReply.findUniqueOrThrow({ where: { id: answer.id } }))
        .removedCause,
    ).toBe('report_upheld');
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: s.one.id } }))
        .removedAt,
    ).toBeNull();
  });
});

// @traces 179-FR-007 179-FR-011
describe('what a decision tells the outside', () => {
  it('puts exactly the nine agreed members in the event and no reporter anywhere', async () => {
    const s = await setting();
    const pending = await report(s.one.id, s.dinamo.owner);

    await decide(s.auth, s.one.id, REMOVE);

    const [event] = await events(s.one.id);
    expect(Object.keys(event.payload as object).sort()).toEqual(
      [
        'decision',
        'driverId',
        'garageId',
        'mechanicId',
        'reason',
        'replyId',
        'reportId',
        'reviewId',
        'target',
      ].sort(),
    );
    expect(JSON.stringify(event.payload)).not.toContain(s.dinamo.owner);
    expect(pending.reporterId).toBe(s.dinamo.owner);
  });

  it('puts no reporter in the result body', async () => {
    const s = await setting();
    await report(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, REMOVE);

    expect(Object.keys(res.body).sort()).toEqual([
      'decidedAt',
      'decision',
      'replyId',
      'reportId',
      'reviewId',
      'target',
    ]);
    expect(JSON.stringify(res.body)).not.toContain(s.dinamo.owner);
  });

  it('writes nothing after a refusal: no event, no audit entry', async () => {
    const s = await setting();
    const before = await prisma.activityLog.count();

    const res = await decide(s.auth, s.one.id, REMOVE);

    expect(res.status).toBe(409);
    expect(await events(s.one.id)).toHaveLength(0);
    expect(await prisma.activityLog.count()).toBe(before);
  });
});
