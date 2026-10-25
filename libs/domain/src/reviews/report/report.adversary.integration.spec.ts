import { randomUUID } from 'node:crypto';

import type { ReviewStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews } from '../reviews.testing';

const { bearer, get, post, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);

const HOUR = 3_600_000;

async function setting(status: ReviewStatus = 'published') {
  const dinamo = await team('Atelier Dinamo');
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const posted = await review(dinamo.garage.id, andrei, { rating: 1 });
  const one = await prisma.review.update({
    data: { mechanicId: dinamo.answeringMechanic.id, status },
    where: { id: posted.id },
  });
  return {
    andrei,
    dinamo,
    owner: bearer(dinamo.owner, 'garage'),
    review: one,
  };
}

const report = (auth: string, reviewId: string, body: object) =>
  send('post', `/reviews/${reviewId}/reports`, auth, body);

const reports = (reviewId: string) =>
  prisma.reviewReport.findMany({ where: { reviewId } });

const statusOf = async (id: string) =>
  (await prisma.review.findUniqueOrThrow({ where: { id } })).status;

const decided = (
  reviewId: string,
  decidedAt: Date,
  status: 'decided' | 'closed' = 'decided',
  decision: 'kept' | 'removed' = 'kept',
) =>
  prisma.reviewReport.create({
    data: {
      decidedAt,
      decision,
      dueAt: new Date(decidedAt.getTime() - HOUR),
      reason: 'insults',
      reviewId,
      source: 'garage',
      status,
    },
  });

// @traces 076-FR-006
describe('what the report text may hold at the edges', () => {
  it('strips NUL characters from an other text instead of failing', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, {
      reason: 'other',
      text: 'Nu\u0000 e al nostru',
    });

    expect(sent.status).toBe(201);
    expect((await reports(s.review.id))[0].text).toBe('Nu e al nostru');
  });

  it('answers a text of only NUL characters as a missing text for other', async () => {
    const s = await setting();

    const refused = await report(s.owner, s.review.id, {
      reason: 'other',
      text: '\u0000\u0000',
    });

    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([{ code: 'required', field: 'text' }]);
    expect(await reports(s.review.id)).toEqual([]);
  });

  it('takes a blank text as absent with another reason', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, {
      reason: 'insults',
      text: '  \u0000 ',
    });

    expect(sent.status).toBe(201);
    expect((await reports(s.review.id))[0].text).toBeNull();
  });

  it('answers a non-breaking-space text as required for other', async () => {
    const s = await setting();

    const refused = await report(s.owner, s.review.id, {
      reason: 'other',
      text: '  \n\t',
    });

    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([{ code: 'required', field: 'text' }]);
  });

  it('counts 500 characters after trimming, not before', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, {
      reason: 'other',
      text: `   ${'a'.repeat(500)}\n\n`,
    });

    expect(sent.status).toBe(201);
    expect((await reports(s.review.id))[0].text).toBe('a'.repeat(500));
  });

  it('refuses 501 characters left after trimming', async () => {
    const s = await setting();

    const refused = await report(s.owner, s.review.id, {
      reason: 'other',
      text: ` ${'a'.repeat(501)} `,
    });

    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([{ code: 'length', field: 'text' }]);
  });

  it('counts 500 emoji as 500 characters', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, {
      reason: 'other',
      text: '🚗'.repeat(500),
    });

    expect(sent.status).toBe(201);
  });

  it('keeps markup and accents exactly as written', async () => {
    const s = await setting();
    const text = '<script>alert("x")</script> Mulțumesc ăîșț 🚗 ‏עברית';

    await report(s.owner, s.review.id, { reason: 'other', text });

    expect((await reports(s.review.id))[0].text).toBe(text);
  });

  it('answers a very large text with a length error, not a server error', async () => {
    const s = await setting();

    const refused = await report(s.owner, s.review.id, {
      reason: 'other',
      text: 'a'.repeat(60_000),
    });

    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([{ code: 'length', field: 'text' }]);
  });

  it('answers a body of several megabytes with 413', async () => {
    const s = await setting();

    const refused = await report(s.owner, s.review.id, {
      reason: 'other',
      text: 'a'.repeat(5_000_000),
    });

    expect(refused.status).toBe(413);
    expect(await reports(s.review.id)).toEqual([]);
  });
});

