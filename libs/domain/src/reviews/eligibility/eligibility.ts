import type { ReviewEligibilityDto, ReviewRefusal } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { Job, PrismaClient } from '../../generated/prisma/client';

// The statuses that hold a job's one review; the migration's review_one_live
// index lists the same three.
export const LIVE = ['published', 'reported', 'removed'] as const;

type EligibilityFacts = {
  job: { status: string } | null;
  staff: boolean;
  // The job's live review (a status in LIVE), if any.
  review: { status: string } | null;
  emailConfirmed: boolean;
};

// The first reason that applies, in the order the publish answers them. The
// platform rule for reviews never enters: on a job it changes nothing.
export function reasonOf(facts: EligibilityFacts): ReviewRefusal | null {
  if (!facts.job) return 'not_found';
  if (facts.job.status !== 'done') return 'job_not_done';
  if (facts.staff) return 'own_garage';
  if (facts.review?.status === 'removed') return 'review_removed';
  if (facts.review) return 'already_reviewed';
  if (!facts.emailConfirmed) return 'email_not_confirmed';
  return null;
}

export const offerOf = (reason: ReviewRefusal | null) =>
  reason === null || reason === 'email_not_confirmed';

export type Verdict = ReviewEligibilityDto & {
  job: Job | null;
  // The job's status for job_not_done, the review's for a review refusal.
  currentStatus?: string;
};

// Whether the signed-in driver may review each job: one read of the jobs,
// their live reviews and the caller's account with its staff rows, whatever
// the number of ids.
@Injectable()
export class ReviewEligibility {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async judge(actor: Actor, jobIds: string[]): Promise<Verdict[]> {
    const [jobs, reviews, account] = await Promise.all([
      this.prisma.job.findMany({
        where: { driverId: actor.accountId, id: { in: jobIds } },
      }),
      this.prisma.review.findMany({
        select: { jobId: true, status: true },
        where: { jobId: { in: jobIds }, status: { in: [...LIVE] } },
      }),
      this.prisma.account.findUnique({
        select: {
          email: true,
          emailVerifiedAt: true,
          mechanic: { select: { garageId: true } },
          memberships: { select: { garageId: true } },
        },
        where: { id: actor.accountId },
      }),
    ]);
    const staffAt = new Set([
      ...(account?.memberships.map((m) => m.garageId) ?? []),
      ...(account?.mechanic ? [account.mechanic.garageId] : []),
    ]);
    const emailConfirmed = Boolean(account?.email && account.emailVerifiedAt);
    return jobIds.map((jobId) => {
      const job = jobs.find((one) => one.id === jobId) ?? null;
      const review = reviews.find((one) => one.jobId === jobId) ?? null;
      const reason = reasonOf({
        emailConfirmed,
        job,
        review,
        staff: job !== null && staffAt.has(job.garageId),
      });
      return {
        currentStatus: reason === 'job_not_done' ? job?.status : review?.status,
        job,
        jobId,
        offer: offerOf(reason),
        reason,
      };
    });
  }
}

const MESSAGES: Record<
  Exclude<ReviewRefusal, 'not_found'>,
  { en: string; ro: string }
> = {
  already_reviewed: {
    en: 'This job already has your review',
    ro: 'Lucrarea are deja recenzia ta',
  },
  email_not_confirmed: {
    en: 'Confirm your e-mail address to publish a review',
    ro: 'Confirmă-ți adresa de e-mail ca să publici recenzia',
  },
  job_not_done: {
    en: 'A job is reviewed once it is done',
    ro: 'O lucrare se evaluează după ce e gata',
  },
  own_garage: {
    en: 'You cannot review your own garage.',
    ro: 'Nu poți scrie o recenzie pentru propriul service.',
  },
  review_removed: {
    en: 'MotorFix removed your review; you can only appeal the decision.',
    ro: 'Recenzia ta a fost ștearsă de MotorFix; poți doar contesta decizia.',
  },
};

// The answer the publish gives for a refused verdict, in the caller's
// language.
export function refusalOf(
  verdict: Verdict & { reason: ReviewRefusal },
  language: Actor['language'],
): HttpException {
  const { reason, currentStatus } = verdict;
  if (reason === 'not_found') return new NotFoundException();
  const message = MESSAGES[reason][language === 'en' ? 'en' : 'ro'];
  if (reason === 'own_garage') {
    return new HttpException({ code: reason, message }, HttpStatus.FORBIDDEN);
  }
  const entity =
    reason === 'job_not_done'
      ? { currentStatus, entity: 'job' }
      : reason === 'email_not_confirmed'
        ? {}
        : { currentStatus, entity: 'review' };
  return new HttpException(
    { code: reason, message, ...entity },
    HttpStatus.CONFLICT,
  );
}
