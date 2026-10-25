import {
  CAPABILITIES,
  capabilitiesOf,
  type Permissions,
  ROLES,
  type Role,
} from './capabilities';

const none: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const all: Permissions = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};
const OWNER_ONLY = [
  'garage.team',
  'garage.prices',
  'garage.feature_switches',
] as const;

describe('the capabilities table under hostile input', () => {
  it('never lets a mechanic with every permission hold an owner-only capability', () => {
    const held = capabilitiesOf('mechanic', all);

    for (const c of OWNER_ONLY) expect(held).not.toContain(c);
    expect(held).not.toContain('garage.reviews');
    expect(held).not.toContain('garage.profile');
  });

  it('adds exactly the three permission capabilities to a base mechanic', () => {
    const base = capabilitiesOf('mechanic', none);
    const full = capabilitiesOf('mechanic', all);

    expect(full.filter((c) => !base.includes(c)).sort()).toEqual([
      'garage.final_price',
      'garage.move_bookings',
      'garage.requests',
    ]);
  });

  it('grants a mechanic garage.schedule and no booking move without the permission', () => {
    const held = capabilitiesOf('mechanic', none);

    expect(held).toContain('garage.schedule');
    expect(held).not.toContain('garage.move_bookings');
  });

  it('gives a receptionist reviews and profile but never team, prices or switches', () => {
    const held = capabilitiesOf('receptionist', none);

    expect(held).toEqual(
      expect.arrayContaining(['garage.reviews', 'garage.profile']),
    );
    for (const c of OWNER_ONLY) expect(held).not.toContain(c);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty object', {}],
    ['a string', 'all'],
    ['a number', 1],
  ])(
    'grants a mechanic nothing extra for permissions given as %s',
    (_, bad) => {
      expect(capabilitiesOf('mechanic', bad as never)).toEqual(
        capabilitiesOf('mechanic', none),
      );
    },
  );

  it.each([
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['an object', {}],
    ['an array', [true]],
  ])('does not take %s as a ticked permission', (_, value) => {
    const forged = {
      canAnswerQuotes: value,
      canMoveBookings: value,
      canRecordFinalPrice: value,
    } as never;

    expect(capabilitiesOf('mechanic', forged)).toEqual(
      capabilitiesOf('mechanic', none),
    );
  });

  it.each([
    ['an unknown role', 'superuser'],
    ['an empty role', ''],
    ['a prototype key', '__proto__'],
    ['constructor', 'constructor'],
    ['toString', 'toString'],
    ['null', null],
    ['undefined', undefined],
  ])('holds nothing for %s', (_, role) => {
    expect(capabilitiesOf(role as never, all)).toEqual([]);
  });

  it('returns a fresh array so a caller cannot grow the table', () => {
    const first = capabilitiesOf('receptionist', none);
    first.push('garage.team');

    expect(capabilitiesOf('receptionist', none)).not.toContain('garage.team');
    const owner = capabilitiesOf('garage', none);
    owner.length = 0;
    expect(capabilitiesOf('garage', none).length).toBeGreaterThan(5);
  });

  it('answers the same twice and does not depend on key order of the permissions', () => {
    const reordered = {
      canAnswerQuotes: true,
      canMoveBookings: false,
      canRecordFinalPrice: true,
    };

    expect(capabilitiesOf('mechanic', reordered)).toEqual(
      capabilitiesOf('mechanic', reordered),
    );
    expect(capabilitiesOf('mechanic', reordered)).toEqual(
      expect.arrayContaining(['garage.requests', 'garage.final_price']),
    );
  });

  it('ignores extra permission keys', () => {
    const extra = { ...none, canDeleteGarage: true } as never;

    expect(capabilitiesOf('mechanic', extra)).toEqual(
      capabilitiesOf('mechanic', none),
    );
  });

  it('lists each capability once and every held capability is in CAPABILITIES', () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
    for (const role of ROLES as readonly Role[]) {
      const held = capabilitiesOf(role, all);
      expect(new Set(held).size).toBe(held.length);
      for (const c of held) expect(CAPABILITIES).toContain(c);
    }
  });

  it('keeps garage, driver and admin capabilities in separate namespaces per role', () => {
    expect(
      capabilitiesOf('driver', all).every((c) => c.startsWith('driver.')),
    ).toBe(true);
    expect(
      capabilitiesOf('admin', all).every((c) => c.startsWith('admin.')),
    ).toBe(true);
    for (const role of ['garage', 'receptionist', 'mechanic'] as const)
      expect(
        capabilitiesOf(role, all).every((c) => c.startsWith('garage.')),
      ).toBe(true);
  });

  it('gives the owner every garage capability and the admin none of them', () => {
    const garage = CAPABILITIES.filter((c) => c.startsWith('garage.'));

    expect([...capabilitiesOf('garage', none)].sort()).toEqual(
      [...garage].sort(),
    );
    expect(
      capabilitiesOf('admin', all).some((c) => c.startsWith('garage.')),
    ).toBe(false);
  });
});
