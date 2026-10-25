import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { audienceOf } from '../../events/audience';
import { outbox } from '../../events/event.port';
import type { ReviewStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews } from '../reviews.testing';

const reader = countedMetrics();
const { bearer, get, post, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);

const HOUR = 3_600_000;
const OWNER_ONLY = 'Doar proprietarul poate raporta o recenzie.';
const KEPT_RO =
  'Păstrată de un admin; poate fi raportată din nou doar după ce autorul o editează.';
const KEPT_EN =
  'Kept by an admin; it can be reported again only after the author edits it.';

// Atelier Dinamo's team and one published review of a job Andrei had done
// there by its quoting mechanic.
async function setting(status: ReviewStatus = 'published') {
  const dinamo = await team('Atelier Dinamo');
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const posted = await review(dinamo.garage.id, andrei, { rating: 1 });
  const one = await prisma.review.update({
    data: { mechanicId: dinamo.answeringMechanic.id, status },
    where: { id: posted.id },
  });
  const job = await prisma.job.findUniqueOrThrow({ where: { id: one.jobId } });
  return {
    andrei,
    dinamo,
    job,
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

const audits = (reviewId: string, reportIds: string[] = []) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId: { in: [reviewId, ...reportIds] } },
  });

const reported = (subjectId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'review.reported', subjectId },
  });

const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_reviews_reported_total', { outcome });

// A decision on an earlier report, as the admin's stories will write it.
const decided = (
  reviewId: string,
  decidedAt: Date,
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
      status: 'decided',
    },
  });

