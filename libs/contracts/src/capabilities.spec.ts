// @traces 102-FR-001
// @traces 102-FR-002
// @traces 1381-FR-005
import { CAPABILITIES, capabilitiesOf, ROLES } from './capabilities';

const none = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const granted = {
  admin: [
    'admin.garages',
    'admin.users',
    'admin.reviews',
    'admin.catalogue',
    'admin.settings',
    'admin.audit_history',
  ],
  driver: [
    'driver.requests',
    'driver.cars',
    'driver.reviews',
    'driver.saved_garages',
    'driver.settings',
  ],
  garage: [
    'garage.requests',
    'garage.schedule',
    'garage.move_bookings',
    'garage.final_price',
    'garage.own_jobs',
    'garage.reviews',
    'garage.team',
    'garage.prices',
    'garage.profile',
    'garage.feature_switches',
    'garage.audit_history',
  ],
  mechanic: ['garage.own_jobs', 'garage.schedule', 'garage.audit_history'],
  receptionist: [
    'garage.requests',
    'garage.schedule',
    'garage.move_bookings',
    'garage.final_price',
    'garage.own_jobs',
    'garage.reviews',
    'garage.profile',
    'garage.audit_history',
  ],
} as const;

describe('capabilities by role', () => {
  it('knows the five roles', () => {
    expect([...ROLES].sort()).toEqual(
      ['admin', 'driver', 'garage', 'mechanic', 'receptionist'].sort(),
    );
  });

  for (const role of ROLES) {
    const mine: readonly string[] = granted[role];
    for (const capability of CAPABILITIES) {
      const may = mine.includes(capability);
      it(`a ${role} ${may ? 'may' : 'may not'} use ${capability}`, () => {
        expect(capabilitiesOf(role, none).includes(capability)).toBe(may);
      });
    }
  }

  it.each([
    ['canAnswerQuotes', 'garage.requests'],
    ['canMoveBookings', 'garage.move_bookings'],
    ['canRecordFinalPrice', 'garage.final_price'],
  ] as const)(
    'a mechanic with %s may use %s and nothing more',
    (permission, capability) => {
      const mechanic = capabilitiesOf('mechanic', {
        ...none,
        [permission]: true,
      });

      expect([...mechanic].sort()).toEqual(
        [...granted.mechanic, capability].sort(),
      );
    },
  );

  it.each([
    ['canAnswerQuotes', 'garage.requests'],
    ['canMoveBookings', 'garage.move_bookings'],
    ['canRecordFinalPrice', 'garage.final_price'],
  ] as const)(
    'a mechanic without %s may not use %s',
    (permission, capability) => {
      const others = {
        canAnswerQuotes: true,
        canMoveBookings: true,
        canRecordFinalPrice: true,
        [permission]: false,
      };

      expect(capabilitiesOf('mechanic', others)).not.toContain(capability);
    },
  );

  it('lists garage.move_bookings among the capabilities', () => {
    expect(CAPABILITIES).toContain('garage.move_bookings');
  });

  it('ignores mechanic permissions for every other role', () => {
    const all = {
      canAnswerQuotes: true,
      canMoveBookings: true,
      canRecordFinalPrice: true,
    };

    expect(capabilitiesOf('driver', all)).toEqual(
      capabilitiesOf('driver', none),
    );
    expect(capabilitiesOf('receptionist', all)).toEqual(
      capabilitiesOf('receptionist', none),
    );
  });

  it("gives a role outside the five, the system's own actor, nothing", () => {
    expect(capabilitiesOf('system' as never, none)).toEqual([]);
  });
});
