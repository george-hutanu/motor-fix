// @traces 026-FR-001 026-FR-002 026-FR-003 026-FR-004 026-FR-007
import type { ReviewRefusal } from '@motor-fix/contracts';

import { reviewsOf } from './history';
import type { Actor } from '../../auth/policy';

const actor = { accountId: 'andrei' } as Actor;
const review = { id: 'r1', rating: 4, status: 'published' };
const verdict = (
  jobId: string,
  reason: ReviewRefusal | null,
  withReview: { id: string; rating: number } | null = null,
) => ({ jobId, reason, review: withReview });

describe('the reviews of a page when the eligibility answers oddly', () => {
  it('never hands a previous owner their review back on a job that is not found', async () => {
    const judge = vi
      .fn()
      .mockResolvedValue([verdict('a', 'not_found', review)]);

    const reviews = await reviewsOf({ judge }, actor, [{ jobId: 'a' }]);

    expect(reviews.get('a')).toEqual({
      jobId: 'a',
      rating: null,
      reviewId: null,
      state: 'none',
    });
  });

  it.each(['job_not_done', 'own_garage'] as const)(
    'drops a review the verdict carries beside %s',
    async (reason) => {
      const judge = vi.fn().mockResolvedValue([verdict('a', reason, review)]);

      const reviews = await reviewsOf({ judge }, actor, [{ jobId: 'a' }]);

      expect(reviews.get('a')).toEqual({
        jobId: 'a',
        rating: null,
        reviewId: null,
        state: 'none',
      });
    },
  );

  it.each([null, 'email_not_confirmed'] as const)(
    'offers writing with no id or rating when a review rides along with reason %s',
    async (reason) => {
      const judge = vi.fn().mockResolvedValue([verdict('a', reason, review)]);

      const reviews = await reviewsOf({ judge }, actor, [{ jobId: 'a' }]);

      expect(reviews.get('a')).toEqual({
        jobId: 'a',
        rating: null,
        reviewId: null,
        state: 'can_write',
      });
    },
  );

  it('never leaks the rating of a removed review', async () => {
    const judge = vi
      .fn()
      .mockResolvedValue([
        verdict('a', 'review_removed', { id: 'r9', rating: 1 }),
      ]);

    const reviews = await reviewsOf({ judge }, actor, [{ jobId: 'a' }]);

    expect(JSON.stringify(reviews.get('a'))).not.toContain('"rating":1');
    expect(reviews.get('a')?.rating).toBeNull();
  });

  it('answers written with null rating and id when the verdict lost its review', async () => {
    const judge = vi
      .fn()
      .mockResolvedValue([verdict('a', 'already_reviewed', null)]);

    const reviews = await reviewsOf({ judge }, actor, [{ jobId: 'a' }]);

    expect(reviews.get('a')).toEqual({
      jobId: 'a',
      rating: null,
      reviewId: null,
      state: 'written',
    });
  });

  it('answers none for a job the eligibility returned no verdict for', async () => {
    const judge = vi.fn().mockResolvedValue([verdict('a', null)]);

    const reviews = await reviewsOf({ judge }, actor, [
      { jobId: 'a' },
      { jobId: 'b' },
    ]);

    expect(reviews.get('b')).toEqual({
      jobId: 'b',
      rating: null,
      reviewId: null,
      state: 'none',
    });
  });

  it('keeps no entry for a job the page never asked about', async () => {
    const judge = vi
      .fn()
      .mockResolvedValue([verdict('a', null), verdict('zzz', null)]);

    const reviews = await reviewsOf({ judge }, actor, [{ jobId: 'a' }]);

    expect([...reviews.keys()]).toEqual(['a']);
  });

  it('lets a failing eligibility fail the read instead of answering a state', async () => {
    const judge = vi.fn().mockRejectedValue(new Error('store down'));

    await expect(reviewsOf({ judge }, actor, [{ jobId: 'a' }])).rejects.toThrow(
      'store down',
    );
  });
});

describe('the reviews of a page at its extremes', () => {
  it('judges nothing for an empty page', async () => {
    const judge = vi.fn();

    const reviews = await reviewsOf({ judge }, actor, []);

    expect(judge).not.toHaveBeenCalled();
    expect(reviews.size).toBe(0);
  });

  it('judges a single repair once with its id', async () => {
    const judge = vi.fn().mockResolvedValue([verdict('only', null)]);

    await reviewsOf({ judge }, actor, [{ jobId: 'only' }]);

    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledWith(actor, ['only']);
  });

  it('judges ten thousand repairs in one call', async () => {
    const repairs = Array.from({ length: 10_000 }, (_, i) => ({
      jobId: `job-${i}`,
    }));
    const judge = vi
      .fn()
      .mockImplementation(async (_a: Actor, ids: string[]) =>
        ids.map((id) => verdict(id, null)),
      );

    const reviews = await reviewsOf({ judge }, actor, repairs);

    expect(judge).toHaveBeenCalledTimes(1);
    expect(reviews.size).toBe(10_000);
  });

  it('judges the same job once however many rows name it', async () => {
    const judge = vi.fn().mockResolvedValue([verdict('a', null)]);

    await reviewsOf({ judge }, actor, [
      { jobId: 'a' },
      { jobId: 'a' },
      { jobId: 'a' },
    ]);

    expect(judge).toHaveBeenCalledWith(actor, ['a']);
  });

  it('answers the same on a second call with the same input', async () => {
    const judge = vi
      .fn()
      .mockResolvedValue([verdict('a', 'already_reviewed', review)]);
    const repairs = [{ jobId: 'a' }];

    const first = await reviewsOf({ judge }, actor, repairs);
    const second = await reviewsOf({ judge }, actor, repairs);

    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
  });

  it('leaves the rows it was given untouched', async () => {
    const judge = vi.fn().mockResolvedValue([]);
    const repairs = [{ jobId: 'b' }, { jobId: null }, { jobId: 'a' }];

    await reviewsOf({ judge }, actor, repairs);

    expect(repairs).toEqual([{ jobId: 'b' }, { jobId: null }, { jobId: 'a' }]);
  });

  it('matches verdicts to jobs by id when the eligibility answers in another order', async () => {
    const judge = vi
      .fn()
      .mockResolvedValue([
        verdict('b', 'review_removed', { id: 'rb', rating: 2 }),
        verdict('a', 'already_reviewed', { id: 'ra', rating: 5 }),
      ]);

    const reviews = await reviewsOf({ judge }, actor, [
      { jobId: 'a' },
      { jobId: 'b' },
    ]);

    expect(reviews.get('a')).toEqual({
      jobId: 'a',
      rating: 5,
      reviewId: 'ra',
      state: 'written',
    });
    expect(reviews.get('b')?.state).toBe('removed');
  });
});
