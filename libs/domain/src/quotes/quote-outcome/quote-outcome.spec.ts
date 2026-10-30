import {
  BOOKING_STATUSES,
  type BookingStatus,
  type GarageStatus,
  QUOTE_OUTCOMES,
  QUOTE_STATUSES,
  type QuoteStatus,
  type RequestClosedReason,
} from '@motor-fix/contracts';

import { outcomeOf } from './quote-outcome';

type Garage = GarageStatus;

const outcome = (
  quote: QuoteStatus,
  booking: BookingStatus | null = null,
  closedReason: RequestClosedReason | null = null,
  garage: Garage = 'approved',
) =>
  outcomeOf({
    booking: booking === null ? null : { status: booking },
    garage: { status: garage },
    quote: { status: quote },
    request: { closedReason },
  });

// @traces 346-FR-001
describe('what became of a quote the garage sent', () => {
  it('reads a waiting quote as waiting', () => {
    expect(outcome('waiting')).toBe('waiting');
  });

  it('reads a suspended garage’s waiting quote as withdrawn for the suspension', () => {
    expect(outcome('waiting', null, null, 'suspended')).toBe(
      'withdrawn_suspended',
    );
  });

  it('reads an accepted quote whose booking awaits confirmation as accepted', () => {
    expect(outcome('accepted', 'awaiting_confirmation')).toBe('accepted');
  });

  it.each(['confirmed', 'completed'] as const)(
    'reads an accepted quote whose booking is %s as booked',
    (booking) => {
      expect(outcome('accepted', booking)).toBe('booked');
    },
  );

  it('reads an accepted quote whose driver did not show up as no_show', () => {
    expect(outcome('accepted', 'no_show')).toBe('no_show');
  });

  it.each([
    ['awaiting_confirmation', 'accepted'],
    ['confirmed', 'booked'],
    ['completed', 'booked'],
  ] as const)(
    'keeps a suspended garage’s accepted quote with a %s booking as %s',
    (booking, expected) => {
      expect(outcome('accepted', booking, null, 'suspended')).toBe(expected);
    },
  );

  it('reads an expired quote whose own booking lapsed as lapsed', () => {
    expect(outcome('expired', 'lapsed', 'booking_lapsed')).toBe('lapsed');
  });

  it('reads an expired quote with no booking as expired', () => {
    expect(outcome('expired', null, 'expired')).toBe('expired');
  });

  it('reads an expired quote whose booking did not lapse as expired', () => {
    expect(outcome('expired', 'cancelled')).toBe('expired');
  });

  it('reads a withdrawn quote as withdrawn', () => {
    expect(outcome('withdrawn')).toBe('withdrawn');
  });

  it('reads a quote the driver declined as declined', () => {
    expect(outcome('declined_by_driver')).toBe('declined');
  });

  it('reads a lost quote on a closed account as account_closed, with or without its own booking', () => {
    expect(outcome('lost', null, 'account_closed')).toBe('account_closed');
    expect(outcome('lost', 'cancelled', 'account_closed')).toBe(
      'account_closed',
    );
  });

  it('reads a lost quote whose own booking was cancelled as booking_cancelled, the request open or closed', () => {
    expect(outcome('lost', 'cancelled', null)).toBe('booking_cancelled');
    expect(outcome('lost', 'cancelled', 'booking_cancelled')).toBe(
      'booking_cancelled',
    );
    expect(outcome('lost', 'cancelled', 'cancelled')).toBe('booking_cancelled');
  });

  it('reads a lost quote on a request the driver cancelled as request_cancelled', () => {
    expect(outcome('lost', null, 'cancelled')).toBe('request_cancelled');
  });

  it('reads any other lost quote as chose_other', () => {
    expect(outcome('lost', null, null)).toBe('chose_other');
    expect(outcome('lost', null, 'booking_lapsed')).toBe('chose_other');
    expect(outcome('lost', null, 'no_show')).toBe('chose_other');
  });

  it('gives every quote and booking status pairing an outcome', () => {
    for (const quote of QUOTE_STATUSES) {
      for (const booking of [...BOOKING_STATUSES, null]) {
        for (const garage of ['approved', 'suspended'] as const) {
          expect(QUOTE_OUTCOMES).toContain(
            outcome(quote, booking, null, garage),
          );
        }
      }
    }
  });
});
