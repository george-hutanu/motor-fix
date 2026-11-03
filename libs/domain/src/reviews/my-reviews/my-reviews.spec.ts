import { type MyReviewSource, rowOf } from './my-reviews.service';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

// A done job of the caller's at Atelier Dinamo, handed over two days ago,
// with the review and reply the case gives.
function source(over: Partial<MyReviewSource> = {}): MyReviewSource {
  return {
    car: {
      brand: 'BMW',
      engine: '2.0d',
      fuel: 'diesel',
      model: '320d',
      year: 2018,
    },
    garage: { id: 'g-1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
    handedOverAt: ago(2),
    jobId: 'job-1',
    jobs: [
      {
        id: 'rj-1',
        jobTypeId: 'jt-1',
        nameEn: 'Timing chain kit',
        nameRo: 'Kit lanț distribuție',
        position: 1,
      },
    ],
    replyReportedByMe: false,
    review: null,
    ...over,
  };
}

const written = (
  over: Partial<NonNullable<MyReviewSource['review']>> = {},
): NonNullable<MyReviewSource['review']> => ({
  editedAt: null,
  id: 'rev-1',
  postedAt: ago(1),
  rating: 4,
  reply: null,
  status: 'published',
  text: 'Treabă curată.\nAm plătit cât s-a spus.',
  ...over,
});

const reply = (
  over: Partial<NonNullable<NonNullable<MyReviewSource['review']>['reply']>>,
) => ({
  editedAt: null,
  postedAt: ago(0.5),
  status: 'published' as const,
  text: 'Mulțumim, Andrei!',
  ...over,
});

// @traces 117-FR-002
// @traces 117-FR-004
describe('a waiting row', () => {
  it('carries the job, the car and the handover date, and nothing of a review', () => {
    const row = rowOf(source(), NOW);

    expect(row).toEqual({
      canAppeal: false,
      canEdit: false,
      canReportReply: false,
      canWrite: true,
      car: source().car,
      date: ago(2).toISOString(),
      editedAt: null,
      firstLine: null,
      garage: source().garage,
      handedOverAt: ago(2).toISOString(),
      jobId: 'job-1',
      jobs: source().jobs,
      postedAt: null,
      rating: null,
      reply: null,
      reviewId: null,
      state: 'waiting',
    });
  });
});

// @traces 117-FR-003
// @traces 117-FR-004
describe('a written row', () => {
  it('carries the review’s score, first line and dates', () => {
    const row = rowOf(source({ review: written() }), NOW);

    expect(row).toMatchObject({
      canWrite: false,
      date: ago(2).toISOString(),
      editedAt: null,
      firstLine: 'Treabă curată.',
      postedAt: ago(1).toISOString(),
      rating: 4,
      reviewId: 'rev-1',
      state: 'published',
    });
  });

  it('skips blank leading lines and trims the first line', () => {
    const row = rowOf(
      source({ review: written({ text: '\n   \n  Prea scump.  \nRest' }) }),
      NOW,
    );

    expect(row.firstLine).toBe('Prea scump.');
  });

  it('has no first line without a text', () => {
    const row = rowOf(source({ review: written({ text: null }) }), NOW);

    expect(row.firstLine).toBeNull();
  });

  it('carries the edit date of an edited review', () => {
    const row = rowOf(
      source({ review: written({ editedAt: ago(0.25) }) }),
      NOW,
    );

    expect(row.editedAt).toBe(ago(0.25).toISOString());
  });

  it('is dated by the review’s posting time while the job has no handover', () => {
    const row = rowOf(
      source({ handedOverAt: null, review: written({ postedAt: ago(3) }) }),
      NOW,
    );

    expect(row.date).toBe(ago(3).toISOString());
    expect(row.handedOverAt).toBeNull();
  });

  it.each(['published', 'reported', 'removed'] as const)(
    'takes the review’s state when it is %s',
    (status) => {
      const row = rowOf(source({ review: written({ status }) }), NOW);

      expect(row.state).toBe(status);
    },
  );
});

// @traces 117-FR-004
describe('the garage’s reply', () => {
  it('is carried whole while published, open to a report', () => {
    const row = rowOf(
      source({ review: written({ reply: reply({ editedAt: ago(0.1) }) }) }),
      NOW,
    );

    expect(row.reply).toEqual({
      editedAt: ago(0.1).toISOString(),
      postedAt: ago(0.5).toISOString(),
      reportedByMe: false,
      status: 'published',
      text: 'Mulțumim, Andrei!',
    });
    expect(row.canReportReply).toBe(true);
  });

  it('is carried while reported by the caller, marked and closed to another report', () => {
    const row = rowOf(
      source({
        replyReportedByMe: true,
        review: written({ reply: reply({ status: 'reported' }) }),
      }),
      NOW,
    );

    expect(row.reply).toMatchObject({
      reportedByMe: true,
      status: 'reported',
    });
    expect(row.canReportReply).toBe(false);
  });

  it('closes a published reply to a report while the caller’s report is pending', () => {
    const row = rowOf(
      source({
        replyReportedByMe: true,
        review: written({ reply: reply({}) }),
      }),
      NOW,
    );

    expect(row.reply?.reportedByMe).toBe(true);
    expect(row.canReportReply).toBe(false);
  });

  it('is reported by someone else: carried, not marked as the caller’s, closed to a report', () => {
    const row = rowOf(
      source({ review: written({ reply: reply({ status: 'reported' }) }) }),
      NOW,
    );

    expect(row.reply?.reportedByMe).toBe(false);
    expect(row.canReportReply).toBe(false);
  });

  it('is null once removed', () => {
    const row = rowOf(
      source({ review: written({ reply: reply({ status: 'removed' }) }) }),
      NOW,
    );

    expect(row.reply).toBeNull();
    expect(row.canReportReply).toBe(false);
  });

  it('is null with none', () => {
    const row = rowOf(source({ review: written() }), NOW);

    expect(row.reply).toBeNull();
    expect(row.canReportReply).toBe(false);
  });
});

// @traces 117-FR-004
describe('the flags for the later stories', () => {
  it('opens an edit while the published review is at most 14 days old', () => {
    const fresh = rowOf(
      source({ review: written({ postedAt: ago(14) }) }),
      NOW,
    );
    const old = rowOf(
      source({
        review: written({ postedAt: new Date(ago(14).getTime() - 1) }),
      }),
      NOW,
    );

    expect(fresh.canEdit).toBe(true);
    expect(old.canEdit).toBe(false);
  });

  it.each(['reported', 'removed'] as const)(
    'closes the edit of a %s review, however fresh',
    (status) => {
      const row = rowOf(source({ review: written({ status }) }), NOW);

      expect(row.canEdit).toBe(false);
    },
  );

  it('opens the appeal of a removed review only', () => {
    const removed = rowOf(
      source({ review: written({ status: 'removed' }) }),
      NOW,
    );
    const reported = rowOf(
      source({ review: written({ status: 'reported' }) }),
      NOW,
    );

    expect(removed.canAppeal).toBe(true);
    expect(reported.canAppeal).toBe(false);
    expect(rowOf(source(), NOW).canAppeal).toBe(false);
  });

  it('opens the writing of a waiting row only', () => {
    expect(rowOf(source(), NOW).canWrite).toBe(true);
    expect(rowOf(source({ review: written() }), NOW).canWrite).toBe(false);
  });
});