// @traces 076-FR-006
describe('malformed bodies at the edge', () => {
  it.each([
    ['a null text', { reason: 'insults', text: null }],
    ['an array text', { reason: 'other', text: ['a'] }],
    ['an object text', { reason: 'other', text: { a: 1 } }],
    ['a null reason', { reason: null }],
    ['a numeric reason', { reason: 1 }],
    ['an upper-case reason', { reason: 'INSULTS' }],
    ['a reason with a trailing space', { reason: 'insults ' }],
    ['a reason named for the prototype', { reason: '__proto__' }],
    ['an array reason', { reason: ['insults'] }],
    ['a body with a status member', { reason: 'insults', status: 'decided' }],
    ['a body with a reporterId member', { reason: 'insults', reporterId: 'x' }],
  ])('refuses %s with 400 and writes nothing', async (_, body) => {
    const s = await setting();

    const refused = await report(s.owner, s.review.id, body);

    // The body's problem code is the API's ProblemFilter's, outside this app.
    expect(refused.status).toBe(400);
    expect(await reports(s.review.id)).toEqual([]);
    expect(await statusOf(s.review.id)).toBe('published');
  });

  it('refuses an array body with 400', async () => {
    const s = await setting();

    const refused = await report(s.owner, s.review.id, [{ reason: 'insults' }]);

    expect(refused.status).toBe(400);
    expect(await reports(s.review.id)).toEqual([]);
  });

  it('refuses a body that is not JSON with 415', async () => {
    const s = await setting();

    const refused = await send(
      'post',
      `/reviews/${s.review.id}/reports`,
      s.owner,
      undefined,
      { 'Content-Type': 'text/plain' },
    ).send('reason=insults');

    expect(refused.status).toBe(415);
    expect(await reports(s.review.id)).toEqual([]);
  });

  it('refuses a broken JSON body with 400', async () => {
    const s = await setting();

    const refused = await send(
      'post',
      `/reviews/${s.review.id}/reports`,
      s.owner,
      undefined,
      { 'Content-Type': 'application/json' },
    ).send('{"reason":');

    expect(refused.status).toBe(400);
  });

  it('refuses no body at all with 415', async () => {
    const s = await setting();

    const refused = await send(
      'post',
      `/reviews/${s.review.id}/reports`,
      s.owner,
    );

    expect(refused.status).toBe(415);
  });

  it('tells a receptionist an invalid body is 400 before the owner rule', async () => {
    const s = await setting();

    const refused = await report(
      bearer(s.dinamo.receptionist, 'receptionist'),
      s.review.id,
      {},
    );

    expect(refused.status).toBe(400);
  });
});

// @traces 076-FR-006 076-FR-007
describe('the order of the checks', () => {
  it('tells a receptionist of the review’s garage 403 even when the text is wrong', async () => {
    const s = await setting();

    const refused = await report(
      bearer(s.dinamo.receptionist, 'receptionist'),
      s.review.id,
      { reason: 'other' },
    );

    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('forbidden');
  });

  it('tells a receptionist or mechanic of another garage 404, not 403', async () => {
    const s = await setting();
    const nord = await team('Service Nord');

    const answers = await Promise.all([
      report(bearer(nord.receptionist, 'receptionist'), s.review.id, {
        reason: 'insults',
      }),
      report(bearer(nord.answering, 'mechanic'), s.review.id, {
        reason: 'insults',
      }),
    ]);

    expect(answers.map((a) => a.status)).toEqual([404, 404]);
  });

  it('tells a removed review 404 even with a wrong text', async () => {
    const s = await setting('removed');

    const refused = await report(s.owner, s.review.id, { reason: 'other' });

    expect(refused.status).toBe(404);
  });

  it('refuses a kept review with already_kept before a text error', async () => {
    const s = await setting();
    await decided(s.review.id, new Date(Date.now() - HOUR));

    const refused = await report(s.owner, s.review.id, { reason: 'other' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('already_kept');
  });

  it('refuses a reported review that also has a kept decision with already_reported', async () => {
    const s = await setting('reported');
    await decided(s.review.id, new Date(Date.now() - HOUR));

    const refused = await report(s.owner, s.review.id, { reason: 'ads' });

    expect(refused.body.code).toBe('already_reported');
  });
});

// @traces 076-FR-007
describe('which earlier decision blocks a new report', () => {
  it('takes the newest decided report, not the oldest', async () => {
    const s = await setting();
    const first = new Date(Date.now() - 5 * HOUR);
    await decided(s.review.id, first);
    await prisma.review.update({
      data: { editedAt: new Date(first.getTime() + HOUR) },
      where: { id: s.review.id },
    });
    await decided(s.review.id, new Date(Date.now() - HOUR));

    const refused = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('already_kept');
  });

  it('is not blocked by a closed report, only by a decided one', async () => {
    const s = await setting();
    await decided(s.review.id, new Date(Date.now() - HOUR), 'closed');

    const sent = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(sent.status).toBe(201);
  });

  it('is not blocked by a decision older than the last edit', async () => {
    const s = await setting();
    const decision = new Date(Date.now() - 3 * HOUR);
    await decided(s.review.id, decision);
    await prisma.review.update({
      data: { editedAt: new Date(decision.getTime() + 1) },
      where: { id: s.review.id },
    });

    const sent = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(sent.status).toBe(201);
  });

  it('answers already_reported, not a server error, when a pending report was left on a published review', async () => {
    const s = await setting();
    await prisma.reviewReport.create({
      data: {
        dueAt: new Date(Date.now() + HOUR),
        reason: 'ads',
        reviewId: s.review.id,
        source: 'garage',
        status: 'pending',
      },
    });

    const refused = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('already_reported');
    expect(await statusOf(s.review.id)).toBe('published');
  });
});

// @traces 076-FR-009
describe('many reports at once', () => {
  it('keeps one report, one event and two audit entries out of ten calls', async () => {
    const s = await setting();

    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        report(s.owner, s.review.id, {
          reason: i % 2 ? 'ads' : 'insults',
        }),
      ),
    );

    expect(answers.filter((a) => a.status === 201)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(9);
    expect(
      new Set(answers.filter((a) => a.status === 409).map((a) => a.body.code)),
    ).toEqual(new Set(['already_reported']));
    expect(await reports(s.review.id)).toHaveLength(1);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'review.reported', subjectId: s.review.id },
      }),
    ).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: {
          subjectId: { in: [s.review.id, (await reports(s.review.id))[0].id] },
        },
      }),
    ).toBe(2);
  });

  it('reports two different reviews of one garage independently', async () => {
    const s = await setting();
    const other = await review(s.dinamo.garage.id, s.andrei, { rating: 2 });

    const answers = await Promise.all([
      report(s.owner, s.review.id, { reason: 'insults' }),
      report(s.owner, other.id, { reason: 'insults' }),
    ]);

    expect(answers.map((a) => a.status)).toEqual([201, 201]);
  });
});

