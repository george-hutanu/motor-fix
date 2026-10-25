import { HttpException, NotFoundException } from '@nestjs/common';

import {
  type Actor,
  assertGarage,
  assertOwner,
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

// What a refusal answers: its status and the body's code.
function refusalOf(call: () => void) {
  try {
    call();
  } catch (error) {
    const failure = error as HttpException;
    const body = failure.getResponse() as { code?: string };
    return [failure.getStatus(), body.code];
  }
  return null;
}

describe('requireCapability', () => {
  it('lets an owner use the team', () => {
    expect(() =>
      requireCapability(
        actor({ garageId: 'g1', role: 'garage', roles: ['garage'] }),
        'garage.team',
      ),
    ).not.toThrow();
  });

  // @traces 102-FR-007
  it("answers 403 forbidden to the garage's own staff whose role lacks the capability", () => {
    expect(
      refusalOf(() =>
        requireCapability(
          actor({
            garageId: 'g1',
            role: 'receptionist',
            roles: ['receptionist'],
          }),
          'garage.prices',
        ),
      ),
    ).toEqual([403, 'forbidden']);
  });

  // @traces 102-FR-007
  it('answers 404 for a capability outside the table, even to garage staff', () => {
    const owner = actor({ garageId: 'g1', role: 'garage', roles: ['garage'] });

    for (const name of ['garage.everything', '__proto__', undefined]) {
      expect(refusalOf(() => requireCapability(owner, name as never))).toEqual([
        404,
        undefined,
      ]);
    }
  });

  // @traces 102-FR-007
  it('answers 404 to garage staff for a capability that is not a garage one', () => {
    expect(
      refusalOf(() =>
        requireCapability(
          actor({ garageId: 'g1', role: 'garage', roles: ['garage'] }),
          'driver.cars',
        ),
      ),
    ).toEqual([404, undefined]);
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

    // @traces 102-FR-007
    expect(
      refusalOf(() => requireCapability(mechanic, 'garage.requests')),
    ).toEqual([403, 'forbidden']);
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
