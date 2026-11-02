import { ReviewEligibility, reasonOf } from './eligibility';
import type { Actor } from '../../auth/policy';
import type { PrismaClient } from '../../generated/prisma/client';

const allowed = {
  emailConfirmed: true,
  job: { status: 'done' },
  review: null,
  staff: false,
} as const;

// @traces 023-FR-001 023-FR-002
// @traces 023-FR-008
// @traces 023-FR-009
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

  it('does not count a review its author deleted', () => {
    expect(
      reasonOf({ ...allowed, review: { status: 'deleted_by_author' } }),
    ).toBeNull();
  });

  // One job per reason, judged through the eligibility with its reads stubbed.
  const judged = async (emailVerifiedAt: Date | null = new Date()) => {
    const job = (id: string, status: string, garageId = 'g1') => ({
      garageId,
      id,
      status,
    });
    const prisma = {
      account: {
        findUnique: vi.fn().mockResolvedValue({
          email: 'a@b.ro',
          emailVerifiedAt,
          mechanic: null,
          memberships: [{ garageId: 'own' }],
        }),
      },
      job: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            job('free', 'done'),
            job('open', 'in_work'),
            job('staff', 'done', 'own'),
            job('reviewed', 'done'),
            job('removed', 'done'),
          ]),
      },
      review: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', jobId: 'reviewed', rating: 5, status: 'published' },
          { id: 'r2', jobId: 'removed', rating: 1, status: 'removed' },
        ]),
      },
    } as unknown as PrismaClient;
    const verdicts = await new ReviewEligibility(prisma).judge(
      { accountId: 'andrei' } as Actor,
      ['free', 'missing', 'open', 'staff', 'reviewed', 'removed'],
    );
    return verdicts.map(({ offer, reason }) => [reason, offer]);
  };

  it('offers the button only to a reviewable job', async () => {
    expect(await judged()).toEqual([
      [null, true],
      ['not_found', false],
      ['job_not_done', false],
      ['own_garage', false],
      ['already_reviewed', false],
      ['review_removed', false],
    ]);
  });

  it('still offers the button to a driver whose e-mail is unconfirmed', async () => {
    expect((await judged(null))[0]).toEqual(['email_not_confirmed', true]);
  });
});
