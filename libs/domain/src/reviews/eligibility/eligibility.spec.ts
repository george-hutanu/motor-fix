import { offerOf, reasonOf } from './eligibility';

const allowed = {
  emailConfirmed: true,
  job: { status: 'done' },
  review: null,
  staff: false,
} as const;

// @traces 023-FR-001 023-FR-002
// @traces 023-FR-008 023-FR-009
// @traces 023-FR-013
describe('whether a driver may review a job', () => {
  it('allows a done job of a confirmed driver who is not staff and has no review', () => {
    expect(reasonOf(allowed)).toBeNull();
  });

  it.each([
    [{ ...allowed, job: null }, 'not_found'],
    [{ ...allowed, job: { status: 'in_work' }, staff: true }, 'job_not_done'],
    [
      { ...allowed, review: { status: 'published' }, staff: true },
      'own_garage',
    ],
    [
      { ...allowed, emailConfirmed: false, review: { status: 'reported' } },
      'already_reviewed',
    ],
    [
      { ...allowed, emailConfirmed: false, review: { status: 'removed' } },
      'review_removed',
    ],
    [{ ...allowed, emailConfirmed: false }, 'email_not_confirmed'],
  ] as const)(
    'answers the first reason that applies: %p is %s',
    (facts, reason) => {
      expect(reasonOf(facts)).toBe(reason);
    },
  );

  it('lets a review the author deleted pass', () => {
    expect(
      reasonOf({ ...allowed, review: { status: 'deleted_by_author' } }),
    ).toBeNull();
  });

  it.each([
    [null, true],
    ['email_not_confirmed', true],
    ['not_found', false],
    ['job_not_done', false],
    ['own_garage', false],
    ['already_reviewed', false],
    ['review_removed', false],
  ] as const)('offers the button for %p: %p', (reason, offer) => {
    expect(offerOf(reason)).toBe(offer);
  });
});
