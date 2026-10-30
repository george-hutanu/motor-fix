import {
  BOOKING_STATUSES,
  type BookingStatus,
  GARAGE_STATUSES,
  type GarageStatus,
  QUOTE_OUTCOMES,
  QUOTE_STATUSES,
  type QuoteStatus,
  type RequestClosedReason,
} from '@motor-fix/contracts';

import { outcomeOf } from './quote-outcome';

const call = (
  quote: string,
  booking: string | null = null,
  closedReason: string | null = null,
  garage = 'approved',
) =>
  outcomeOf({
    booking: booking === null ? null : { status: booking as BookingStatus },
    garage: { status: garage as GarageStatus },
    quote: { status: quote as QuoteStatus },
    request: { closedReason: closedReason as RequestClosedReason | null },
  });

const REASONS = [
  null,
  'account_closed',
  'cancelled',
  'expired',
  'booking_lapsed',
  'booking_cancelled',
  'no_show',
  'chose_other',
];

// @traces 346-FR-001
describe('the outcome of a quote under hostile combinations', () => {
  it('names one of the thirteen outcomes for every quote, booking, closing reason and garage status', () => {
    const seen = QUOTE_STATUSES.flatMap((quote) =>
      [null, ...BOOKING_STATUSES].flatMap((booking) =>
        REASONS.flatMap((reason) =>
          GARAGE_STATUSES.map((garage) => call(quote, booking, reason, garage)),
        ),
      ),
    );
    expect([...seen].every((o) => QUOTE_OUTCOMES.includes(o as never))).toBe(
      true,
    );
    expect(QUOTE_OUTCOMES).toHaveLength(13);
  });

  it('lets the garage status change nothing but a waiting quote', () => {
    for (const quote of QUOTE_STATUSES.filter((s) => s !== 'waiting'))
      for (const booking of [null, ...BOOKING_STATUSES])
        for (const reason of REASONS)
          expect([
            quote,
            booking,
            reason,
            call(quote, booking, reason, 'suspended'),
          ]).toEqual([
            quote,
            booking,
            reason,
            call(quote, booking, reason, 'approved'),
          ]);
  });

  it.each([
    'cancelled',
    'lapsed',
    'confirmed',
    'no_show',
    'completed',
    'awaiting_confirmation',
  ])(
    'reads a waiting quote as waiting whatever a stray %s booking says',
    (booking) => {
      expect(call('waiting', booking, 'cancelled')).toBe('waiting');
    },
  );

  it('reads a suspended garage only as exactly suspended', () => {
    expect(call('waiting', null, null, 'Suspended')).toBe('waiting');
    expect(call('waiting', null, null, '')).toBe('waiting');
  });

  it.each(REASONS.filter((r) => r !== 'account_closed'))(
    'reads a lost quote with an own cancelled booking as a cancelled booking when the request closed as %p',
    (reason) => {
      expect(call('lost', 'cancelled', reason)).toBe('booking_cancelled');
    },
  );

  it('puts the account closing before the own cancelled booking and before a cancelled request', () => {
    expect(call('lost', 'cancelled', 'account_closed')).toBe('account_closed');
    expect(call('lost', null, 'account_closed')).toBe('account_closed');
  });

  it.each([
    'lapsed',
    'confirmed',
    'completed',
    'no_show',
    'awaiting_confirmation',
  ])(
    'reads a lost quote with an own %s booking on a cancelled request as a cancelled request',
    (booking) => {
      expect(call('lost', booking, 'cancelled')).toBe('request_cancelled');
    },
  );

  it.each(REASONS.filter((r) => r !== 'account_closed' && r !== 'cancelled'))(
    'reads a lost quote with no booking and request closing %p as another garage chosen',
    (reason) => {
      expect(call('lost', null, reason)).toBe('chose_other');
    },
  );

  it.each(BOOKING_STATUSES.filter((b) => b !== 'lapsed'))(
    'reads an expired quote with an own %s booking as expired',
    (booking) => {
      expect(call('expired', booking, 'booking_lapsed')).toBe('expired');
    },
  );

  it('reads an expired quote with no booking as expired even when the request closed for a lapsed booking', () => {
    expect(call('expired', null, 'booking_lapsed')).toBe('expired');
  });

  it.each(['account_closed', 'cancelled', 'booking_lapsed', null])(
    'keeps a withdrawn and a driver-declined quote as they are when the request closed as %p',
    (reason) => {
      expect(call('withdrawn', 'cancelled', reason)).toBe('withdrawn');
      expect(call('declined_by_driver', 'cancelled', reason)).toBe('declined');
    },
  );

  it('reads an accepted quote of a suspended garage by its booking', () => {
    expect(call('accepted', 'confirmed', null, 'suspended')).toBe('booked');
    expect(call('accepted', 'awaiting_confirmation', null, 'suspended')).toBe(
      'accepted',
    );
  });

  it('throws on a quote status it does not know', () => {
    expect(() => call('rejected')).toThrow();
    expect(() => call('')).toThrow();
  });

  it('answers the same twice and leaves frozen input untouched', () => {
    const input = Object.freeze({
      booking: Object.freeze({ status: 'confirmed' as const }),
      garage: Object.freeze({ status: 'approved' }),
      quote: Object.freeze({ status: 'accepted' as const }),
      request: Object.freeze({ closedReason: null }),
    });
    expect([outcomeOf(input), outcomeOf(input)]).toEqual(['booked', 'booked']);
  });
});
