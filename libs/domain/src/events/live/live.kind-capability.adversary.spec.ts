import { EVENT_KINDS } from '@motor-fix/contracts';
import { CAPABILITIES } from '@motor-fix/contracts/capabilities';

import { KIND_CAPABILITY } from './live.hub';

const capabilityOf = (kind: string) =>
  KIND_CAPABILITY.find(([re]) => re.test(kind))?.[1];

describe('the live kind families', () => {
  it.each([
    'booking.move_proposed',
    'booking.moved',
    'booking.move_refused',
    'booking.move_lapsed',
  ])('maps %s to garage.move_bookings', (kind) => {
    expect(capabilityOf(kind)).toBe('garage.move_bookings');
  });

  it.each(['booking.move', 'booking.movement_x', 'booking.move.extra'])(
    'maps the prefix lookalike %s to garage.move_bookings too',
    (kind) => {
      expect(capabilityOf(kind)).toBe('garage.move_bookings');
    },
  );

  it.each([
    'booking.started',
    'booking.confirmed',
    'booking.cancelled',
    'booking.remove',
    'booking.unmoved',
    'xbooking.moved',
  ])('does not map %s to garage.move_bookings', (kind) => {
    expect(capabilityOf(kind)).not.toBe('garage.move_bookings');
  });

  it.each([
    'invite.sent',
    'invite.revoked',
    'invite.accepted',
    'mechanic.updated',
    'member.removed',
  ])('keeps %s behind garage.team so only the owner hears it', (kind) => {
    expect(capabilityOf(kind)).toBe('garage.team');
  });

  it('maps only to capabilities that exist in the table', () => {
    for (const [, c] of KIND_CAPABILITY) expect(CAPABILITIES).toContain(c);
  });

  it('claims no real event kind by two different capabilities', () => {
    for (const kind of EVENT_KINDS) {
      const claims = new Set(
        KIND_CAPABILITY.filter(([re]) => re.test(kind)).map(([, c]) => c),
      );
      expect([kind, claims.size <= 1]).toEqual([kind, true]);
    }
  });

  it('does not let any booking.move* kind of the contract fall to garage.schedule', () => {
    for (const kind of EVENT_KINDS.filter((k) => k.startsWith('booking.move')))
      expect(capabilityOf(kind)).toBe('garage.move_bookings');
  });
});
