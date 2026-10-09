import type { ListingDraftData } from '../listing-sections';

// A new kind of document is one entry here and its texts; nothing else
// names the kinds.
export const DOCUMENT_KINDS = [
  'onrc_certificate',
  'rar_authorisation',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_PAGES_MAX = 10;
export const CERTIFICATE_WINDOW_DAYS = 30;
export const DECLARED_NAME_MIN = 2;
export const DECLARED_NAME_MAX = 80;

// Pages are storage keys in page order; `issuedOn` is YYYY-MM-DD. A type,
// not an interface, so it stays assignable to Prisma's JSON values.
type DraftDocument = {
  pages: string[];
  issuedOn?: string;
};
export type DraftDocuments = Partial<Record<DocumentKind, DraftDocument>>;

export const isDocumentKind = (value: unknown): value is DocumentKind =>
  typeof value === 'string' &&
  (DOCUMENT_KINDS as readonly string[]).includes(value);

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Milliseconds at UTC midnight, or NaN for a malformed or impossible date.
function dayOf(date: string): number {
  const match = DATE.exec(date);
  if (!match) return Number.NaN;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const at = Date.UTC(year, month - 1, day);
  const back = new Date(at);
  return back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day
    ? at
    : Number.NaN;
}

export const isCalendarDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(dayOf(value));

// Both ends inclusive: today and the day 30 days before it pass. `today` is
// the caller's date, so the browser and the server each pass their own.
export function issuedWithinWindow(issuedOn: string, today: string): boolean {
  const days = (dayOf(today) - dayOf(issuedOn)) / DAY_MS;
  return days >= 0 && days <= CERTIFICATE_WINDOW_DAYS;
}

export const documentDone = (
  data: ListingDraftData | undefined,
  kind: DocumentKind,
): boolean => (data?.documents?.[kind]?.pages.length ?? 0) >= 1;

export function declarationDone(data: ListingDraftData | undefined): boolean {
  const name = data?.declaredByName?.trim().length ?? 0;
  return (
    Boolean(data?.declaredAt) &&
    name >= DECLARED_NAME_MIN &&
    name <= DECLARED_NAME_MAX
  );
}
