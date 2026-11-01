// @traces 061-FR-005
// @traces 061-FR-008
import type { ReviewRefusal } from '@motor-fix/contracts';

import { jobNames, reviewStateOf, reviewsOf } from './history';
import type { Actor } from '../../auth/policy';

const quoted = (position: number, nameRo: string, nameEn: string) => ({
  requestJob: { jobType: { nameEn, nameRo }, position },
});

describe('the jobs a MotorFix repair names', () => {
  const jobs = [
    quoted(2, 'Discuri față', 'Front discs'),
    quoted(1, 'Plăcuțe față', 'Front pads'),
  ];

  it('joins them in Romanian by their asked order', () => {
    expect(jobNames(jobs, 'ro')).toBe('Plăcuțe față, Discuri față');
  });

  it('joins them in English for an English reader', () => {
    expect(jobNames(jobs, 'en')).toBe('Front pads, Front discs');
  });

  it('answers nothing when no quoted job is left, so the stored text is read', () => {
    expect(jobNames([], 'en')).toBe('');
  });
});

// @traces 026-FR-002 026-FR-003 026-FR-005 026-FR-008
describe('the review state of a MotorFix repair', () => {
  it.each([
    [null, 'can_write'],
    ['email_not_confirmed', 'can_write'],
    ['already_reviewed', 'written'],
    ['review_removed', 'removed'],
    ['job_not_done', 'none'],
    ['own_garage', 'none'],
    ['not_found', 'none'],
  ] as const)('answers %s with %s', (reason, state) => {
    expect(reviewStateOf(reason)).toBe(state);
  });

  it('reaches expired from no reason the eligibility gives today', () => {
    const reasons = [
      null,
      'not_found',
      'job_not_done',
      'own_garage',
      'already_reviewed',
      'review_removed',
      'email_not_confirmed',
    ] as const;

    expect(reasons.map(reviewStateOf)).not.toContain('expired');
  });
});

// @traces 026-FR-002 026-FR-003 026-FR-004
describe('the reviews of a page of repairs', () => {
  const actor = { accountId: 'andrei' } as Actor;
  const verdict = (
    jobId: string,
    reason: ReviewRefusal | null,
    review: { id: string; rating: number; status: string } | null = null,
  ) => ({ job: null, jobId, offer: reason === null, reason, review });

  it('judges nothing for a page with no MotorFix repair', async () => {
    const judge = vi.fn();

    const reviews = await reviewsOf({ judge }, actor, [
      { jobId: null },
      { jobId: null },
    ]);

    expect(judge).not.toHaveBeenCalled();
    expect(reviews.size).toBe(0);
  });

  it('judges the page once, each job once, in the order first met', async () => {
    const judge = vi.fn().mockResolvedValue([]);

    await reviewsOf({ judge }, actor, [
      { jobId: 'b' },
      { jobId: null },
      { jobId: 'a' },
      { jobId: 'b' },
    ]);

    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledWith(actor, ['b', 'a']);
  });

  it('carries the rating and the id of a standing review, the id alone of a removed one', async () => {
    const judge = vi.fn().mockResolvedValue([
      verdict('a', 'already_reviewed', {
        id: 'r1',
        rating: 5,
        status: 'published',
      }),
      verdict('b', 'review_removed', {
        id: 'r2',
        rating: 1,
        status: 'removed',
      }),
      verdict('c', null),
      verdict('d', 'not_found'),
    ]);

    const reviews = await reviewsOf({ judge }, actor, [
      { jobId: 'a' },
      { jobId: 'b' },
      { jobId: 'c' },
      { jobId: 'd' },
    ]);

    expect(Object.fromEntries(reviews)).toEqual({
      a: { jobId: 'a', rating: 5, reviewId: 'r1', state: 'written' },
      b: { jobId: 'b', rating: null, reviewId: 'r2', state: 'removed' },
      c: { jobId: 'c', rating: null, reviewId: null, state: 'can_write' },
      d: { jobId: 'd', rating: null, reviewId: null, state: 'none' },
    });
  });
});
