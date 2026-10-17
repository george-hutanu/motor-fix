import type {
  CompareQuoteDto,
  CompareRequestDto,
  RequestBookingDto,
  RequestSummaryDto,
} from '@motor-fix/data-access';
import type { Language } from '@motor-fix/i18n';

export type RowState =
  | 'open'
  | 'on_hold'
  | 'accepted'
  | 'expired'
  | 'declined'
  | 'closed';

export const SORTS = ['fastest', 'price', 'earliest', 'rating'] as const;
export type Sort = (typeof SORTS)[number];

// The tab's sort, in sessionStorage: a new tab starts on the fastest.
export const SORT_KEY = 'mf.quotes.sort';

type Booking = Pick<RequestBookingDto, 'status' | 'confirmBy'> | null;

// Every row counts but the ones the driver declined.
export const headerCount = (quotes: readonly CompareQuoteDto[]) =>
  quotes.filter((q) => q.status !== 'declined_by_driver').length;

// What the request asks for: its jobs, else its description, which the API
// already cuts to its first line.
export function headerWhat(
  request: Pick<CompareRequestDto, 'jobs' | 'description'>,
  language: Language,
): string {
  if (request.jobs.length === 0) return request.description ?? '';
  return request.jobs
    .toSorted((a, b) => a.position - b.position)
    .map((job) => (language === 'en' ? job.nameEn : job.nameRo))
    .join(', ');
}

const STATE_OF: Record<
  Exclude<CompareQuoteDto['status'], 'waiting'>,
  RowState
> = {
  accepted: 'accepted',
  declined_by_driver: 'declined',
  expired: 'expired',
  lost: 'closed',
};

// A waiting quote is held while the newest booking waits for its garage.
export function rowState(
  quote: Pick<CompareQuoteDto, 'status' | 'expiresAt'>,
  booking: Booking,
  now: Date,
): RowState {
  if (quote.status !== 'waiting') return STATE_OF[quote.status];
  if (Date.parse(quote.expiresAt) <= now.getTime()) return 'expired';
  return booking?.status === 'awaiting_confirmation' ? 'on_hold' : 'open';
}

const showsQuotes = (request: RequestSummaryDto) =>
  request.quotesCount > 0 &&
  (request.status === 'quoted' ||
    (request.status === 'booked' &&
      request.booking?.status === 'awaiting_confirmation'));

// The most recent request whose quotes the driver can still act on.
export const openRequestOf = (items: readonly RequestSummaryDto[]) =>
  items
    .filter(showsQuotes)
    .reduce<RequestSummaryDto | undefined>(
      (newest, request) =>
        !newest || Date.parse(request.createdAt) > Date.parse(newest.createdAt)
          ? request
          : newest,
      undefined,
    );

type Compare = (a: CompareQuoteDto, b: CompareQuoteDto) => number;

const fastest: Compare = (a, b) =>
  Date.parse(a.sentAt) - Date.parse(b.sentAt) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const ratingOf = (q: CompareQuoteDto) => q.garage.rating ?? -1;

const RULES: Record<Sort, Compare> = {
  earliest: (a, b) => Date.parse(a.slot) - Date.parse(b.slot),
  fastest: () => 0,
  price: (a, b) => a.fromBani - b.fromBani || a.toBani - b.toBani,
  rating: (a, b) =>
    ratingOf(b) - ratingOf(a) || b.garage.reviewCount - a.garage.reviewCount,
};

// Every sort falls back to the fastest answer, then the id.
export const sortQuotes = (
  quotes: readonly CompareQuoteDto[],
  sort: Sort,
): CompareQuoteDto[] =>
  quotes.toSorted((a, b) => RULES[sort](a, b) || fastest(a, b));

// The stored sort; anything else, or storage that cannot be read, is fastest.
export function storedSort(read: () => string | null): Sort {
  try {
    const value = read();
    return SORTS.find((sort) => sort === value) ?? 'fastest';
  } catch {
    return 'fastest';
  }
}
