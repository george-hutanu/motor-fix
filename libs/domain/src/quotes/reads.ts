import type {
  CarSnapshotDto,
  GarageCloseReason,
  GarageRefDto,
  QuoteDto,
  RequestJobDto,
} from '@motor-fix/contracts';
import { BadRequestException } from '@nestjs/common';

import { PAGE_SIZE } from './quotes-config';
import type {
  Booking,
  Garage,
  GarageStatus,
  JobType,
  Quote,
  QuoteJob,
  QuoteRequest,
  RecipientStatus,
  RequestJob,
} from '../generated/prisma/client';

export const iso = (at: Date | null) => at?.toISOString() ?? null;

// "Andrei Ion Marin" is "Andrei M."; a single word stays as it is.
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return words[0] ?? '';
  return `${words[0]} ${words.at(-1)?.charAt(0)}.`;
}

export const snapshotOf = (request: QuoteRequest): CarSnapshotDto => ({
  brand: request.carBrand,
  engine: request.carEngine,
  fuel: request.carFuel,
  model: request.carModel,
  year: request.carYear,
});

// The plate, when the reader may see it and the car has one.
export const plateOf = (plate: string | null, shown: boolean) =>
  shown && plate ? { plate } : {};

export const jobsOf = (
  jobs: (RequestJob & { jobType: JobType })[],
): RequestJobDto[] =>
  jobs.map((job) => ({
    id: job.id,
    jobTypeId: job.jobTypeId,
    nameEn: job.jobType.nameEn,
    nameRo: job.jobType.nameRo,
    position: job.position,
  }));

// The description's first line, or null when there is none.
export function firstLine(text: string | null): string | null {
  return text?.split(/\r?\n/, 1)[0].trim() || null;
}

const BOOKED = new Set(['booked', 'in_work', 'done']);
const BOOKING_ENDED = new Set([
  'booking_lapsed',
  'booking_cancelled',
  'no_show',
]);

// The request's own close, as a garage reads it; null when it names none.
function requestCloseOf(
  request: Pick<QuoteRequest, 'status' | 'closedReason'>,
  ownQuoteAccepted: boolean,
): GarageCloseReason | null {
  const reason = request.status === 'closed' ? request.closedReason : null;
  if (reason === 'cancelled' || reason === 'account_closed') return reason;
  const tookAnother =
    BOOKED.has(request.status) || BOOKING_ENDED.has(reason ?? '');
  return tookAnother && !ownQuoteAccepted ? 'accepted_elsewhere' : null;
}

// Why a request closed for one garage, tried in GARAGE_CLOSE_REASONS' order;
// a close no rule names reads as account_closed.
export function closeReasonOf(
  recipient: RecipientStatus,
  request: Pick<QuoteRequest, 'status' | 'closedReason'>,
  garage: GarageStatus,
  ownQuoteAccepted: boolean,
): GarageCloseReason {
  if (recipient === 'expired') return 'expired';
  if (recipient === 'closed' && garage === 'suspended') {
    return 'garage_suspended';
  }
  return requestCloseOf(request, ownQuoteAccepted) ?? 'account_closed';
}

export const garageRef = (garage: Garage): GarageRefDto => ({
  id: garage.id,
  name: garage.name,
  slug: garage.slug,
});

export const quoteOf = (
  quote: Quote & { jobs: QuoteJob[] },
): Omit<QuoteDto, 'garage'> => ({
  acceptedAt: iso(quote.acceptedAt),
  changedAt: iso(quote.changedAt),
  durationMinutes: quote.durationMinutes,
  expiresAt: quote.expiresAt.toISOString(),
  fromBani: quote.fromBani,
  id: quote.id,
  jobs: quote.jobs.map((job) => ({
    included: job.included,
    requestJobId: job.requestJobId,
  })),
  note: quote.note,
  sentAt: quote.sentAt.toISOString(),
  slot: quote.slot.toISOString(),
  status: quote.status,
  toBani: quote.toBani,
  withdrawnAt: iso(quote.withdrawnAt),
});

// Newest first; ties broken by id so a page boundary never repeats a row.
export const NEWEST_FIRST = [
  { createdAt: 'desc' as const },
  { id: 'desc' as const },
];

// The rows of one page (read one past PAGE_SIZE to know whether more follow).
export function page<T extends { id: string }, D>(
  rows: T[],
  total: number,
  answer: (row: T) => D,
) {
  const items = rows.slice(0, PAGE_SIZE);
  return {
    items: items.map(answer),
    nextCursor: rows.length > PAGE_SIZE ? (items.at(-1)?.id ?? null) : null,
    total,
  };
}

// Where the next page starts; a cursor outside the caller's rows is refused
// rather than read as the start of someone else's list.
export async function assertCursor(
  cursor: string | undefined,
  inScope: (id: string) => Promise<unknown>,
): Promise<{ cursor?: { id: string }; skip?: number }> {
  if (!cursor) return {};
  if (!(await inScope(cursor))) {
    throw new BadRequestException({
      code: 'invalid_cursor',
      message: 'cursor is not a row of this list',
    });
  }
  return { cursor: { id: cursor }, skip: 1 };
}

export const PAGE_TAKE = PAGE_SIZE + 1;

export const invalidInput = (message: string) =>
  new BadRequestException({ code: 'validation', message });

// A booking as a garage's day reads it: the car as the driver described it
// and the jobs the garage quoted, named in the reader's language.
export const bookedInclude = {
  quote: {
    include: {
      jobs: {
        include: { requestJob: { include: { jobType: true } } },
        where: { included: true },
      },
    },
  },
  request: true,
} as const;

type BookedRow = Booking & {
  quote: Quote & {
    jobs: (QuoteJob & { requestJob: RequestJob & { jobType: JobType } })[];
  };
  request: QuoteRequest;
};

export function bookedOf(row: BookedRow, language: 'ro' | 'en' = 'ro') {
  return {
    car: {
      brand: row.request.carBrand,
      model: row.request.carModel,
      year: row.request.carYear,
    },
    durationMinutes: row.durationMinutes,
    id: row.id,
    jobs: row.quote.jobs
      .map((job) => job.requestJob)
      .sort((a, b) => a.position - b.position)
      .map((job) =>
        language === 'en' ? job.jobType.nameEn : job.jobType.nameRo,
      ),
    startsAt: row.startsAt.toISOString(),
    state: row.status,
  };
}
