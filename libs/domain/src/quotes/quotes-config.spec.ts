import * as config from './quotes-config';
import { BookingCancelReason, DeclineReason } from '../generated/prisma/enums';

// @traces 220-FR-010
describe('the request, quote and booking limits', () => {
  it('holds every limit and duration in one place', () => {
    expect(config).toMatchObject({
      BOOKING_CONFIRM_LAPSE_HOURS: 24,
      BOOKING_MAX_MOVES: 2,
      DECLINE_UNDO_MINUTES: 5,
      FREE_CANCEL_CUTOFF_HOURS: 2,
      MOVE_CUTOFF_HOURS: 2,
      PAGE_SIZE: 20,
      QUOTE_VALIDITY_DAYS: 7,
      REQUEST_MAX_GARAGES: 5,
      REQUEST_REMINDER_DAYS: [2, 5],
      REQUEST_VALIDITY_DAYS: 7,
    });
  });

  it('gives each side its own cancellation reasons', () => {
    expect(config.CANCEL_REASONS).toEqual({
      driver: [
        'plans_changed',
        'found_another_garage',
        'problem_solved',
        'other',
      ],
      garage: [
        'no_mechanic_free',
        'parts_not_available',
        'closed_that_day',
        'driver_asked',
        'other',
      ],
    });
  });

  it('names the same cancellation reasons the database accepts, plus the system ones', () => {
    const sides = new Set([
      ...config.CANCEL_REASONS.driver,
      ...config.CANCEL_REASONS.garage,
      'garage_suspended',
      'driver_account_closed',
    ]);

    expect([...sides].sort()).toEqual(
      Object.values(BookingCancelReason).sort(),
    );
  });

  it('names the same decline reasons the database accepts', () => {
    expect([...config.DECLINE_REASONS].sort()).toEqual(
      Object.values(DeclineReason).sort(),
    );
  });
});
