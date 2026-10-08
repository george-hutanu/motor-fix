import type {
  BookingCancelReason,
  DeclineReason,
} from '../generated/prisma/enums';

// The limits and durations of requests, quotes and bookings. A day is a
// Bucharest calendar day (addLocalDays), an hour a real hour.
export const REQUEST_MAX_GARAGES = 5;
export const REQUEST_VALIDITY_DAYS = 7;
export const QUOTE_VALIDITY_DAYS = 7;
export const REQUEST_REMINDER_DAYS: readonly number[] = [2, 5];
export const BOOKING_CONFIRM_LAPSE_HOURS = 24;
export const FREE_CANCEL_CUTOFF_HOURS = 2;
export const BOOKING_MAX_MOVES = 2;
export const MOVE_CUTOFF_HOURS = 2;
export const DECLINE_UNDO_MINUTES = 5;
export const PAGE_SIZE = 20;
export const TIME_ZONE = 'Europe/Bucharest';

// The reasons each side may give; the system's own reasons are not offered.
// The migration's booking_cancel_reason_side_check lists them again in SQL.
export const CANCEL_REASONS = {
  driver: ['plans_changed', 'found_another_garage', 'problem_solved', 'other'],
  garage: [
    'no_mechanic_free',
    'parts_not_available',
    'closed_that_day',
    'driver_asked',
    'other',
  ],
} as const satisfies Record<
  'driver' | 'garage',
  readonly BookingCancelReason[]
>;

export const DECLINE_REASONS: readonly DeclineReason[] = [
  'fully_booked',
  'job_not_done',
  'make_model_engine_not_done',
  'need_to_see_car',
];
