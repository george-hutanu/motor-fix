// The driver view a bell row opens. A car reminder names its car; a request's
// notification carries the request's address its e-mail links to, since its
// subject is a quote or a recipient; a review's opens the reviews. Any other
// kind opens nothing: the bell only marks it read.
type View = 'cars' | 'requests' | 'reviews';

export const VIEW_OF_KIND: Readonly<Record<string, View>> = {
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
  DUE_ITP: 'cars',
  DUE_RCA: 'cars',
  DUE_ROVINIETA: 'cars',
  FINAL_PRICE_CORRECTED: 'requests',
  GARAGE_SUSPENDED_NOTICE: 'requests',
  JOB_ETA_CHANGED: 'requests',
  JOB_READY: 'requests',
  JOB_STARTED: 'requests',
  LIVE_STARTED: 'requests',
  MEDIA_ADDED: 'requests',
  MEDIA_REMOVED: 'requests',
  MESSAGE_RECEIVED: 'requests',
  NO_SHOW_RECORDED: 'requests',
  QUOTE_CHANGED: 'requests',
  QUOTE_EXPIRED: 'requests',
  QUOTE_RECEIVED: 'requests',
  QUOTE_WITHDRAWN: 'requests',
  REPAIR_UPDATED: 'cars',
  REQUEST_DECLINED: 'requests',
  REQUEST_EXPIRED: 'requests',
  REVIEW_APPEAL_DECIDED: 'reviews',
  REVIEW_DECIDED: 'reviews',
  REVIEW_INVITE: 'reviews',
  REVIEW_REPLIED: 'reviews',
  SERVICE_DUE: 'cars',
  TYRES_SEASON: 'cars',
};

const ROOT = '/app/driver';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_PATH = /^\/app\/driver\/requests\/([^/]+)$/;

interface Row {
  kind: string;
  subjectId: string | null;
  params: unknown;
}

// The request a notification's own link names, else none.
function requestOf(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null;
  const link = (params as Record<string, unknown>)['link'];
  if (typeof link !== 'string') return null;
  let path: string;
  try {
    // Relative or absolute; only the path counts.
    path = new URL(link, 'https://motorfix.invalid').pathname;
  } catch {
    return null;
  }
  const id = REQUEST_PATH.exec(path)?.[1];
  return id && UUID.test(id) ? id : null;
}

export function bellLink(row: Row): string | null {
  if (!Object.hasOwn(VIEW_OF_KIND, row.kind)) return null;
  const view = VIEW_OF_KIND[row.kind];
  if (view === 'cars') {
    return row.subjectId ? `${ROOT}/cars/${row.subjectId}` : `${ROOT}/cars`;
  }
  if (view === 'requests') {
    const id = requestOf(row.params);
    return id ? `${ROOT}/requests/${id}` : `${ROOT}/requests`;
  }
  return `${ROOT}/reviews`;
}
