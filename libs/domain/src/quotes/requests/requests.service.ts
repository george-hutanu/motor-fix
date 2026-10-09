import type {
  BookingDto,
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
  JobType,
  PrismaClient,
  QuoteRequest,
  RequestJob,
} from '../../generated/prisma/client';
import {
  assertCursor,
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
  jobs: { include: { jobType: true }, orderBy: { position: 'asc' as const } },
};

type SummaryRow = QuoteRequest & {
  _count: { quotes: number };
  jobs: (RequestJob & { jobType: JobType })[];
};

const summaryOf = (row: SummaryRow): RequestSummaryDto => ({
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

const bookingOf = (booking: Booking & { garage: Garage }): BookingDto => ({
  cancelledAt: iso(booking.cancelledAt),
  cancelledBySide: booking.cancelledBySide,
  cancelReason: booking.cancelReason,
  completedAt: iso(booking.completedAt),
  confirmBy: booking.confirmBy.toISOString(),
  confirmedAt: iso(booking.confirmedAt),
  createdAt: booking.createdAt.toISOString(),
  durationMinutes: booking.durationMinutes,
  garage: garageRef(booking.garage),
  id: booking.id,
  noShowAt: iso(booking.noShowAt),
  quoteId: booking.quoteId,
  startsAt: booking.startsAt.toISOString(),
  status: booking.status,
});

// The driver's own requests. A garage is only its name and page; how a
// garage declined and who did it are the garage's business.
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
          include: { garage: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      where: { driverId: actor.accountId, id },
    });
    if (!row) throw new NotFoundException();
    const [booking] = row.bookings;
    return {
      ...summaryOf(row),
      booking: booking ? bookingOf(booking) : null,
      quotes: row.quotes.map((quote) => ({
        ...quoteOf(quote),
        garage: garageRef(quote.garage),
      })),
      recipients: row.recipients.map((recipient) => ({
        answeredAt: iso(recipient.answeredAt),
        createdAt: recipient.createdAt.toISOString(),
        garage: garageRef(recipient.garage),
        id: recipient.id,
        status: recipient.status,
      })),
    };
  }
}
