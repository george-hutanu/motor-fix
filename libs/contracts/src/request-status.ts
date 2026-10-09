// A request's status as both sides read it; the same six words in both apps.
export const REQUEST_STATUSES = [
  'sent',
  'quoted',
  'booked',
  'in_work',
  'done',
  'closed',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<
  'ro' | 'en',
  Record<RequestStatus, string>
> = {
  en: {
    booked: 'Booked',
    closed: 'Closed',
    done: 'Done',
    in_work: 'In progress',
    quoted: 'Quote received',
    sent: 'Sent',
  },
  ro: {
    booked: 'Programată',
    closed: 'Încheiată',
    done: 'Gata',
    in_work: 'În lucru',
    quoted: 'Ofertă',
    sent: 'Trimisă',
  },
};

export const RECIPIENT_STATUSES = [
  'waiting',
  'quoted',
  'declined',
  'expired',
  'closed',
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const QUOTE_STATUSES = [
  'waiting',
  'accepted',
  'withdrawn',
  'expired',
  'lost',
  'declined_by_driver',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const BOOKING_STATUSES = [
  'awaiting_confirmation',
  'confirmed',
  'lapsed',
  'cancelled',
  'no_show',
  'completed',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const JOB_STATUSES = [
  'to_do',
  'in_work',
  'paused',
  'done',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const REQUEST_CLOSED_REASONS = [
  'expired',
  'cancelled',
  'booking_lapsed',
  'booking_cancelled',
  'no_show',
  'account_closed',
] as const;
export type RequestClosedReason = (typeof REQUEST_CLOSED_REASONS)[number];

// Why a garage's request closed for it, tried in this order; a close that
// matches none reads as account_closed's "Request closed".
export const GARAGE_CLOSE_REASONS = [
  'expired',
  'garage_suspended',
  'cancelled',
  'account_closed',
  'accepted_elsewhere',
] as const;
export type GarageCloseReason = (typeof GARAGE_CLOSE_REASONS)[number];

export const GARAGE_CLOSE_REASON_LABELS: Record<
  'ro' | 'en',
  Record<GarageCloseReason, string>
> = {
  en: {
    accepted_elsewhere: 'The customer accepted another quote',
    account_closed: 'Request closed',
    cancelled: 'Request cancelled by the customer',
    expired: 'Request expired',
    garage_suspended: 'Garage suspended',
  },
  ro: {
    accepted_elsewhere: 'Clientul a acceptat altă ofertă',
    account_closed: 'Cerere închisă',
    cancelled: 'Cerere anulată de client',
    expired: 'Cerere expirată',
    garage_suspended: 'Service suspendat',
  },
};

export const GARAGE_REQUEST_FILTERS = ['waiting', 'closed'] as const;
export type GarageRequestFilter = (typeof GARAGE_REQUEST_FILTERS)[number];

export const REQUEST_SOURCES = [
  'search',
  'map',
  'home',
  'shared_link',
  'profile_direct',
  'saved',
  'unknown',
] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const DECLINE_REASON_CODES = [
  'fully_booked',
  'job_not_done',
  'make_model_engine_not_done',
  'need_to_see_car',
] as const;
export type DeclineReasonCode = (typeof DECLINE_REASON_CODES)[number];

export const CANCELLED_BY_SIDES = ['driver', 'garage', 'system'] as const;
export type CancelledBySide = (typeof CANCELLED_BY_SIDES)[number];

export const BOOKING_CANCEL_REASONS = [
  'plans_changed',
  'found_another_garage',
  'problem_solved',
  'no_mechanic_free',
  'parts_not_available',
  'closed_that_day',
  'driver_asked',
  'other',
  'garage_suspended',
  'driver_account_closed',
] as const;
export type BookingCancelReasonCode = (typeof BOOKING_CANCEL_REASONS)[number];

// Plain values the browser reads too, kept out of the DTO file and its
// server imports.
// The garages one request goes to, the profile's included.
export const REQUEST_MAX_GARAGES = 5;
export const REQUEST_DESCRIPTION_MAX = 1000;
// A request with no job switched on says what is wrong in at least this many.
export const REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS = 10;

export const CANNOT_RECEIVE_REASONS = [
  'brand',
  'fuel',
  'jobs',
  'not_taking_requests',
] as const;
export type CannotReceiveReason = (typeof CANNOT_RECEIVE_REASONS)[number];
