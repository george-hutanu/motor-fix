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
    'garage.final_price',
    'garage.own_jobs',
    'garage.reviews',
    'garage.team',
    'garage.prices',
    'garage.profile',
    'garage.feature_switches',
    'garage.audit_history',
  ],
  mechanic: ['garage.own_jobs', 'garage.audit_history'],
  receptionist: [
    'garage.requests',
    'garage.schedule',
    'garage.final_price',
    'garage.own_jobs',
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
    ['canMoveBookings', 'garage.schedule'],
    ['canRecordFinalPrice', 'garage.final_price'],
  ] as const)('a mechanic with %s may use %s and nothing more', (permission, capability) => {
    const mechanic = capabilitiesOf('mechanic', {
      ...none,
      [permission]: true,
    });

    expect([...mechanic].sort()).toEqual(
      ['garage.own_jobs', 'garage.audit_history', capability].sort(),
    );
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
});
