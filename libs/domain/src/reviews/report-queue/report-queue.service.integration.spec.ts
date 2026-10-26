import { DELETED_AUTHOR } from '@motor-fix/contracts';

import { ReportQueueService } from './report-queue.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import type {
  ReviewReportDecision,
  ReviewReportReason,
  ReviewReportSource,
  ReviewReportStatus,
} from '../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';
import { garageReviews, reviewReply } from '../reviews.testing';

const world = quotesWorld();
const { prisma } = world;
const { review } = garageReviews(world);
const reply = reviewReply(world);
serialDatabase(databaseUrl);

const HOUR = 3_600_000;
const NOW = new Date('2026-10-26T12:00:00Z');
const service = new ReportQueueService(prisma);

beforeEach(() => world.reset());
afterAll(() => prisma.$disconnect());

interface ReportOptions {
  createdAt?: Date;
  decision?: ReviewReportDecision;
  reason?: ReviewReportReason;
  source?: ReviewReportSource;
  status?: ReviewReportStatus;
  target?: 'review' | 'reply';
  text?: string;
}

// A report on the review, made `createdAt` and due 48 hours later.
const report = (reviewId: string, options: ReportOptions = {}) => {
  const createdAt = options.createdAt ?? new Date(NOW.getTime() - HOUR);
  return prisma.reviewReport.create({
    data: {
      createdAt,
      decision: options.decision,
      dueAt: new Date(createdAt.getTime() + 48 * HOUR),
      reason: options.reason ?? 'insults',
      reviewId,
      source: options.source ?? 'garage',
      status: options.status ?? 'pending',
      target: options.target ?? 'review',
      text: options.text,
    },
  });
};

const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const read = (page = 1, language: 'ro' | 'en' = 'ro') =>
  service.read({ language, page }, NOW);

// @traces 177-FR-001 177-FR-002 177-FR-014
describe('the pending reports, one item each, oldest first', () => {
  it('lists only pending reports, by createdAt then id, with the counts', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const first = await review(dinamo.id, andrei, { rating: 1 });
    const second = await review(dinamo.id, andrei, { rating: 2 });
    const decided = await review(dinamo.id, andrei, { rating: 1 });
    const closed = await review(dinamo.id, andrei, { rating: 1 });
    const late = await report(first.id, { createdAt: ago(50) });
    const fresh = await report(second.id, { createdAt: ago(2) });
    await report(decided.id, { decision: 'kept', status: 'decided' });
    await report(closed.id, { status: 'closed' });

    const queue = await read();

    expect(queue.items.map((item) => item.report.id)).toEqual([
      late.id,
      fresh.id,
    ]);
    expect(queue).toMatchObject({
      oldestCreatedAt: late.createdAt.toISOString(),
      overdue: 1,
      page: 1,
      pageSize: 20,
      total: 2,
    });
    expect(queue.items[0].report).toMatchObject({
      dueAt: late.dueAt.toISOString(),
      overdue: true,
      reason: 'insults',
      source: 'garage',
      target: 'review',
    });
    expect(queue.items[1].report.overdue).toBe(false);
  });

  it('counts a report overdue from the very moment it is due', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const one = await review(dinamo.id, andrei, { rating: 1 });
    await report(one.id, { createdAt: ago(48) });

    const queue = await read();

    expect(queue.overdue).toBe(1);
    expect(queue.items[0].report.overdue).toBe(true);
  });

  it('answers an empty queue with zero counts and no oldest date', async () => {
    await expect(read()).resolves.toEqual({
      items: [],
      oldestCreatedAt: null,
      overdue: 0,
      page: 1,
      pageSize: 20,
      total: 0,
    });
  });

  it('gives 20 a page, and a page past the end empty with the true counts', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    for (let n = 0; n < 21; n += 1) {
      const one = await review(dinamo.id, andrei, { rating: 1, text: null });
      await report(one.id, { createdAt: ago(30 - n) });
    }

    const [one, two, three] = await Promise.all([read(1), read(2), read(3)]);

    expect(one.items).toHaveLength(20);
    expect(two.items).toHaveLength(1);
    expect(three).toMatchObject({ items: [], overdue: 0, page: 3, total: 21 });
  });

  it('shows the report text only for the reason other', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const one = await review(dinamo.id, andrei, { rating: 1 });
    await report(one.id, { reason: 'other', text: '<b>Nu a fost aici</b>' });

    const [item] = (await read()).items;

    expect(item.report).toMatchObject({
      reason: 'other',
      text: '<b>Nu a fost aici</b>',
    });
  });

  it('names the garage and the review, never an identifier of the author', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const one = await review(dinamo.id, andrei, {
      rating: 1,
      text: 'Nu recomand.',
    });
    await report(one.id);

    const [item] = (await read()).items;

    expect(item.garage).toEqual({ id: dinamo.id, name: 'Atelier Dinamo' });
    expect(item.review).toEqual({
      author: 'Andrei M.',
      id: one.id,
      postedAt: one.postedAt.toISOString(),
      score: 1,
      source: 'job',
      text: 'Nu recomand.',
    });
    expect(item.reply).toBeUndefined();
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: andrei },
    });
    const body = JSON.stringify(item);
    expect(body).not.toContain(andrei);
    expect(body).not.toContain('B123ABC');
    for (const secret of [account.email, account.phone]) {
      if (secret) expect(body).not.toContain(secret);
    }
  });

  it('makes a reported reply its own item, with the review for context', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const one = await review(dinamo.id, andrei, { rating: 2 });
    const answer = await reply(one.id, { text: 'Nu a fost la noi.' });
    await report(one.id, { source: 'author', target: 'reply' });

    const [item] = (await read()).items;

    expect(item.report).toMatchObject({ source: 'author', target: 'reply' });
    expect(item.review.id).toBe(one.id);
    expect(item.reply).toEqual({
      editedAt: null,
      id: answer.id,
      postedAt: answer.postedAt.toISOString(),
      postedBy: 'Atelier Dinamo',
      text: 'Nu a fost la noi.',
    });
  });
});

