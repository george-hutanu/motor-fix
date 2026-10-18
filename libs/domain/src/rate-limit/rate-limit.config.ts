// Every rate limit of the API and the assistant endpoint: a change to a
// count or a window is a change here and nowhere else.

const MINUTE = 60;
const HOUR = 60 * MINUTE;

// Calls counted in Redis over a window that begins with the first, under a
// key prefix of their own.
export interface CountRule {
  key: string;
  limit: number;
  // The logger's name, so a skipped count says whose it was.
  name: string;
  windowSeconds: number;
}

// A route's limit, refused with `rate_limited`: per client address, or per
// key the route names (an account, a draft).
export interface RouteRule extends CountRule {
  per: 'address' | 'key';
}

export const ROUTE_LIMITS = {
  // Calls to the assistant endpoint per account, across all its grants.
  assistant: {
    key: 'limit:assistant',
    limit: 60,
    name: 'AssistantLimit',
    per: 'key',
    windowSeconds: MINUTE,
  },
  // Test pushes per account.
  pushTest: {
    key: 'limit:push-test',
    limit: 5,
    name: 'PushTestLimit',
    per: 'key',
    windowSeconds: 10 * MINUTE,
  },
  // Quotes sent per garage account.
  quoteSend: {
    key: 'limit:quote-send',
    limit: 60,
    name: 'QuoteSendLimit',
    per: 'key',
    windowSeconds: HOUR,
  },
  // Garage searches per address, logged or not.
  search: {
    key: 'limit:search',
    limit: 120,
    name: 'SearchLimit',
    per: 'address',
    windowSeconds: MINUTE,
  },
  // Every sign-in attempt, right or wrong, per address.
  signInAttempts: {
    key: 'limit:sign-in',
    limit: 30,
    name: 'SignInLimit',
    per: 'address',
    windowSeconds: 15 * MINUTE,
  },
  // Upload addresses per listing draft, photos and document pages together.
  uploadUrl: {
    key: 'limit:upload-url',
    limit: 60,
    name: 'UploadUrlLimit',
    per: 'key',
    windowSeconds: HOUR,
  },
} as const satisfies Record<string, RouteRule>;

export type RouteLimit = keyof typeof ROUTE_LIMITS;

// The limits that answer a code of their own, each counted by its throttle.
export const THROTTLES = {
  // authorize and token per address: well above what sign-ins need, since
  // every token call comes from the identity server's one address.
  assistantSignIn: {
    key: 'auth:assistant',
    limit: 120,
    name: 'AssistantSignIn',
    windowSeconds: MINUTE,
  },
  consents: {
    key: 'consents:record',
    limit: 20,
    name: 'Consents',
    windowSeconds: HOUR,
  },
  listingDraftCreate: {
    key: 'listing-drafts:create',
    limit: 10,
    name: 'ListingDrafts',
    windowSeconds: HOUR,
  },
  // What a person typing needs, and a cap on what one source can spend of
  // the provider's free quota.
  places: {
    key: 'places:lookup',
    limit: 60,
    name: 'Places',
    windowSeconds: MINUTE,
  },
  // Far above a person opening profiles, low enough that one source cannot
  // flood the counters.
  profileViews: {
    key: 'insights:pv:address',
    limit: 60,
    name: 'ProfileViews',
    windowSeconds: MINUTE,
  },
  supportAccount: {
    key: 'support:account',
    limit: 5,
    name: 'SupportThrottle',
    windowSeconds: HOUR,
  },
  supportAddress: {
    key: 'support:address',
    limit: 5,
    name: 'SupportThrottle',
    windowSeconds: HOUR,
  },
} as const satisfies Record<string, CountRule>;

// The sign-in, sign-up and code limits, counted by Attempts.
export const AUTH_LIMITS = {
  contactChange: { limit: 5, windowSeconds: HOUR },
  password: { limit: 5, windowSeconds: 15 * MINUTE },
  phoneCode: { address: 20, hour: 5, minute: 1, windowSeconds: HOUR },
  reset: { address: 10, email: 3, windowSeconds: HOUR },
  signInFailures: { address: 20, email: 5, windowSeconds: 15 * MINUTE },
  signUp: { limit: 10, windowSeconds: HOUR },
} as const;

// The limits counted from the rows PostgreSQL already holds.
export const COUNTED_IN_DATABASE = {
  draftLinksPerHour: 5,
  quoteRequestsPerDay: 20,
} as const;
