import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { audienceOf } from '../../events/audience';
import { outbox } from '../../events/event.port';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews, reviewReply } from '../reviews.testing';

const reader = countedMetrics();
const { bearer, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);
const reply = reviewReply(world);

const HOUR = 3_600_000;

// Atelier Dinamo's team, an admin, and Andrei's job review done by the
// quoting mechanic, published with its garage's reply.
async function setting() {
  const dinamo = await team('Atelier Dinamo');
  const admin = await world.account('Ana Popescu', ['admin']);
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const posted = await review(dinamo.garage.id, andrei, {
    rating: 1,
    text: 'Nu recomand.',
  });
  const one = await prisma.review.update({
    data: { mechanicId: dinamo.answeringMechanic.id },
    where: { id: posted.id },
  });
  const job = await prisma.job.findUniqueOrThrow({ where: { id: one.jobId } });
  return { admin, andrei, auth: bearer(admin, 'admin'), dinamo, job, one };
}

// The garage's report of the review: the review reported, one pending report.
async function reportedReview(reviewId: string, reporterId: string) {
  await prisma.review.update({
    data: { status: 'reported' },
    where: { id: reviewId },
  });
  return prisma.reviewReport.create({
    data: {
      dueAt: new Date(Date.now() + 47 * HOUR),
      reason: 'insults',
      reporterId,
      reviewId,
      source: 'garage',
    },
  });
}

// The author's report of the garage's reply: the reply reported, the review
// still published.
async function reportedReply(reviewId: string, reporterId: string) {
  const answer = await reply(reviewId, {
    status: 'reported',
    text: 'Ești un mincinos.',
  });
  const report = await prisma.reviewReport.create({
    data: {
      dueAt: new Date(Date.now() + 47 * HOUR),
      reason: 'insults',
      reporterId,
      reviewId,
      source: 'author',
      target: 'reply',
    },
  });
  return { answer, report };
}

const decide = (auth: string, reviewId: string, body: object) =>
  send('post', `/admin/review-reports/${reviewId}/decision`, auth, body);

const reviewOf = (id: string) =>
  prisma.review.findUniqueOrThrow({ where: { id } });
const replyOf = (reviewId: string) =>
  prisma.reviewReply.findUniqueOrThrow({ where: { reviewId } });
const reportOf = (id: string) =>
  prisma.reviewReport.findUniqueOrThrow({ where: { id } });

const audits = (ids: string[]) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId: { in: ids } },
  });

const decidedEvents = (reviewId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'review.decided', subjectId: reviewId },
  });

const counted = (outcome: string, target: string, reason: string) =>
  counterTotal(reader, 'motorfix_review_decisions_total', {
    outcome,
    reason,
    target,
  });