// @traces 076-FR-006
describe('the review id in the path', () => {
  it('accepts the upper-case form of a real id', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id.toUpperCase(), {
      reason: 'insults',
    });

    expect(sent.status).toBe(201);
  });

  it.each([
    ['an id with a trailing space', (id: string) => `${id}%20`],
    ['an id with a quote', (id: string) => `${id}'`],
    ['a quoted injection', () => `'%20OR%201=1--`],
    ['the nil uuid', () => '00000000-0000-0000-0000-000000000000'],
    ['a very long id', () => 'a'.repeat(5000)],
  ])('answers %s with the one 404', async (_, make) => {
    const s = await setting();
    const reference = await report(s.owner, randomUUID(), {
      reason: 'insults',
    });

    const refused = await report(s.owner, make(s.review.id), {
      reason: 'insults',
    });

    expect(refused.status).toBe(404);
    expect(refused.body).toEqual(reference.body);
    expect(await statusOf(s.review.id)).toBe('published');
  });
});

// @traces 076-FR-006
describe('sessions', () => {
  it('refuses a tampered token with 401 sign_in_required', async () => {
    const s = await setting();

    const refused = await report(`${s.owner}x`, s.review.id, {
      reason: 'insults',
    });

    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('sign_in_required');
    expect(await reports(s.review.id)).toEqual([]);
  });

  it('refuses a malformed authorization header with 401', async () => {
    const s = await setting();

    const refused = await report('Bearer', s.review.id, { reason: 'insults' });

    expect(refused.status).toBe(401);
  });

  it('asks for a session before it looks at a bad body or id', async () => {
    const refused = await post('/reviews/not-a-uuid/reports', {});

    expect(refused.status).toBe(401);
  });

  it('refuses the owner’s account used as a driver with the one 404', async () => {
    const s = await setting();
    // A token's role counts only when the account holds it.
    await prisma.accountRole.create({
      data: { accountId: s.dinamo.owner, role: 'driver' },
    });

    const refused = await report(
      bearer(s.dinamo.owner, 'driver'),
      s.review.id,
      { reason: 'insults' },
    );

    expect(refused.status).toBe(404);
    expect(await reports(s.review.id)).toEqual([]);
  });
});

// @traces 076-FR-010 076-FR-011
describe('what a report leaves in the reads', () => {
  it('lists the review again on the public reads when it is published once more', async () => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { onProfile: true },
      where: { id: s.dinamo.answeringMechanic.id },
    });
    const before = await get(`/reviews/garage/${s.dinamo.garage.id}`);
    await report(s.owner, s.review.id, { reason: 'insults' });
    const during = await get(`/reviews/garage/${s.dinamo.garage.id}`);

    expect(before.body.items.map((i: { id: string }) => i.id)).toEqual([
      s.review.id,
    ]);
    expect(during.body.items).toEqual([]);
    expect(JSON.stringify(during.body)).not.toContain('reason');

    await prisma.review.update({
      data: { status: 'published' },
      where: { id: s.review.id },
    });
    const after = await get(`/reviews/garage/${s.dinamo.garage.id}`);
    expect(after.body.items.map((i: { id: string }) => i.id)).toEqual([
      s.review.id,
    ]);
  });

  it('leaves the author’s own rows and the review’s text untouched', async () => {
    const s = await setting();

    await report(s.owner, s.review.id, { reason: 'insults' });

    const after = await prisma.review.findUniqueOrThrow({
      where: { id: s.review.id },
    });
    expect(after).toMatchObject({
      editedAt: s.review.editedAt,
      rating: s.review.rating,
      text: s.review.text,
    });
  });

  it('writes the event with a null mechanic when the review names none', async () => {
    const s = await setting();
    await prisma.review.update({
      data: { mechanicId: null },
      where: { id: s.review.id },
    });

    const sent = await report(s.owner, s.review.id, { reason: 'ads' });

    expect(sent.status).toBe(201);
    const [event] = await prisma.outboxEvent.findMany({
      where: { kind: 'review.reported', subjectId: s.review.id },
    });
    expect(event.payload).toMatchObject({ mechanicId: null, reason: 'ads' });
  });
});