// @traces 076-FR-006 076-FR-008 076-FR-009
// @traces 076-FR-014
// @traces 076-FR-013
describe('the owner reports a review', () => {
  it('stores a pending report due in 48 hours and answers it with the review now reported', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(sent.status).toBe(201);
    const [row] = await reports(s.review.id);
    expect(sent.body).toEqual({
      dueAt: row.dueAt.toISOString(),
      id: row.id,
      reason: 'insults',
      review: { id: s.review.id, status: 'reported' },
      status: 'pending',
    });
    expect(row).toMatchObject({
      decidedAt: null,
      decidedById: null,
      decision: null,
      reason: 'insults',
      reporterId: s.dinamo.owner,
      source: 'garage',
      status: 'pending',
      target: 'review',
      text: null,
    });
    expect(row.dueAt.getTime() - row.createdAt.getTime()).toBe(48 * HOUR);
    expect(await statusOf(s.review.id)).toBe('reported');
  });

  it('writes the report and the status change to the audit history as the owner', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, { reason: 'insults' });

    const entries = await audits(s.review.id, [sent.body.id]);
    expect(entries).toHaveLength(2);
    const scope = {
      actorId: s.dinamo.owner,
      actorRole: 'owner',
      carId: s.job.carId,
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
    };
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...scope,
          action: 'create',
          subjectId: sent.body.id,
          subjectType: 'review_report',
        }),
        expect.objectContaining({
          ...scope,
          action: 'update',
          field: 'status',
          newValue: 'reported',
          oldValue: 'published',
          subjectId: s.review.id,
          subjectType: 'review',
        }),
      ]),
    );
    const created = entries.find((one) => one.action === 'create');
    expect(JSON.stringify(created?.newValue)).not.toContain(s.andrei);
  });

  it('writes one review.reported event to the review’s audience', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, { reason: 'hate' });

    const events = await reported(s.review.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      driverId: s.andrei,
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
      mechanicId: s.dinamo.answeringMechanic.id,
      reason: 'hate',
      reportId: sent.body.id,
      reviewId: s.review.id,
      source: 'garage',
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

  it('stores the trimmed text with something else', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, {
      reason: 'other',
      text: '  Recenzia e despre alt service.  ',
    });

    expect(sent.status).toBe(201);
    expect((await reports(s.review.id))[0].text).toBe(
      'Recenzia e despre alt service.',
    );
  });

  it('takes a text of exactly 500 characters', async () => {
    const s = await setting();

    const sent = await report(s.owner, s.review.id, {
      reason: 'other',
      text: 'ă'.repeat(500),
    });

    expect(sent.status).toBe(201);
  });

  it('counts the report by its reason', async () => {
    const s = await setting();
    const before = await counted('insults');

    await report(s.owner, s.review.id, { reason: 'insults' });

    expect(await counted('insults')).toBe(before + 1);
  });

  it('leaves no report, status change, audit entry or event when the event cannot be written', async () => {
    const s = await setting();
    jest
      .spyOn(outbox, 'record')
      .mockRejectedValueOnce(new Error('outbox down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const refused = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(refused.status).toBe(500);
    expect(await reports(s.review.id)).toEqual([]);
    expect(await statusOf(s.review.id)).toBe('published');
    expect(await audits(s.review.id)).toEqual([]);
    expect(await reported(s.review.id)).toEqual([]);
  });

  it('keeps one report when two are sent at once', async () => {
    const s = await setting();

    const answers = await Promise.all([
      report(s.owner, s.review.id, { reason: 'insults' }),
      report(s.owner, s.review.id, { reason: 'ads' }),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(answers.find((a) => a.status === 409)?.body.code).toBe(
      'already_reported',
    );
    expect(await reports(s.review.id)).toHaveLength(1);
    expect(await reported(s.review.id)).toHaveLength(1);
  });

  it('reports a profile review, naming no job or car in the audit', async () => {
    const s = await setting();
    await prisma.review.update({
      data: { source: 'profile' },
      where: { id: s.review.id },
    });

    const sent = await report(s.owner, s.review.id, { reason: 'off_topic' });

    expect(sent.status).toBe(201);
    for (const entry of await audits(s.review.id, [sent.body.id])) {
      expect(entry).toMatchObject({ carId: null, jobId: null });
    }
  });
});

// @traces 076-FR-007 076-FR-014
// @traces 076-FR-012
describe('a review that may not be reported again', () => {
  it('refuses a reported review in the caller’s language, writing nothing', async () => {
    const s = await setting();
    await report(s.owner, s.review.id, { reason: 'insults' });
    const before = await counted('already_reported');

    const ro = await report(s.owner, s.review.id, { reason: 'ads' });
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: s.dinamo.owner },
    });
    const en = await report(s.owner, s.review.id, { reason: 'ads' });

    expect(ro.status).toBe(409);
    expect(ro.body).toEqual({
      code: 'already_reported',
      message: 'Recenzia e deja raportată.',
    });
    expect(en.body).toEqual({
      code: 'already_reported',
      message: 'This review is already reported.',
    });
    expect(await reports(s.review.id)).toHaveLength(1);
    expect(await counted('already_reported')).toBe(before + 2);
  });

  it('refuses a review an admin kept until its author edits it', async () => {
    const s = await setting();
    const decision = new Date(Date.now() - 2 * HOUR);
    await decided(s.review.id, decision);

    const kept = await report(s.owner, s.review.id, { reason: 'insults' });
    await prisma.review.update({
      data: { editedAt: new Date(decision.getTime() + 1000) },
      where: { id: s.review.id },
    });
    const again = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(kept.status).toBe(409);
    expect(kept.body).toEqual({ code: 'already_kept', message: KEPT_RO });
    expect(again.status).toBe(201);
    expect(await reports(s.review.id)).toHaveLength(2);
  });

  it('refuses a review restored after a removal, in English for an English owner', async () => {
    const s = await setting();
    await decided(s.review.id, new Date(Date.now() - HOUR), 'removed');
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: s.dinamo.owner },
    });

    const refused = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(refused.body).toEqual({ code: 'already_kept', message: KEPT_EN });
  });

  it('refuses a review edited at the very time of the decision', async () => {
    const s = await setting();
    const decision = new Date(Date.now() - HOUR);
    await decided(s.review.id, decision);
    await prisma.review.update({
      data: { editedAt: decision },
      where: { id: s.review.id },
    });

    const refused = await report(s.owner, s.review.id, { reason: 'insults' });

    expect(refused.body.code).toBe('already_kept');
  });
});

// @traces 076-FR-006 076-FR-007 076-FR-014
describe('what a report may hold', () => {
  it.each([
    [
      'an empty text with something else',
      { reason: 'other', text: '' },
      'required',
    ],
    [
      'a blank text with something else',
      { reason: 'other', text: '   ' },
      'required',
    ],
    ['no text with something else', { reason: 'other' }, 'required'],
    ['501 characters', { reason: 'other', text: 'a'.repeat(501) }, 'length'],
    [
      'a text with another reason',
      { reason: 'insults', text: 'Jigniri.' },
      'not_allowed',
    ],
  ])('refuses %s, naming the text', async (_, body, code) => {
    const s = await setting();
    const before = await counted('validation_failed');

    const refused = await report(s.owner, s.review.id, body);

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code, field: 'text' }],
    });
    expect(await reports(s.review.id)).toEqual([]);
    expect(await statusOf(s.review.id)).toBe('published');
    expect(await counted('validation_failed')).toBe(before + 1);
  });

  it('names the text problem in the caller’s language', async () => {
    const s = await setting();
    const body = { reason: 'insults', text: 'Jigniri.' };

    const ro = await report(s.owner, s.review.id, body);
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: s.dinamo.owner },
    });
    const en = await report(s.owner, s.review.id, body);

    expect(ro.body.message).toBe(
      'Textul raportului nu se potrivește cu motivul ales.',
    );
    expect(en.body.message).toBe('The report’s text does not fit its reason.');
  });

  it.each([
    ['a reason outside the nine', { reason: 'spam' }],
    ['no reason', {}],
    ['a text not a string', { reason: 'other', text: 5 }],
    ['a null text', { reason: 'insults', text: null }],
    ['another member', { reason: 'insults', urgent: true }],
  ])('refuses %s at the edge', async (_, body) => {
    const s = await setting();

    const refused = await report(s.owner, s.review.id, body);

    expect(refused.status).toBe(400);
    expect(await reports(s.review.id)).toEqual([]);
  });

  it('answers already_reported before a text error', async () => {
    const s = await setting('reported');

    const refused = await report(s.owner, s.review.id, {
      reason: 'insults',
      text: 'Jigniri.',
    });

    expect(refused.body.code).toBe('already_reported');
  });
});