// @traces 179-FR-001 179-FR-003
describe('an admin removes a reported review', () => {
  it('removes the review, its published reply and decides the report, answering 200', async () => {
    const s = await setting();
    const answer = await reply(s.one.id);
    const report = await reportedReview(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'hate',
    });

    expect(res.status).toBe(200);
    const decided = await reportOf(report.id);
    expect(res.body).toEqual({
      decidedAt: decided.decidedAt?.toISOString(),
      decision: 'removed',
      replyId: answer.id,
      reportId: report.id,
      reviewId: s.one.id,
      target: 'review',
    });
    expect(decided).toMatchObject({
      decidedById: s.admin,
      decision: 'removed',
      status: 'decided',
    });
    const removed = await reviewOf(s.one.id);
    expect(removed).toMatchObject({
      rating: 1,
      removalReason: 'hate',
      removedById: s.admin,
      status: 'removed',
      text: 'Nu recomand.',
    });
    expect(removed.removedAt?.toISOString()).toBe(
      decided.decidedAt?.toISOString(),
    );
    expect(await replyOf(s.one.id)).toMatchObject({
      removedCause: 'review_removed',
      status: 'removed',
      text: 'Mulțumim, Andrei!',
    });
    expect((await replyOf(s.one.id)).removedAt).not.toBeNull();
  });

  it('removes a review that has no reply, naming no reply', async () => {
    const s = await setting();
    await reportedReview(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'ads',
    });

    expect(res.status).toBe(200);
    expect(res.body.replyId).toBeNull();
    expect((await reviewOf(s.one.id)).status).toBe('removed');
    expect(await prisma.reviewReply.count()).toBe(0);
  });

  it('leaves an already removed reply as it was', async () => {
    const s = await setting();
    const answer = await reply(s.one.id, { status: 'removed' });
    await reportedReview(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'ads',
    });

    expect(res.status).toBe(200);
    expect(res.body.replyId).toBeNull();
    const kept = await replyOf(s.one.id);
    expect(kept).toMatchObject({
      removedCause: 'report_upheld',
      status: 'removed',
    });
    expect(kept.removedAt?.toISOString()).toBe(answer.removedAt?.toISOString());
  });

  it('removes a profile review and a review of a job not done alike', async () => {
    const s = await setting();
    await prisma.review.update({
      data: { source: 'profile' },
      where: { id: s.one.id },
    });
    await prisma.job.update({
      data: { status: 'in_work' },
      where: { id: s.job.id },
    });
    await reportedReview(s.one.id, s.dinamo.owner);

    const res = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'off_topic',
    });

    expect(res.status).toBe(200);
    expect((await reviewOf(s.one.id)).status).toBe('removed');
  });

  it('removes the review of an author whose account was deleted', async () => {
    const s = await setting();
    await reportedReview(s.one.id, s.dinamo.owner);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: s.andrei },
    });

    const res = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'insults',
    });

    expect(res.status).toBe(200);
    expect((await reviewOf(s.one.id)).status).toBe('removed');
  });

  it('counts the decision by outcome, target and rule', async () => {
    const s = await setting();
    await reportedReview(s.one.id, s.dinamo.owner);
    const before = await counted('removed', 'review', 'hate');

    await decide(s.auth, s.one.id, { decision: 'remove', reason: 'hate' });

    expect(await counted('removed', 'review', 'hate')).toBe(before + 1);
  });
});

// @traces 179-FR-006 179-FR-007
describe('what a review removal records', () => {
  it('writes the review’s, the reply’s and the report’s audit entries as the admin', async () => {
    const s = await setting();
    const answer = await reply(s.one.id);
    const report = await reportedReview(s.one.id, s.dinamo.owner);

    await decide(s.auth, s.one.id, { decision: 'remove', reason: 'hate' });

    const entries = await audits([s.one.id, answer.id, report.id]);
    const scope = {
      actorId: s.admin,
      actorRole: 'admin',
      carId: s.job.carId,
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
    };
    expect(entries).toHaveLength(3);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...scope,
          action: 'update',
          field: 'status',
          newValue: { reason: 'hate', status: 'removed', text: 'Nu recomand.' },
          oldValue: 'reported',
          subjectId: s.one.id,
          subjectType: 'review',
        }),
        expect.objectContaining({
          ...scope,
          action: 'update',
          field: 'status',
          newValue: { cause: 'review_removed', status: 'removed' },
          oldValue: 'published',
          subjectId: answer.id,
          subjectType: 'review_reply',
        }),
        expect.objectContaining({
          ...scope,
          action: 'update',
          field: 'status',
          newValue: { decision: 'removed', reason: 'hate', status: 'decided' },
          oldValue: 'pending',
          subjectId: report.id,
          subjectType: 'review_report',
        }),
      ]),
    );
  });

  it('writes one review.decided event to the review’s audience', async () => {
    const s = await setting();
    const answer = await reply(s.one.id);
    const report = await reportedReview(s.one.id, s.dinamo.owner);

    await decide(s.auth, s.one.id, { decision: 'remove', reason: 'hate' });

    const events = await decidedEvents(s.one.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      decision: 'removed',
      driverId: s.andrei,
      garageId: s.dinamo.garage.id,
      mechanicId: s.dinamo.answeringMechanic.id,
      reason: 'hate',
      replyId: answer.id,
      reportId: report.id,
      reviewId: s.one.id,
      target: 'review',
    });
    expect(events[0].audience).toEqual(
      audienceOf({
        authorAccountId: s.andrei,
        garageId: s.dinamo.garage.id,
        mechanicId: s.dinamo.answeringMechanic.id,
        type: 'review',
      }),
    );
  });

  it('names no job or car in the audit of a profile review', async () => {
    const s = await setting();
    await prisma.review.update({
      data: { source: 'profile' },
      where: { id: s.one.id },
    });
    const report = await reportedReview(s.one.id, s.dinamo.owner);

    await decide(s.auth, s.one.id, { decision: 'remove', reason: 'hate' });

    const entries = await audits([s.one.id, report.id]);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toMatchObject({ carId: null, jobId: null });
    }
  });

  it('writes nothing when the event cannot be written', async () => {
    const s = await setting();
    await reply(s.one.id);
    const report = await reportedReview(s.one.id, s.dinamo.owner);
    jest
      .spyOn(outbox, 'record')
      .mockRejectedValueOnce(new Error('outbox down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const res = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'hate',
    });

    expect(res.status).toBe(500);
    expect((await reviewOf(s.one.id)).status).toBe('reported');
    expect((await replyOf(s.one.id)).status).toBe('published');
    expect((await reportOf(report.id)).status).toBe('pending');
    expect(await audits([s.one.id, report.id])).toEqual([]);
    expect(await decidedEvents(s.one.id)).toEqual([]);
  });
});

