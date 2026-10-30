// @traces 061-FR-005
// @traces 061-FR-007
// @traces 061-FR-008
import { jobNames, reviewState } from './history';

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

describe('where the review of a MotorFix repair stands', () => {
  const doneOn = new Date('2026-10-03T00:00:00Z');

  it.each([
    ['2026-10-13', 'write'],
    ['2026-12-02', 'write'],
    ['2026-12-03', 'none'],
  ] as const)('with no review, read on %s, answers %s', (today, state) => {
    expect(reviewState(null, doneOn, today)).toEqual({ state });
  });

  it.each(['published', 'reported'] as const)(
    'answers the score of a %s review, whatever the day',
    (status) => {
      expect(reviewState({ rating: 5, status }, doneOn, '2026-10-13')).toEqual({
        rating: 5,
        state: 'rated',
      });
      expect(reviewState({ rating: 4, status }, doneOn, '2027-03-01')).toEqual({
        rating: 4,
        state: 'rated',
      });
    },
  );

  it('answers none for a review an admin removed, even on day 10, and never its score', () => {
    expect(
      reviewState({ rating: 1, status: 'removed' }, doneOn, '2026-10-13'),
    ).toEqual({ state: 'none' });
  });

  it('lets the author write again after deleting a review, until day 60', () => {
    const deleted = { rating: 3, status: 'deleted_by_author' } as const;
    expect(reviewState(deleted, doneOn, '2026-11-02')).toEqual({
      state: 'write',
    });
    expect(reviewState(deleted, doneOn, '2026-12-02')).toEqual({
      state: 'write',
    });
    expect(reviewState(deleted, doneOn, '2026-12-03')).toEqual({
      state: 'none',
    });
  });
});
