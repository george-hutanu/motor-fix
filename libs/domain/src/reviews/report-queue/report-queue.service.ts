import {
  DELETED_AUTHOR,
  REVIEW_REPORT_QUEUE_PAGE,
  type ReportQueueDto,
  type ReportQueueFactsDto,
  type ReportQueueItemDto,
} from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { countReportQueue } from './report-queue';
import { PRISMA } from '../../auth/prisma';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { shortName } from '../../quotes/reads';

export type QueueLanguage = 'ro' | 'en';

// What an item reads of its report: the review, its author's name, status
// and age, the garage, the reply, and the job the review is about. Never an
// e-mail, phone, plate or account id.
const ITEM_INCLUDE = {
  review: {
    select: {
      driver: { select: { createdAt: true, name: true, status: true } },
      driverId: true,
      garage: { select: { id: true, name: true } },
      id: true,
      job: {
        select: {
          booking: {
            select: {
              quote: {
                select: {
                  jobs: {
                    orderBy: { requestJob: { position: 'asc' } },
                    select: {
                      requestJob: {
                        select: {
                          jobType: { select: { nameEn: true, nameRo: true } },
                        },
                      },
                    },
                    where: { included: true },
                  },
                },
              },
              request: { select: { carBrand: true, carModel: true } },
            },
          },
          handedOverAt: true,
        },
      },
      postedAt: true,
      rating: true,
      reply: {
        select: { editedAt: true, id: true, postedAt: true, text: true },
      },
      source: true,
      text: true,
    },
  },
} satisfies Prisma.ReviewReportInclude;

type Reported = Prisma.ReviewReportGetPayload<{
  include: typeof ITEM_INCLUDE;
}>;

type Review = Reported['review'];

const deleted = (review: Review) => review.driver.status === 'deleted';

const jobFact = (
  review: Review,
  language: QueueLanguage,
): ReportQueueFactsDto['job'] => {
  if (review.source !== 'job') return { kind: 'none' };
  const { booking, handedOverAt } = review.job;
  const name = language === 'en' ? 'nameEn' : 'nameRo';
  return {
    car: `${booking.request.carBrand} ${booking.request.carModel}`,
    handedOverAt: handedOverAt?.toISOString() ?? null,
    kind: 'confirmed',
    work: booking.quote.jobs
      .map((one) => one.requestJob.jobType[name])
      .join(' · '),
  };
};

const accountFact = (review: Review): ReportQueueFactsDto['account'] =>
  deleted(review)
    ? { deleted: true }
    : { createdAt: review.driver.createdAt.toISOString(), deleted: false };

// The admins' queue of pending review reports with the facts that help
// decide each one, all computed when the queue is read.
@Injectable()
export class ReportQueueService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  counts(now = new Date()) {
    return countReportQueue(this.prisma, now);
  }

  async read(
    { language, page }: { language: QueueLanguage; page: number },
    now = new Date(),
  ): Promise<ReportQueueDto> {
    const [counts, reports] = await Promise.all([
      this.counts(now),
      this.prisma.reviewReport.findMany({
        include: ITEM_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * REVIEW_REPORT_QUEUE_PAGE,
        take: REVIEW_REPORT_QUEUE_PAGE,
        where: { status: 'pending' },
      }),
    ]);
    const [identical, history] = await Promise.all([
      this.identical(reports),
      this.history(reports),
    ]);
    return {
      items: reports.map((report) => ({
        ...this.itemOf(report, now),
        facts: {
          account: accountFact(report.review),
          garageReports: history(report),
          identicalReviews: identical(report.review),
          job: jobFact(report.review, language),
        },
      })),
      oldestCreatedAt: counts.oldestCreatedAt?.toISOString() ?? null,
      overdue: counts.overdue,
      page,
      pageSize: REVIEW_REPORT_QUEUE_PAGE,
      total: counts.pending,
    };
  }

  private itemOf(
    report: Reported,
    now: Date,
  ): Omit<ReportQueueItemDto, 'facts'> {
    const { review } = report;
    return {
      garage: review.garage,
      report: {
        createdAt: report.createdAt.toISOString(),
        dueAt: report.dueAt.toISOString(),
        id: report.id,
        overdue: report.dueAt <= now,
        reason: report.reason,
        source: report.source,
        target: report.target,
        ...(report.reason === 'other' && { text: report.text }),
      },
      review: {
        author: deleted(review)
          ? DELETED_AUTHOR
          : shortName(review.driver.name),
        id: review.id,
        postedAt: review.postedAt.toISOString(),
        score: review.rating,
        source: review.source,
        text: review.text,
      },
      ...(report.target === 'reply' &&
        review.reply && {
          reply: {
            editedAt: review.reply.editedAt?.toISOString() ?? null,
            id: review.reply.id,
            postedAt: review.reply.postedAt.toISOString(),
            postedBy: review.garage.name,
            text: review.reply.text,
          },
        }),
    };
  }

  // The author's other reviews, at any garage and in any status but deleted
  // by the author, whose trimmed text is the same, letter for letter. One
  // query for the whole page.
  private async identical(reports: Reported[]) {
    const authors = [
      ...new Set(
        reports
          .filter(({ review }) => review.text?.trim() && !deleted(review))
          .map(({ review }) => review.driverId),
      ),
    ];
    const theirs = authors.length
      ? await this.prisma.review.findMany({
          select: { driverId: true, id: true, text: true },
          where: {
            driverId: { in: authors },
            status: { not: 'deleted_by_author' },
            text: { not: null },
          },
        })
      : [];
    return (review: Review) => {
      const text = review.text?.trim();
      if (!text || deleted(review)) return 0;
      return theirs.filter(
        (one) =>
          one.driverId === review.driverId &&
          one.id !== review.id &&
          one.text?.trim() === text,
      ).length;
    };
  }

  // Each garage's own reports on its reviews made before this report, any
  // status, and how many of them an admin kept. One query for the page.
  private async history(reports: Reported[]) {
    const garages = [...new Set(reports.map(({ review }) => review.garage.id))];
    const latest = reports.at(-1)?.createdAt;
    const earlier =
      garages.length && latest
        ? await this.prisma.reviewReport.findMany({
            select: {
              createdAt: true,
              decision: true,
              review: { select: { garageId: true } },
            },
            where: {
              createdAt: { lt: latest },
              review: { garageId: { in: garages } },
              source: 'garage',
            },
          })
        : [];
    return (report: Reported) => {
      const before = earlier.filter(
        (one) =>
          one.review.garageId === report.review.garage.id &&
          one.createdAt < report.createdAt,
      );
      return {
        earlier: before.length,
        kept: before.filter((one) => one.decision === 'kept').length,
      };
    };
  }
}