// @traces 179-FR-004
describe('an admin removes a reported reply', () => {
  it('removes the reply as upheld and leaves the review as it was', async () => {
    const s = await setting();
    const { answer, report } = await reportedReply(s.one.id, s.andrei);
    const before = await reviewOf(s.one.id);

    const res = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'insults',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      decision: 'removed',
      replyId: answer.id,
      reportId: report.id,
      target: 'reply',
    });
    const removed = await replyOf(s.one.id);
    expect(removed).toMatchObject({
      removedCause: 'report_upheld',
      status: 'removed',
      text: 'Ești un mincinos.',
    });
    expect(removed.removedAt).not.toBeNull();
    expect(await reviewOf(s.one.id)).toEqual(before);
    expect(before).toMatchObject({
      removalReason: null,
      removedById: null,
      status: 'published',
    });
    expect(await reportOf(report.id)).toMatchObject({
      decidedById: s.admin,
      decision: 'removed',
      status: 'decided',
    });
  });

  it('records the reply’s and the report’s audit entries and a review.decided for the reply', async () => {
    const s = await setting();
    const { answer, report } = await reportedReply(s.one.id, s.andrei);

    await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'threats_or_legal_accusations',
    });

    const entries = await audits([s.one.id, answer.id, report.id]);
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'update',
          actorRole: 'admin',
          field: 'status',
          newValue: {
            reason: 'threats_or_legal_accusations',
            status: 'removed',
            text: 'Ești un mincinos.',
          },
          oldValue: 'reported',
          subjectId: answer.id,
          subjectType: 'review_reply',
        }),
        expect.objectContaining({
          oldValue: 'pending',
          subjectId: report.id,
          subjectType: 'review_report',
        }),
      ]),
    );
    const [event] = await decidedEvents(s.one.id);
    expect(event.payload).toMatchObject({
      reason: 'threats_or_legal_accusations',
      replyId: answer.id,
      target: 'reply',
    });
  });

  it('decides a reply report whose reply is already removed without writing the reply again', async () => {
    const s = await setting();
    const { answer, report } = await reportedReply(s.one.id, s.andrei);
    const gone = new Date(Date.now() - HOUR);
    await prisma.reviewReply.update({
      data: {
        removedAt: gone,
        removedCause: 'report_upheld',
        status: 'removed',
      },
      where: { id: answer.id },
    });

    const res = await decide(s.auth, s.one.id, {
      decision: 'remove',
      reason: 'insults',
    });

    expect(res.status).toBe(200);
    expect((await replyOf(s.one.id)).removedAt?.toISOString()).toBe(
      gone.toISOString(),
    );
    expect((await reportOf(report.id)).status).toBe('decided');
  });
});
