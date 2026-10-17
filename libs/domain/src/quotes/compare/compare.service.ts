import type {
  CompareQuoteDto,
  QuoteComparisonDto,
  WithdrawnQuoteDto,
} from '@motor-fix/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type {
  Garage,
  JobType,
  PrismaClient,
  Quote,
  QuoteJob,
  RequestJob,
} from '../../generated/prisma/client';
import {
  declineShown,
  firstLine,
  garageRef,
  iso,
  jobsOf,
  NEWEST_FIRST,
  shownStatus,
  snapshotOf,
} from '../reads';

type QuoteRow = Quote & {
  garage: Garage;
  jobs: (QuoteJob & { requestJob: RequestJob & { jobType: JobType } })[];
};

const rowOf = (quote: QuoteRow): CompareQuoteDto => ({
  changedAt: iso(quote.changedAt),
  durationMinutes: quote.durationMinutes,
  expiresAt: quote.expiresAt.toISOString(),
  fromBani: quote.fromBani,
  garage: {
    ...garageRef(quote.garage),
    area: quote.garage.cityName,
    mobile: quote.garage.businessKind === 'mobile',
    rating: quote.garage.rating?.toNumber() ?? null,
    reviewCount: quote.garage.reviewCount,
  },
  id: quote.id,
  jobs: quote.jobs
    .toSorted((a, b) => a.requestJob.position - b.requestJob.position)
    .map((job) => ({
      included: job.included,
      nameEn: job.requestJob.jobType.nameEn,
      nameRo: job.requestJob.jobType.nameRo,
      requestJobId: job.requestJobId,
    })),
  note: quote.note,
  sentAt: quote.sentAt.toISOString(),
  slot: quote.slot.toISOString(),
  status: quote.status as CompareQuoteDto['status'],
  toBani: quote.toBani,
});

// The driver's side-by-side read of one request's quotes. A withdrawn quote,
// or a waiting one of a suspended garage, is a line rather than a row; a
// decline shows once the garage's undo window has closed. The first read of
// a row stamps when the driver first saw it, and nothing else is written.
@Injectable()
export class CompareService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async get(actor: Actor, id: string): Promise<QuoteComparisonDto> {
    requireCapability(actor, 'driver.requests');
    const row = await this.prisma.quoteRequest.findFirst({
      include: {
        bookings: { orderBy: NEWEST_FIRST, take: 1 },
        jobs: {
          include: { jobType: true },
          orderBy: { position: 'asc' },
        },
        quotes: {
          include: {
            garage: true,
            jobs: { include: { requestJob: { include: { jobType: true } } } },
          },
          orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        },
        recipients: {
          include: { garage: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      where: { driverId: actor.accountId, id },
    });
    if (!row) throw new NotFoundException();
    const now = new Date();
    const quotes: CompareQuoteDto[] = [];
    const withdrawn: WithdrawnQuoteDto[] = [];
    for (const quote of row.quotes) {
      if (shownStatus(quote) !== 'withdrawn') quotes.push(rowOf(quote));
      else
        withdrawn.push({
          garageName: quote.garage.name,
          reason: quote.status === 'withdrawn' ? 'garage' : 'suspended',
        });
    }
    if (quotes.length > 0)
      await this.prisma.quote.updateMany({
        data: { firstSeenAt: now },
        where: { firstSeenAt: null, id: { in: quotes.map((q) => q.id) } },
      });
    const [booking] = row.bookings;
    return {
      declined: row.recipients.flatMap((recipient) =>
        declineShown(recipient, now) && recipient.declineReason
          ? [
              {
                declineReason: recipient.declineReason,
                garageName: recipient.garage.name,
              },
            ]
          : [],
      ),
      quotes,
      request: {
        booking: booking
          ? {
              confirmBy: booking.confirmBy.toISOString(),
              status: booking.status,
            }
          : null,
        car: snapshotOf(row),
        description: firstLine(row.description),
        id: row.id,
        jobs: jobsOf(row.jobs),
        status: row.status,
      },
      waiting: row.recipients
        .filter(
          (recipient) =>
            recipient.status === 'waiting' ||
            (recipient.status === 'declined' && !declineShown(recipient, now)),
        )
        .map((recipient) => recipient.garage.name),
      withdrawn,
    };
  }
}
