import type {
  RequestDto,
  RequestListDto,
  RequestSummaryDto,
} from '@motor-fix/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type {
  Booking,
  Garage,
  GarageResponseStats,
  JobType,
  PrismaClient,
  QuoteRequest,
  RequestJob,
  RequestRecipient,
} from '../../generated/prisma/client';
import {
  answersSameDayOf,
  responseRateOf,
} from '../../insights/response-stats/response-stats';
import {
  assertCursor,
  bookingOf,
  declineShown,
  garageRef,
  iso,
  jobsOf,
  NEWEST_FIRST,
  PAGE_TAKE,
  page,
  quoteOf,
  snapshotOf,
} from '../reads';

const SUMMARY = {
  _count: { select: { quotes: true } },
  bookings: { orderBy: NEWEST_FIRST, take: 1 },
  jobs: { include: { jobType: true }, orderBy: { position: 'asc' as const } },
};

type SummaryRow = QuoteRequest & {
  _count: { quotes: number };
  bookings: Booking[];
  jobs: (RequestJob & { jobType: JobType })[];
};

const summaryOf = ({
  bookings: [booking],
  ...row
}: SummaryRow): RequestSummaryDto => ({
  booking: booking
    ? { confirmBy: booking.confirmBy.toISOString(), status: booking.status }
    : null,
  car: snapshotOf(row),
  closedAt: iso(row.closedAt),
  closedReason: row.closedReason,
  createdAt: row.createdAt.toISOString(),
  description: row.description,
  expiresAt: row.expiresAt.toISOString(),
  id: row.id,
  jobs: jobsOf(row.jobs),
  quotesCount: row._count.quotes,
  status: row.status,
});

// The driver's own requests. A garage is only its name and page; a decline
// shows with its reason once the garage's undo window has closed, and who
// declined stays the garage's business.
@Injectable()
export class RequestsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(actor: Actor, cursor?: string): Promise<RequestListDto> {
    requireCapability(actor, 'driver.requests');
    const where = { driverId: actor.accountId };
    const from = await assertCursor(cursor, (id) =>
      this.prisma.quoteRequest.findFirst({ where: { ...where, id } }),
    );
    const [rows, total] = await Promise.all([
      this.prisma.quoteRequest.findMany({
        include: SUMMARY,
        orderBy: NEWEST_FIRST,
        take: PAGE_TAKE,
        where,
        ...from,
      }),
      this.prisma.quoteRequest.count({ where }),
    ]);
    return page(rows, total, summaryOf);
  }

  async get(actor: Actor, id: string): Promise<RequestDto> {
    requireCapability(actor, 'driver.requests');
    const row = await this.prisma.quoteRequest.findFirst({
      include: {
        ...SUMMARY,
        bookings: {
          include: { garage: true },
          orderBy: NEWEST_FIRST,
          take: 1,
        },
        quotes: {
          include: { garage: true, jobs: true },
          orderBy: { sentAt: 'asc' },
        },
        recipients: {
          include: { garage: { include: { responseStats: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      where: { driverId: actor.accountId, id },
    });
    if (!row) throw new NotFoundException();
    const [booking] = row.bookings;
    const now = new Date();
    return {
      ...summaryOf(row),
      booking: booking ? bookingOf(booking) : null,
      quotes: row.quotes.map((quote) => ({
        ...quoteOf(quote),
        garage: garageRef(quote.garage),
      })),
      recipients: row.recipients.map((recipient) =>
        recipientOf(recipient, now),
      ),
    };
  }
}

// A decline the garage may still undo is not news yet: the driver sees the
// garage waiting until its window has closed, then the decline and its
// reason, never who declined.
function recipientOf(
  recipient: RequestRecipient & {
    garage: Garage & { responseStats: GarageResponseStats | null };
  },
  now: Date,
): RequestDto['recipients'][number] {
  const declined = declineShown(recipient, now);
  const hidden = recipient.status === 'declined' && !declined;
  return {
    answeredAt: hidden ? null : iso(recipient.answeredAt),
    answersSameDay: answersSameDayOf(
      responseRateOf(recipient.garage.responseStats),
    ),
    createdAt: recipient.createdAt.toISOString(),
    declineReason: declined ? recipient.declineReason : null,
    garage: garageRef(recipient.garage),
    id: recipient.id,
    status: hidden ? 'waiting' : recipient.status,
  };
}
