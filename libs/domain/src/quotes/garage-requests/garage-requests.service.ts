import type {
  GarageBookingDto,
  GarageRequestDto,
  GarageRequestListDto,
  GarageRequestSummaryDto,
} from '@motor-fix/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type {
  Account,
  Booking,
  JobType,
  PrismaClient,
  Quote,
  QuoteJob,
  QuoteRequest,
  RequestJob,
  RequestRecipient,
} from '../../generated/prisma/client';
import {
  assertCursor,
  iso,
  jobsOf,
  NEWEST_FIRST,
  PAGE_TAKE,
  page,
  plateOf,
  quoteOf,
  shortName,
  snapshotOf,
} from '../reads';

// Only this garage's own recipient row and quote ride along.
const summaryInclude = (garageId: string) => ({
  driver: true,
  jobs: { include: { jobType: true }, orderBy: { position: 'asc' as const } },
  quotes: { include: { jobs: true }, where: { garageId } },
  recipients: { where: { garageId } },
});

type SummaryRow = QuoteRequest & {
  driver: Account;
  jobs: (RequestJob & { jobType: JobType })[];
  quotes: (Quote & { jobs: QuoteJob[] })[];
  recipients: RequestRecipient[];
};

function summaryOf(row: SummaryRow): GarageRequestSummaryDto {
  const [recipient] = row.recipients;
  const [quote] = row.quotes;
  return {
    car: snapshotOf(row),
    createdAt: row.createdAt.toISOString(),
    driver: { shortName: shortName(row.driver.name) },
    expiresAt: row.expiresAt.toISOString(),
    id: row.id,
    jobs: jobsOf(row.jobs),
    quote: quote ? quoteOf(quote) : null,
    recipient: {
      answeredAt: iso(recipient.answeredAt),
      declinedAt: iso(recipient.declinedAt),
      declineReason: recipient.declineReason,
      source: recipient.source,
      status: recipient.status,
    },
    status: row.status,
  };
}

const bookingOf = (booking: Booking): GarageBookingDto => ({
  cancelledAt: iso(booking.cancelledAt),
  cancelledBySide: booking.cancelledBySide,
  cancelNote: booking.cancelNote,
  cancelReason: booking.cancelReason,
  completedAt: iso(booking.completedAt),
  confirmBy: booking.confirmBy.toISOString(),
  confirmedAt: iso(booking.confirmedAt),
  confirmedBy: booking.confirmedBy,
  createdAt: booking.createdAt.toISOString(),
  durationMinutes: booking.durationMinutes,
  historyShared: booking.historyShared,
  id: booking.id,
  lateCancellation: booking.lateCancellation,
  lift: booking.lift,
  mechanicId: booking.mechanicId,
  moveCount: booking.moveCount,
  noShowAt: iso(booking.noShowAt),
  quoteId: booking.quoteId,
  startsAt: booking.startsAt.toISOString(),
  status: booking.status,
});

type InboxStatus = 'waiting' | 'quoted' | 'declined' | 'accepted';

interface InboxQuery {
  cursor?: string;
  status?: InboxStatus;
}

// A row of the assistant's inbox: the dashboard's row, the driver's own words,
// and which asked jobs the garage does not list for the car's brand.
type InboxItem = Omit<GarageRequestSummaryDto, 'jobs'> & {
  description: string | null;
  jobs: (GarageRequestSummaryDto['jobs'][number] & { notOffered: boolean })[];
};

interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  total: number;
}

// `accepted` is a quoted recipient whose quote the driver took.
function statusWhere(garageId: string, status?: InboxStatus) {
  if (!status) return {};
  if (status === 'accepted')
    return { quotes: { some: { garageId, status: 'accepted' as const } } };
  return { recipients: { some: { garageId, status } } };
}

// The requests sent to the actor's garage. The driver is a short name until
// the garage's quote is accepted (then the desk may call them), and the car
// has no plate until the booking is confirmed.
@Injectable()
export class GarageRequestsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(actor: Actor, query: InboxQuery): Promise<GarageRequestListDto> {
    const { rows, total } = await this.rows(actor, query);
    return page(rows, total, summaryOf);
  }

  async inbox(actor: Actor, query: InboxQuery): Promise<InboxPage> {
    const { garageId, rows, total } = await this.rows(actor, query);
    const offered = await this.prisma.garageBrandJob.findMany({
      select: { brandId: true, jobTypeId: true },
      where: { garageId },
    });
    const has = new Set(offered.map((o) => `${o.brandId}/${o.jobTypeId}`));
    return page(rows, total, (row) => {
      const summary = summaryOf(row);
      return {
        ...summary,
        description: row.description,
        jobs: summary.jobs.map((job) => ({
          ...job,
          notOffered: !has.has(`${row.car.brandId}/${job.jobTypeId}`),
        })),
      };
    });
  }

  private async rows(actor: Actor, query: InboxQuery) {
    const garageId = this.garageOf(actor);
    const where = {
      recipients: { some: { garageId } },
      ...statusWhere(garageId, query.status),
    };
    const from = await assertCursor(query.cursor, (id) =>
      this.prisma.quoteRequest.findFirst({ where: { ...where, id } }),
    );
    const [rows, total] = await Promise.all([
      this.prisma.quoteRequest.findMany({
        include: {
          ...summaryInclude(garageId),
          car: { select: { brandId: true } },
        },
        orderBy: NEWEST_FIRST,
        take: PAGE_TAKE,
        where,
        ...from,
      }),
      this.prisma.quoteRequest.count({ where }),
    ]);
    return { garageId, rows, total };
  }

  async get(actor: Actor, id: string): Promise<GarageRequestDto> {
    const garageId = this.garageOf(actor);
    const row = await this.prisma.quoteRequest.findFirst({
      include: {
        ...summaryInclude(garageId),
        bookings: {
          include: { mechanic: { select: { accountId: true } } },
          orderBy: NEWEST_FIRST,
          take: 1,
          where: { garageId },
        },
        car: { select: { plate: true } },
      },
      where: { id, recipients: { some: { garageId } } },
    });
    if (!row) throw new NotFoundException();
    const summary = summaryOf(row);
    const [booking] = row.bookings;
    // The plate shows from confirmation on, as it does on the job, even once
    // the booking is cancelled; a mechanic sees it only on their own booking.
    const plateShown =
      booking?.confirmedAt != null &&
      (actor.role !== 'mechanic' ||
        booking.mechanic?.accountId === actor.accountId);
    const phone =
      summary.quote?.status === 'accepted' &&
      actor.role !== 'mechanic' &&
      row.driver.phone;
    return {
      ...summary,
      booking: booking ? bookingOf(booking) : null,
      car: {
        ...summary.car,
        ...plateOf(row.car.plate, plateShown),
      },
      description: row.description,
      driver: { ...summary.driver, ...(phone && { phone }) },
    };
  }

  private garageOf(actor: Actor) {
    requireCapability(actor, 'garage.requests');
    if (!actor.garageId) throw new NotFoundException();
    return actor.garageId;
  }
}