// @traces 076-FR-006 076-FR-014
describe('who may report', () => {
  it.each([['receptionist'], ['mechanic']] as const)(
    'refuses the garage’s %s with the owner-only words',
    async (role) => {
      const s = await setting();
      const before = await counted('forbidden');
      const account =
        role === 'receptionist' ? s.dinamo.receptionist : s.dinamo.answering;

      const refused = await report(bearer(account, role), s.review.id, {
        reason: 'insults',
      });

      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({ code: 'forbidden', message: OWNER_ONLY });
      expect(await reports(s.review.id)).toEqual([]);
      expect(await statusOf(s.review.id)).toBe('published');
      expect(await counted('forbidden')).toBe(before + 1);
    },
  );

  it('tells everyone outside the garage, and every review it may not reach, the same 404', async () => {
    const s = await setting();
    const nord = await team('Service Nord');
    const admin = await world.account('Ana Admin', ['admin']);
    const loose = await world.account('Fără Garaj', ['garage']);
    const removed = await setting('removed');
    const deleted = await setting('deleted_by_author');
    const body = { reason: 'insults' };

    const answers = await Promise.all([
      report(bearer(nord.owner, 'garage'), s.review.id, body),
      report(bearer(s.andrei, 'driver'), s.review.id, body),
      report(bearer(admin, 'admin'), s.review.id, body),
      report(bearer(loose, 'garage'), s.review.id, body),
      report(s.owner, 'not-a-uuid', body),
      report(s.owner, randomUUID(), body),
      report(removed.owner, removed.review.id, body),
      report(deleted.owner, deleted.review.id, body),
    ]);

    expect(answers.map((a) => a.status)).toEqual(Array(8).fill(404));
    expect(new Set(answers.map((a) => JSON.stringify(a.body))).size).toBe(1);
    expect(JSON.stringify(answers[0].body)).not.toContain(s.review.id);
    expect(await prisma.reviewReport.count()).toBe(0);
    expect(await statusOf(s.review.id)).toBe('published');
  });

  it('needs a session', async () => {
    const s = await setting();

    const refused = await post(`/reviews/${s.review.id}/reports`, {
      reason: 'insults',
    });

    expect(refused.status).toBe(401);
    expect(await reports(s.review.id)).toEqual([]);
  });
});

// @traces 076-FR-010 076-FR-011
describe('what the other reads show of a report', () => {
  it('carries no reporter, reason or refusal in the public and the driver’s reads, eligibility included', async () => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { onProfile: true },
      where: { id: s.dinamo.answeringMechanic.id },
    });
    const sent = await report(s.owner, s.review.id, {
      reason: 'other',
      text: 'Nu a fost la noi.',
    });

    const reads = await Promise.all([
      get(`/reviews/garage/${s.dinamo.garage.id}`),
      get(`/reviews/mechanic/${s.dinamo.answeringMechanic.id}`),
      get(`/reviews/job/${s.review.jobId}`, bearer(s.andrei, 'driver')),
      get(
        `/reviews/eligibility?jobIds=${s.review.jobId}`,
        bearer(s.andrei, 'driver'),
      ),
    ]);

    expect(sent.status).toBe(201);
    expect(reads.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(reads[0].body.items).toEqual([]);
    expect(reads[1].body.items).toEqual([]);
    expect(reads[2].body.existing.status).toBe('reported');
    for (const read of reads) {
      const text = JSON.stringify(read.body);
      for (const absent of [
        s.dinamo.owner,
        sent.body.id,
        '"reason":"other"',
        'Nu a fost la noi.',
        'reportRefusal',
        'reporter',
      ]) {
        expect(text).not.toContain(absent);
      }
    }
  });
});
