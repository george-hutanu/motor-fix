import type { CompareQuoteDto } from '@motor-fix/data-access';

import { rowState } from './compare-rules';

const NOW = new Date('2026-10-17T10:00:00.000Z');

const quote = (
  over: Partial<
    Pick<CompareQuoteDto, 'id' | 'status' | 'expiresAt' | 'slot'>
  > = {},
): Pick<CompareQuoteDto, 'id' | 'status' | 'expiresAt' | 'slot'> => ({
  expiresAt: '2026-10-24T10:00:00.000Z',
  id: 'q-1',
  slot: '2026-10-19T09:00:00.000Z',
  status: 'waiting',
  ...over,
});

const booking = (
  status: 'awaiting_confirmation' | 'confirmed' | 'lapsed' | 'cancelled',
  quoteId?: string,
) => ({
  confirmBy: '2026-10-18T10:00:00.000Z',
  quoteId,
  status,
});

// @traces 314-FR-001
describe('whether a quote may still be accepted, at the boundary', () => {
  it('stops offering Acceptă on the very millisecond the quote expires', () => {
    const q = quote({ expiresAt: NOW.toISOString() });

    expect(rowState(q, null, NOW)).not.toBe('open');
  });

  it('stops offering Acceptă on the very millisecond the slot starts', () => {
    const q = quote({ slot: NOW.toISOString() });

    expect(rowState(q, null, NOW)).not.toBe('open');
  });

  it('keeps Acceptă one millisecond before the slot', () => {
    const q = quote({ slot: '2026-10-17T10:00:00.001Z' });

    expect(rowState(q, null, NOW)).toBe('open');
  });

  it('offers no Acceptă once the slot has passed while the panel stayed open', () => {
    const q = quote({ slot: '2026-10-17T09:59:00.000Z' });

    expect(rowState(q, null, NOW)).not.toBe('open');
  });

  it('offers no Acceptă on a waiting quote with an unreadable slot', () => {
    const q = quote({ slot: 'soon' });

    expect(rowState(q, null, NOW)).not.toBe('open');
  });
});

// @traces 314-FR-008
describe('a lapsed booking, seen on the rows', () => {
  it('shows the lapsed quote’s own row as lapsed, whatever state the quote itself reads', () => {
    expect(
      rowState(
        quote({ id: 'a', status: 'expired' }),
        booking('lapsed', 'a'),
        NOW,
      ),
    ).toBe('lapsed');
  });

  it('offers Acceptă again on another waiting quote', () => {
    expect(rowState(quote({ id: 'b' }), booking('lapsed', 'a'), NOW)).toBe(
      'open',
    );
  });

  it('keeps a quote the driver declined declined after the lapse', () => {
    expect(
      rowState(
        quote({ id: 'b', status: 'declined_by_driver' }),
        booking('lapsed', 'a'),
        NOW,
      ),
    ).toBe('declined');
  });

  it('does not call another expired quote lapsed', () => {
    expect(
      rowState(
        quote({ id: 'b', status: 'expired' }),
        booking('lapsed', 'a'),
        NOW,
      ),
    ).toBe('expired');
  });

  it('does not read a lapse with no quote named as the lapse of every expired row', () => {
    expect(
      rowState(
        quote({ id: 'a', status: 'expired' }),
        booking('lapsed', undefined),
        NOW,
      ),
    ).toBe('expired');
  });

  it('still lets an expired-by-time waiting quote read expired after a lapse', () => {
    expect(
      rowState(
        quote({ expiresAt: '2026-10-17T09:00:00.000Z', id: 'b' }),
        booking('lapsed', 'a'),
        NOW,
      ),
    ).toBe('expired');
  });
});

// @traces 314-FR-006
describe('the other rows while a booking waits or is confirmed', () => {
  it('holds a waiting quote while the booking awaits the garage', () => {
    expect(
      rowState(quote({ id: 'b' }), booking('awaiting_confirmation', 'a'), NOW),
    ).toBe('on_hold');
  });

  it('closes a waiting quote once the booking is confirmed', () => {
    expect(rowState(quote({ id: 'b' }), booking('confirmed', 'a'), NOW)).toBe(
      'closed',
    );
  });

  it('keeps a declined quote declined once the booking is confirmed', () => {
    expect(
      rowState(
        quote({ id: 'b', status: 'declined_by_driver' }),
        booking('confirmed', 'a'),
        NOW,
      ),
    ).toBe('declined');
  });

  it('shows the accepted quote as booked only when the booking is confirmed', () => {
    const accepted = quote({ status: 'accepted' });

    expect(
      rowState(accepted, booking('awaiting_confirmation', 'q-1'), NOW),
    ).toBe('accepted');
    expect(rowState(accepted, booking('confirmed', 'q-1'), NOW)).toBe('booked');
    expect(rowState(accepted, null, NOW)).toBe('accepted');
  });

  it('opens a waiting quote again when the booking was cancelled', () => {
    expect(rowState(quote({ id: 'b' }), booking('cancelled', 'a'), NOW)).toBe(
      'open',
    );
  });
});
