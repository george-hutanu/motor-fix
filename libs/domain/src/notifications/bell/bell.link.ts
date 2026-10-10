// The driver view a bell row opens. A car reminder names its car; a request's
// notification carries the request's address its e-mail links to, since its
// subject is a quote or a recipient; a review's opens the reviews. Any other
// kind opens nothing: the bell only marks it read.
type View = 'cars' | 'requests' | 'reviews';

const CARS: View = 'cars';
const REQUESTS: View = 'requests';
const REVIEWS: View = 'reviews';

export const VIEW_OF_KIND: Readonly<Record<string, View>> = {
  BOOKING_CANCELLED: REQUESTS,
  BOOKING_CONFIRMED: REQUESTS,
  BOOKING_LAPSED: REQUESTS,
  BOOKING_MOVE_LAPSED: REQUESTS,
  BOOKING_MOVE_REFUSED: REQUESTS,
  BOOKING_MOVE_REQUESTED: REQUESTS,
  BOOKING_MOVED: REQUESTS,
  BOOKING_REMINDER: REQUESTS,
  BOOKING_TIME_PROPOSED: REQUESTS,
  CAR_TRANSFER_ACCEPTED: CARS,
  DUE_ITP: CARS,
  DUE_RCA: CARS,
  DUE_ROVINIETA: CARS,
  FINAL_PRICE_CORRECTED: REQUESTS,
  GARAGE_SUSPENDED_NOTICE: REQUESTS,
  JOB_ETA_CHANGED: REQUESTS,
  JOB_READY: REQUESTS,
  JOB_STARTED: REQUESTS,
  LIVE_STARTED: REQUESTS,
  MEDIA_ADDED: REQUESTS,
  MEDIA_REMOVED: REQUESTS,
  MESSAGE_RECEIVED: REQUESTS,
  NO_SHOW_RECORDED: REQUESTS,
  QUOTE_CHANGED: REQUESTS,
  QUOTE_EXPIRED: REQUESTS,
  QUOTE_RECEIVED: REQUESTS,
  QUOTE_WITHDRAWN: REQUESTS,
  REPAIR_UPDATED: CARS,
  REQUEST_DECLINED: REQUESTS,
  REQUEST_EXPIRED: REQUESTS,
  REVIEW_APPEAL_DECIDED: REVIEWS,
  REVIEW_DECIDED: REVIEWS,
  REVIEW_INVITE: REVIEWS,
  REVIEW_REPLIED: REVIEWS,
  SERVICE_DUE: CARS,
  TYRES_SEASON: CARS,
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
    path = new URL(link).pathname;
  } catch {
    return null;
  }
  const id = REQUEST_PATH.exec(path)?.[1];
  return id && UUID.test(id) ? id : null;
}

export function bellLink(row: Row): string | null {
  if (!Object.hasOwn(VIEW_OF_KIND, row.kind)) return null;
  const view = VIEW_OF_KIND[row.kind];
  if (view === CARS) {
    return row.subjectId ? `${ROOT}/cars/${row.subjectId}` : `${ROOT}/cars`;
  }
  if (view === REQUESTS) {
    const id = requestOf(row.params);
    return id ? `${ROOT}/requests/${id}` : `${ROOT}/requests`;
  }
  return `${ROOT}/reviews`;
}
