import type {
  GarageBookingDto,
  GarageCloseReason,
  GarageRequestDto,
  GarageRequestJobPriceDto,
  GarageRequestListDto,
  GarageRequestSummaryDto,
  GarageRequestsQueryDto,
} from '@motor-fix/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type {
  Account,
  Booking,
  JobType,
  Prisma,
  PrismaClient,
  Quote,
  QuoteJob,
  QuoteRequest,
  RequestJob,
  RequestRecipient,
} from '../../generated/prisma/client';
import { PAGE_SIZE } from '../quotes-config';
import {
  assertCursor,
  closeReasonOf,
  firstLine,
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

// What the garage ticked, as "brand job" keys for the rows' car brands.
type Offered = Set<string>;
const offeredKey = (brand: string, jobTypeId: string) =>
  `${brand}\u0000${jobTypeId}`;

type Closed = { closedAt: string; closedReason: GarageCloseReason };

function summaryOf(
  row: SummaryRow,
  offered: Offered,
  closed?: Closed,
): GarageRequestSummaryDto {
  const [recipient] = row.recipients;
  const [quote] = row.quotes;
  return {
    car: snapshotOf(row),
    closedAt: closed?.closedAt ?? null,
    closedReason: closed?.closedReason ?? null,
    createdAt: row.createdAt.toISOString(),
    descriptionLine: firstLine(row.description),
    driver: { shortName: shortName(row.driver.name) },
    expiresAt: row.expiresAt.toISOString(),
    id: row.id,
    jobs: jobsOf(row.jobs).map((job) => ({
      ...job,
      offered: offered.has(offeredKey(row.carBrand, job.jobTypeId)),
    })),
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

  async list(
    actor: Actor,
    query: GarageRequestsQueryDto,
  ): Promise<GarageRequestListDto> {
    const garageId = this.garageOf(actor);
    if (query.status === 'closed') return this.closed(garageId);
    if (query.status === 'quoted') return this.quoted(garageId, query.cursor);
    const where =
      query.status === 'waiting'
        ? {
            recipients: { some: { garageId, status: 'waiting' as const } },
            status: { in: ['sent' as const, 'quoted' as const] },
          }
        : { recipients: { some: { garageId } } };
    const { rows, total } = await this.rows(garageId, where, query.cursor);
    const offered = await this.offered(garageId, rows);
    return page(rows, total, (row) => summaryOf(row, offered));
  }

  async inbox(actor: Actor, query: InboxQuery): Promise<InboxPage> {
    const garageId = this.garageOf(actor);
    const where = {
      recipients: { some: { garageId } },
      ...statusWhere(garageId, query.status),
    };
    const { rows, total } = await this.rows(garageId, where, query.cursor);
    const offered = await this.offered(garageId, rows);
    return page(rows, total, (row) => {
      const summary = summaryOf(row, offered);
      return {
        ...summary,
        description: row.description,
        jobs: summary.jobs.map((job) => ({ ...job, notOffered: !job.offered })),
      };
    });
  }

  private async rows(
    garageId: string,
    where: Prisma.QuoteRequestWhereInput,
    cursor?: string,
  ) {
    const from = await assertCursor(cursor, (id) =>
      this.prisma.quoteRequest.findFirst({ where: { ...where, id } }),
    );
    const [rows, total] = await Promise.all([
      this.prisma.quoteRequest.findMany({
        include: summaryInclude(garageId),
        orderBy: NEWEST_FIRST,
        take: PAGE_TAKE,
        where,
        ...from,
      }),
      this.prisma.quoteRequest.count({ where }),
    ]);
    return { rows, total };
  }

  // The rows closed for this garage in the last 24 hours, newest first,
  // one page. A decline closes at declined_at. Otherwise a recipient has no
  // close column: the close time is its newest status move, else the
  // request's, else when it was sent to the garage.
  private async closed(garageId: string): Promise<GarageRequestListDto> {
    const hits = await this.prisma.$queryRaw<
      { closed_at: Date; id: string; total: bigint }[]
    >`
      SELECT rr.request_id AS id, c.closed_at, count(*) OVER () AS total
      FROM request_recipient rr
      JOIN quote_request qr ON qr.id = rr.request_id
      CROSS JOIN LATERAL (
        SELECT CASE WHEN rr.status = 'declined' THEN rr.declined_at
        ELSE COALESCE(
          (SELECT max(a.at) FROM activity_log a
            WHERE a.subject_type = 'request_recipient'
              AND a.subject_id = rr.id AND a.field = 'status'),
          (SELECT max(a.at) FROM activity_log a
            WHERE a.subject_type = 'quote_request'
              AND a.subject_id = qr.id AND a.field = 'status'),
          rr.created_at
        ) END AS closed_at
      ) c
      WHERE rr.garage_id = ${garageId}::uuid
        AND (
          rr.status IN ('expired', 'closed', 'declined')
          OR (rr.status = 'waiting' AND qr.status NOT IN ('sent', 'quoted'))
        )
        AND c.closed_at > now() - interval '24 hours'
      ORDER BY qr.created_at DESC, qr.id DESC
      LIMIT ${PAGE_SIZE}`;
    if (hits.length === 0) return { items: [], nextCursor: null, total: 0 };
    const [rows, garage] = await Promise.all([
      this.prisma.quoteRequest.findMany({
        include: summaryInclude(garageId),
        where: { id: { in: hits.map((hit) => hit.id) } },
      }),
      this.prisma.garage.findUniqueOrThrow({
        select: { status: true },
        where: { id: garageId },
      }),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const offered = await this.offered(garageId, rows);
    return {
      items: hits.flatMap((hit) => {
        const row = byId.get(hit.id);
        if (!row) return [];
        const closedReason = closeReasonOf(
          row.recipients[0].status,
          row,
          garage.status,
          row.quotes[0]?.status === 'accepted',
        );
        return [
          summaryOf(row, offered, {
            closedAt: hit.closed_at.toISOString(),
            closedReason,
          }),
        ];
      }),
      nextCursor: null,
      total: Number(hits[0].total),
    };
  }

  // The rows this garage quoted whose quote still waits, newest quote first.
  private async quoted(
    garageId: string,
    cursor?: string,
  ): Promise<GarageRequestListDto> {
    const where = {
      garageId,
      recipient: { status: 'quoted' as const },
      status: 'waiting' as const,
    };
    const from = await assertCursor(cursor, (requestId) =>
      this.prisma.quote.findFirst({ where: { ...where, requestId } }),
    );
    const [hits, total] = await Promise.all([
      this.prisma.quote.findMany({
        orderBy: [{ sentAt: 'desc' }, { requestId: 'desc' }],
        select: { requestId: true },
        take: PAGE_TAKE,
        where,
        ...(from.cursor && {
          cursor: {
            requestId_garageId: { garageId, requestId: from.cursor.id },
          },
          skip: 1,
        }),
      }),
      this.prisma.quote.count({ where }),
    ]);
    const found = await this.prisma.quoteRequest.findMany({
      include: summaryInclude(garageId),
      where: { id: { in: hits.map((hit) => hit.requestId) } },
    });
    const byId = new Map(found.map((row) => [row.id, row]));
    const rows = hits.flatMap((hit) => byId.get(hit.requestId) ?? []);
    const offered = await this.offered(garageId, rows);
    return page(rows, total, (row) => summaryOf(row, offered));
  }

  // The garage's price-list row for each asked job: the row for the car's
  // brand, else its default row. Hidden rows count: the garage still means
  // the price.
  private async prices(
    garageId: string,
    row: Pick<QuoteRequest, 'carBrand'> & { jobs: { jobTypeId: string }[] },
  ): Promise<Map<string, GarageRequestJobPriceDto>> {
    const rows = await this.prisma.garagePrice.findMany({
      orderBy: { brandId: { nulls: 'last', sort: 'asc' } },
      select: {
        durationMinutes: true,
        fromBani: true,
        jobTypeId: true,
        toBani: true,
      },
      where: {
        garageId,
        jobTypeId: { in: row.jobs.map((job) => job.jobTypeId) },
        OR: [{ brand: { name: row.carBrand } }, { brandId: null }],
      },
    });
    const prices = new Map<string, GarageRequestJobPriceDto>();
    for (const { jobTypeId, ...price } of rows) {
      if (!prices.has(jobTypeId)) prices.set(jobTypeId, price);
    }
    return prices;
  }

  // One read for the whole page: the jobs this garage ticked for the brands
  // of the rows' cars.
  private async offered(
    garageId: string,
    rows: Pick<QuoteRequest, 'carBrand'>[],
  ): Promise<Offered> {
    if (rows.length === 0) return new Set();
    const ticks = await this.prisma.garageBrandJob.findMany({
      select: {
        garageBrand: { select: { brand: { select: { name: true } } } },
        jobTypeId: true,
      },
      where: {
        garageBrand: {
          brand: { name: { in: [...new Set(rows.map((r) => r.carBrand))] } },
        },
        garageId,
      },
    });
    return new Set(
      ticks.map((tick) =>
        offeredKey(tick.garageBrand.brand.name, tick.jobTypeId),
      ),
    );
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
    const [offered, prices] = await Promise.all([
      this.offered(garageId, [row]),
      this.prices(garageId, row),
    ]);
    const summary = summaryOf(row, offered);
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
      jobs: summary.jobs.map((job) => ({
        ...job,
        price: prices.get(job.jobTypeId) ?? null,
      })),
    };
  }

  private garageOf(actor: Actor) {
    requireCapability(actor, 'garage.requests');
    if (!actor.garageId) throw new NotFoundException();
    return actor.garageId;
  }
}