// @traces 177-FR-003
describe('the four facts, computed on reading', () => {
  it('confirms the job: its work in the reader’s language, the car and the handover', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const one = await review(dinamo.id, andrei, {
      jobs: [
        { nameEn: 'Timing chain kit', nameRo: 'Kit lanț distribuție' },
        { nameEn: 'Oil change', nameRo: 'Schimb ulei' },
        { included: false, nameEn: 'Brake pads', nameRo: 'Plăcuțe frână' },
      ],
      rating: 1,
    });
    const handedOverAt = ago(72);
    await prisma.job.update({
      data: { handedOverAt },
      where: { id: one.jobId },
    });
    await report(one.id);

    const [ro] = (await read(1, 'ro')).items;
    const [en] = (await read(1, 'en')).items;

    expect(ro.facts.job).toEqual({
      car: 'BMW 320d',
      handedOverAt: handedOverAt.toISOString(),
      kind: 'confirmed',
      work: 'Kit lanț distribuție · Schimb ulei',
    });
    expect(en.facts.job.work).toBe('Timing chain kit · Oil change');
  });

  it('leaves the handover out when the car was not handed over', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const one = await review(dinamo.id, andrei, { rating: 1 });
    await report(one.id);

    const [item] = (await read()).items;

    expect(item.facts.job).toMatchObject({ handedOverAt: null });
  });

  it('says there is no job for a review written from the profile', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const one = await review(dinamo.id, andrei, {
      rating: 1,
      source: 'profile',
    });
    await report(one.id);

    const [item] = (await read()).items;

    expect(item.facts.job).toEqual({ kind: 'none' });
    expect(item.review.source).toBe('profile');
  });

  it('gives the author account’s creation date, or that it is deleted', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const maria = await world.account('Maria Popescu');
    const kept = await review(dinamo.id, andrei, { rating: 1 });
    const gone = await review(dinamo.id, maria, { rating: 1 });
    await report(kept.id, { createdAt: ago(3) });
    await report(gone.id, { createdAt: ago(2) });
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: maria },
    });
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: andrei },
    });

    const [first, second] = (await read()).items;

    expect(first.facts.account).toEqual({
      createdAt: account.createdAt.toISOString(),
      deleted: false,
    });
    expect(second.facts.account).toEqual({ deleted: true });
    expect(second.review.author).toBe(DELETED_AUTHOR);
    expect(second.facts.identicalReviews).toBe(0);
  });

  it('counts the author’s other reviews with the same trimmed text, at any garage', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const nord = await world.garage('Service Nord');
    const andrei = await world.account('Andrei Ion Marin');
    const maria = await world.account('Maria Popescu');
    const one = await review(dinamo.id, andrei, {
      rating: 1,
      text: 'Hoți!',
    });
    await review(nord.id, andrei, { text: '  Hoți!  ' });
    await review(nord.id, andrei, { status: 'removed', text: 'Hoți!' });
    await review(nord.id, andrei, { text: 'hoți!' });
    await review(nord.id, andrei, {
      status: 'deleted_by_author',
      text: 'Hoți!',
    });
    await review(nord.id, maria, { text: 'Hoți!' });
    await report(one.id);

    const [item] = (await read()).items;

    expect(item.facts.identicalReviews).toBe(2);
  });

  it('counts no identical reviews for a review without text', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const one = await review(dinamo.id, andrei, { rating: 1, text: null });
    await review(dinamo.id, andrei, { text: null });
    await report(one.id);

    const [item] = (await read()).items;

    expect(item.facts.identicalReviews).toBe(0);
    expect(item.review.text).toBeNull();
  });

  it('counts the garage’s own earlier reports and those kept', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const nord = await world.garage('Service Nord');
    const andrei = await world.account('Andrei Ion Marin');
    const reviews = [];
    for (let n = 0; n < 6; n += 1) {
      reviews.push(await review(dinamo.id, andrei, { rating: 1 }));
    }
    const other = await review(nord.id, andrei, { rating: 1 });
    await report(reviews[0].id, {
      createdAt: ago(100),
      decision: 'kept',
      status: 'decided',
    });
    await report(reviews[1].id, {
      createdAt: ago(90),
      decision: 'removed',
      status: 'decided',
    });
    await report(reviews[2].id, { createdAt: ago(80), status: 'closed' });
    await report(reviews[3].id, {
      createdAt: ago(70),
      decision: 'kept',
      source: 'automatic',
      status: 'decided',
    });
    await report(other.id, {
      createdAt: ago(60),
      decision: 'kept',
      status: 'decided',
    });
    const now = await report(reviews[4].id, { createdAt: ago(5) });
    await report(reviews[5].id, { createdAt: ago(1) });

    const items = (await read()).items;
    const current = items.find((item) => item.report.id === now.id);
    const later = items.find((item) => item.report.id !== now.id);

    expect(current?.facts.garageReports).toEqual({ earlier: 3, kept: 1 });
    expect(later?.facts.garageReports).toEqual({ earlier: 4, kept: 1 });
  });
});

// @traces 177-FR-004
describe('the counts the overview reads', () => {
  it('counts the pending reports and those past due, nothing else', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const reviews = [];
    for (let n = 0; n < 4; n += 1) {
      reviews.push(await review(dinamo.id, andrei, { rating: 1 }));
    }
    await report(reviews[0].id, { createdAt: ago(49) });
    await report(reviews[1].id, { createdAt: ago(1) });
    await report(reviews[2].id, {
      createdAt: ago(60),
      decision: 'kept',
      status: 'decided',
    });
    await report(reviews[3].id, { createdAt: ago(60), status: 'closed' });

    await expect(service.counts(NOW)).resolves.toEqual({
      oldestCreatedAt: ago(49),
      overdue: 1,
      pending: 2,
    });
  });
});
