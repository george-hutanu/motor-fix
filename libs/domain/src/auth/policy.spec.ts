import { NotFoundException } from '@nestjs/common';

import {
  type Actor,
  assertGarage,
  assertOwner,
  describeCustomer,
  landingFor,
  requireCapability,
  roleInUse,
} from './policy';

const none = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

function actor(overrides: Partial<Actor>): Actor {
  return {
    accountId: 'account-a',
    garageId: null,
    permissions: none,
    role: 'driver',
    roles: ['driver'],
    ...overrides,
  };
}

const customer = {
  car: 'BMW 320d',
  firstName: 'Andrei',
  phone: '+40722000111',
  plate: 'B 123 ABC',
};

describe('role in use', () => {
  it('is the role the token carries when the account still holds it', () => {
    expect(roleInUse('garage', 'driver', ['driver', 'garage'])).toBe('garage');
  });

  it('falls back to the last role when the token role is no longer held', () => {
    expect(roleInUse('garage', 'driver', ['driver'])).toBe('driver');
  });

  it('falls back to admin, garage, receptionist, mechanic, driver in that order', () => {
    expect(roleInUse(null, 'admin', ['driver', 'mechanic'])).toBe('mechanic');
    expect(roleInUse(null, 'driver', ['receptionist', 'admin'])).toBe('admin');
    expect(roleInUse(null, 'mechanic', ['driver', 'garage'])).toBe('garage');
  });

  it('gives no role to an account that holds none', () => {
    expect(roleInUse('garage', 'garage', [])).toBeNull();
  });
});

describe('landing', () => {
  it.each([
    ['driver', '/app/driver'],
    ['garage', '/app/garage'],
    ['receptionist', '/app/garage'],
    ['mechanic', '/app/garage'],
    ['admin', '/app/admin'],
  ] as const)('a %s lands on %s', (role, path) => {
    expect(landingFor(role)).toBe(path);
  });
});

describe('requireCapability', () => {
  it('lets an owner use the team', () => {
    expect(() =>
      requireCapability(
        actor({ garageId: 'g1', role: 'garage', roles: ['garage'] }),
        'garage.team',
      ),
    ).not.toThrow();
  });

  it('answers 404 when the role lacks the capability', () => {
    expect(() =>
      requireCapability(
        actor({
          garageId: 'g1',
          role: 'receptionist',
          roles: ['receptionist'],
        }),
        'garage.prices',
      ),
    ).toThrow(NotFoundException);
  });

  it('answers 404 for a garage capability when the actor has no garage', () => {
    expect(() =>
      requireCapability(
        actor({ role: 'garage', roles: ['garage'] }),
        'garage.team',
      ),
    ).toThrow(NotFoundException);
  });

  it('opens a mechanic capability only with its permission', () => {
    const mechanic = actor({
      garageId: 'g1',
      role: 'mechanic',
      roles: ['mechanic'],
    });

    expect(() => requireCapability(mechanic, 'garage.requests')).toThrow(
      NotFoundException,
    );
    expect(() =>
      requireCapability(
        { ...mechanic, permissions: { ...none, canAnswerQuotes: true } },
        'garage.requests',
      ),
    ).not.toThrow();
  });

  it('uses the role in use, not every role the account holds', () => {
    const mihai = actor({
      garageId: 'g1',
      role: 'driver',
      roles: ['driver', 'garage'],
    });

    expect(() => requireCapability(mihai, 'garage.team')).toThrow(
      NotFoundException,
    );
  });
});

describe('ownership', () => {
  it('lets an account reach its own resource', () => {
    expect(() => assertOwner(actor({}), 'account-a')).not.toThrow();
  });

  it("answers 404 for another account's resource", () => {
    expect(() => assertOwner(actor({}), 'account-b')).toThrow(
      NotFoundException,
    );
  });

  it("answers 404 for another garage's resource", () => {
    const owner = actor({ garageId: 'g1', role: 'garage', roles: ['garage'] });

    expect(() => assertGarage(owner, 'g1')).not.toThrow();
    expect(() => assertGarage(owner, 'g2')).toThrow(NotFoundException);
    expect(() => assertGarage(actor({}), 'g1')).toThrow(NotFoundException);
  });
});

describe('describeCustomer', () => {
  const mechanic = actor({
    garageId: 'g1',
    role: 'mechanic',
    roles: ['mechanic'],
  });

  it('gives a mechanic the first name and the car, never the phone', () => {
    const seen = describeCustomer(mechanic, customer, { ownJob: false });

    expect(seen).toEqual({ car: 'BMW 320d', firstName: 'Andrei' });
    expect(seen).not.toHaveProperty('phone');
  });

  it('adds the plate for a mechanic on their own job, still without the phone', () => {
    const seen = describeCustomer(mechanic, customer, { ownJob: true });

    expect(seen).toEqual({
      car: 'BMW 320d',
      firstName: 'Andrei',
      plate: 'B 123 ABC',
    });
    expect(seen).not.toHaveProperty('phone');
  });

  it.each(['receptionist', 'garage'] as const)(
    'gives a %s the phone and the plate',
    (role) => {
      const staff = actor({ garageId: 'g1', role, roles: [role] });

      expect(describeCustomer(staff, customer, { ownJob: false })).toEqual(
        customer,
      );
    },
  );
});
