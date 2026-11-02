// The view a bell row opens. A car reminder names its car; a request's
// notification carries the request's address its e-mail links to, since its
// subject is a quote or a recipient; a review's opens the reviews; a
// suspension or a yearly documents notice opens the garage dashboard; a decision on a driver's report
// opens the reported garage's public profile its e-mail links to; a decision
// on a job the garage proposed opens its Prețuri; an assistant's action
// waiting for approval opens that approval; a removed review or reply opens
// the reviews of the side it was told to. Any other
// kind opens nothing: the bell only marks it read.
type View =
  | 'assistant-approval'
  | 'cars'
  | 'garage'
  | 'garage-reviews'
  | 'prices'
  | 'profile'
  | 'requests'
  | 'review-decided'
  | 'reviews';

export const VIEW_OF_KIND: Readonly<Record<string, View>> = {
  ASSISTANT_APPROVAL_NEEDED: 'assistant-approval',
  BOOKING_CANCELLED: 'requests',
  BOOKING_CONFIRMED: 'requests',
  BOOKING_LAPSED: 'requests',
  BOOKING_MOVE_LAPSED: 'requests',
  BOOKING_MOVE_REFUSED: 'requests',
  BOOKING_MOVE_REQUESTED: 'requests',
  BOOKING_MOVED: 'requests',
  BOOKING_REMINDER: 'requests',
  BOOKING_TIME_PROPOSED: 'requests',
  CAR_TRANSFER_ACCEPTED: 'cars',
  CATALOGUE_JOB_DECIDED: 'prices',
  DOCUMENT_DUE: 'garage',
  DOCUMENT_OVERDUE: 'garage',
  DOCUMENT_REFUSED: 'garage',
  DUE_ITP: 'cars',
  DUE_RCA: 'cars',
  DUE_ROVINIETA: 'cars',
  FINAL_PRICE_CORRECTED: 'requests',
  GARAGE_REPORT_DECIDED: 'profile',
  GARAGE_SUSPENDED: 'garage',
  GARAGE_SUSPENDED_NOTICE: 'requests',
  JOB_ETA_CHANGED: 'requests',
  JOB_READY: 'requests',
  JOB_STARTED: 'requests',
  LIVE_STARTED: 'requests',
  MEDIA_ADDED: 'requests',
  MEDIA_REMOVED: 'requests',
  MESSAGE_RECEIVED: 'requests',
  NO_SHOW_RECORDED: 'requests',
  NO_SHOW_WITHDRAWN: 'requests',
  QUOTE_CHANGED: 'requests',
  QUOTE_EXPIRED: 'requests',
  QUOTE_RECEIVED: 'requests',
  QUOTE_WITHDRAWN: 'requests',
  REPAIR_UPDATED: 'cars',
  REQUEST_DECLINED: 'requests',
  REQUEST_EXPIRED: 'requests',
  REVIEW_APPEAL_DECIDED: 'reviews',
  REVIEW_DECIDED: 'review-decided',
  REVIEW_INVITE: 'reviews',
  REVIEW_POSTED: 'garage-reviews',
  REVIEW_REPLIED: 'reviews',
  SERVICE_DUE: 'cars',
  TYRES_SEASON: 'cars',
};

// The views a row opens at one address whatever it carries.
const FIXED_PATH: Partial<Record<View, string>> = {
  garage: '/app/garage',
  'garage-reviews': '/app/garage/reviews',
  prices: '/app/garage/prices',
};

const ROOT = '/app/driver';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_PATH = /^\/app\/driver\/requests\/([^/]+)$/;
const PROFILE_PATH = /^\/(ro|en)\/garages\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Row {
  kind: string;
  subjectId: string | null;
  params: unknown;
}

// The path of a notification's own link under `key`, else none.
function pathOf(params: unknown, key: string): string | null {
  if (!params || typeof params !== 'object') return null;
  const link = (params as Record<string, unknown>)[key];
  if (typeof link !== 'string') return null;
  try {
    // Relative or absolute; only the path counts.
    return new URL(link, 'https://motorfix.invalid').pathname;
  } catch {
    return null;
  }
}

// The request a notification's own link names, else none.
function requestOf(params: unknown): string | null {
  const id = REQUEST_PATH.exec(pathOf(params, 'link') ?? '')?.[1];
  return id && UUID.test(id) ? id : null;
}

// The public profile a notification links to, else none.
function profileOf(params: unknown): string | null {
  const path = pathOf(params, 'profile');
  return path && PROFILE_PATH.test(path) ? path : null;
}

// Whose side a REVIEW_DECIDED row was written for, from its variant.
function sideOf(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null;
  const variant = (params as { variant?: unknown }).variant;
  return typeof variant === 'string' ? (variant.split('_')[1] ?? null) : null;
}

// The views a row opens at what it alone names, else nothing.
const OPENS: Partial<Record<View, (row: Row) => string | null>> = {
  'assistant-approval': ({ subjectId }) =>
    subjectId && UUID.test(subjectId)
      ? `/app/assistant/approvals/${subjectId}`
      : null,
  profile: ({ params }) => profileOf(params),
  // A removal told to the garage's owner opens the garage's Recenzii; the
  // author's opens their own.
  'review-decided': ({ params }) =>
    sideOf(params) === 'owner' ? '/app/garage/reviews' : `${ROOT}/reviews`,
};

export function bellLink(row: Row): string | null {
  if (!Object.hasOwn(VIEW_OF_KIND, row.kind)) return null;
  const view = VIEW_OF_KIND[row.kind];
  const fixed = FIXED_PATH[view];
  if (fixed) return fixed;
  const opens = OPENS[view];
  if (opens) return opens(row);
  if (view === 'cars') {
    return row.subjectId ? `${ROOT}/cars/${row.subjectId}` : `${ROOT}/cars`;
  }
  if (view === 'requests') {
    const id = requestOf(row.params);
    return id ? `${ROOT}/requests/${id}` : `${ROOT}/requests`;
  }
  return `${ROOT}/reviews`;
}
