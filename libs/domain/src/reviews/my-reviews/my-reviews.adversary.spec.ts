import type { MyReviewSource } from './my-reviews.service';
import { rowOf } from './my-reviews.service';

const DAY = 24 * 60 * 60_000;
const NOW = new Date('2026-11-03T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

type Review = NonNullable<MyReviewSource['review']>;

function source(over: Partial<MyReviewSource> = {}): MyReviewSource {
  return {
    car: {
      brand: 'Dacia',
      engine: null,
      fuel: 'diesel',
      model: 'Logan',
      year: 2015,
    },
    garage: { id: 'g1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
    handedOverAt: ago(DAY),
    jobId: 'j1',
    jobs: [],
    replyReportedByMe: false,
    review: null,
    ...over,
  };
}

function written(over: Partial<Review> = {}): Review {
  return {
    editedAt: null,
    id: 'r1',
    postedAt: ago(DAY),
    rating: 4,
    reply: null,
    status: 'published',
    text: 'Treabă curată.',
    ...over,
  };
}

const reply = (status: 'published' | 'reported' | 'removed') => ({
  editedAt: null,
  postedAt: ago(DAY / 2),
  status,
  text: 'Mulțumim!',
});

// @traces 117-FR-004
describe('rowOf flags at their boundaries', () => {
  it('lets a published review be edited exactly 14 days after posting', () => {
    const row = rowOf(
      source({ review: written({ postedAt: ago(14 * DAY) }) }),
      NOW,
    );

    expect(row.canEdit).toBe(true);
  });

  it('refuses an edit one millisecond past 14 days', () => {
    const row = rowOf(
      source({ review: written({ postedAt: ago(14 * DAY + 1) }) }),
      NOW,
    );

    expect(row.canEdit).toBe(false);
  });

  it('counts the 14 days from posting, not from the last edit', () => {
    const row = rowOf(
      source({
        review: written({ editedAt: ago(DAY), postedAt: ago(30 * DAY) }),
      }),
      NOW,
    );

    expect(row.canEdit).toBe(false);
    expect(row.editedAt).toBe(ago(DAY).toISOString());
  });

  it.each(['reported', 'removed'] as const)(
    'never lets a %s review be edited',
    (status) => {
      const row = rowOf(source({ review: written({ status }) }), NOW);

      expect(row.canEdit).toBe(false);
    },
  );

  it('opens an appeal on a removed review only', () => {
    const removed = rowOf(
      source({ review: written({ status: 'removed' }) }),
      NOW,
    );
    const reported = rowOf(
      source({ review: written({ status: 'reported' }) }),
      NOW,
    );
    const waiting = rowOf(source(), NOW);

    expect([removed.canAppeal, reported.canAppeal, waiting.canAppeal]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('marks a waiting row writable and a written row not', () => {
    const waiting = rowOf(source(), NOW);
    const done = rowOf(source({ review: written() }), NOW);

    expect(waiting).toMatchObject({
      canEdit: false,
      canWrite: true,
      reply: null,
      reviewId: null,
      state: 'waiting',
    });
    expect(done.canWrite).toBe(false);
  });
});

// @traces 117-FR-004
describe('rowOf reply', () => {
  it('answers a removed reply as null and offers no report', () => {
    const row = rowOf(
      source({
        replyReportedByMe: true,
        review: written({ reply: reply('removed') }),
      }),
      NOW,
    );

    expect(row.reply).toBeNull();
    expect(row.canReportReply).toBe(false);
  });

  it('carries a reported reply, marked reported by me, with no report on offer', () => {
    const row = rowOf(
      source({
        replyReportedByMe: true,
        review: written({ reply: reply('reported') }),
      }),
      NOW,
    );

    expect(row.reply).toMatchObject({ reportedByMe: true, status: 'reported' });
    expect(row.canReportReply).toBe(false);
  });

  it('offers a report on a published reply, and not once it is mine pending', () => {
    const open = rowOf(
      source({ review: written({ reply: reply('published') }) }),
      NOW,
    );
    const mine = rowOf(
      source({
        replyReportedByMe: true,
        review: written({ reply: reply('published') }),
      }),
      NOW,
    );

    expect(open.canReportReply).toBe(true);
    expect(mine.canReportReply).toBe(false);
  });

  it('offers no report when a review has no reply', () => {
    const row = rowOf(
      source({ replyReportedByMe: true, review: written() }),
      NOW,
    );

    expect(row).toMatchObject({ canReportReply: false, reply: null });
  });

  it('serialises the reply dates as ISO strings', () => {
    const edited = new Date('2026-11-02T08:00:00.000Z');
    const row = rowOf(
      source({
        review: written({ reply: { ...reply('published'), editedAt: edited } }),
      }),
      NOW,
    );

    expect(row.reply?.editedAt).toBe(edited.toISOString());
    expect(row.reply?.postedAt).toBe(ago(DAY / 2).toISOString());
  });
});

// @traces 117-FR-004
describe('rowOf first line', () => {
  it.each([
    ['one\ntwo', 'one'],
    ['one\r\ntwo', 'one'],
    ['  padded  \nsecond', 'padded'],
    ['Mulțumesc 👍 mult\nal doilea', 'Mulțumesc 👍 mult'],
    ['single', 'single'],
  ])('reads %j as %j', (text, expected) => {
    const row = rowOf(source({ review: written({ text }) }), NOW);

    expect(row.firstLine).toBe(expected);
  });

  it('answers null for a review with no text', () => {
    const row = rowOf(source({ review: written({ text: null }) }), NOW);

    expect(row.firstLine).toBeNull();
  });

  it('keeps a very long single line whole', () => {
    const text = 'a'.repeat(100_000);
    const row = rowOf(source({ review: written({ text }) }), NOW);

    expect(row.firstLine).toBe(text);
  });
});

// @traces 117-FR-003
describe('rowOf date', () => {
  it('dates a row by its handover', () => {
    const row = rowOf(source({ review: written() }), NOW);

    expect(row.date).toBe(ago(DAY).toISOString());
  });

  it('dates a written row with no handover by its posting', () => {
    const posted = ago(50 * DAY);
    const row = rowOf(
      source({ handedOverAt: null, review: written({ postedAt: posted }) }),
      NOW,
    );

    expect(row).toMatchObject({
      date: posted.toISOString(),
      handedOverAt: null,
    });
  });
});
