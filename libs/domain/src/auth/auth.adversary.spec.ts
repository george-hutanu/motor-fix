import { createHmac } from 'node:crypto';

import { NotFoundException } from '@nestjs/common';

import { signAccessToken, verifyAccessToken } from './access-token';
import { CAPABILITIES, capabilitiesOf, ROLES, type Role } from './capabilities';
import {
  type Actor,
  assertGarage,
  assertOwner,
  describeCustomer,
  requireCapability,
  roleInUse,
} from './policy';

const secret = 'adversary-secret';
const now = Date.UTC(2026, 9, 4, 12, 0, 0);
const id = '0b6c4c8e-0f0c-4f53-9d53-0d5b8a4f1e11';
const off = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const on = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function forge(
  header: unknown,
  payload: unknown,
  key = secret,
  rawPayload?: string,
) {
  const head = b64(header);
  const body = rawPayload ?? b64(payload);
  const sig = createHmac('sha256', key)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

const hs256 = { alg: 'HS256', typ: 'JWT' };
const goodClaims = (over: Record<string, unknown> = {}) => ({
  exp: Math.floor(now / 1000) + 900,
  iat: Math.floor(now / 1000),
  role: 'driver',
  sub: id,
  ...over,
});

function actor(over: Partial<Actor>): Actor {
  return {
    accountId: 'account-a',
    garageId: null,
    permissions: off,
    role: 'driver',
    roles: ['driver'],
    ...over,
  };
}

describe('access token verification against forged tokens', () => {
  it('accepts a correctly forged baseline so the attacks below are meaningful', () => {
    expect(verifyAccessToken(forge(hs256, goodClaims()), secret, now)).toEqual({
      accountId: id,
      expiresAt: expect.any(Number),
      role: 'driver',
    });
  });

  it('refuses an alg none token with an empty signature', () => {
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(goodClaims())}.`;

    expect(verifyAccessToken(token, secret, now)).toBeNull();
  });

  it('refuses a token whose header says none even when the signature matches', () => {
    expect(
      verifyAccessToken(
        forge({ alg: 'none', typ: 'JWT' }, goodClaims()),
        secret,
        now,
      ),
    ).toBeNull();
  });

  it('refuses a token whose header names another algorithm', () => {
    expect(
      verifyAccessToken(
        forge({ alg: 'HS512', typ: 'JWT' }, goodClaims()),
        secret,
        now,
      ),
    ).toBeNull();
  });

  it('refuses a token without an expiry', () => {
    const { exp: _exp, ...claims } = goodClaims();

    expect(verifyAccessToken(forge(hs256, claims), secret, now)).toBeNull();
  });

  it.each([
    ['a string', '9999999999'],
    ['null', null],
    ['an object', {}],
    ['a boolean', true],
  ])('refuses a token whose expiry is %s', (_, exp) => {
    expect(
      verifyAccessToken(forge(hs256, goodClaims({ exp })), secret, now),
    ).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['a number', 42],
    ['an empty string', ''],
    ['null', null],
  ])('refuses a token whose subject is %s', (_, sub) => {
    expect(
      verifyAccessToken(forge(hs256, goodClaims({ sub })), secret, now),
    ).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['a number', 1],
    ['an array', ['admin']],
    ['upper case', 'ADMIN'],
  ])('refuses a token whose role is %s', (_, role) => {
    expect(
      verifyAccessToken(forge(hs256, goodClaims({ role })), secret, now),
    ).toBeNull();
  });

  it('refuses a signed payload that is not JSON', () => {
    expect(
      verifyAccessToken(
        forge(hs256, null, secret, b64('x').slice(2)),
        secret,
        now,
      ),
    ).toBeNull();
    expect(
      verifyAccessToken(forge(hs256, null, secret, 'e30'), secret, now),
    ).toBeNull();
  });

  it.each([
    ['null'],
    ['[]'],
    ['"text"'],
    ['42'],
  ])('refuses a signed payload of %s', (json) => {
    const raw = Buffer.from(json).toString('base64url');

    expect(
      verifyAccessToken(forge(hs256, null, secret, raw), secret, now),
    ).toBeNull();
  });

  it('refuses a token whose signature is one character short or one longer', () => {
    const token = forge(hs256, goodClaims());

    expect(verifyAccessToken(token.slice(0, -1), secret, now)).toBeNull();
    expect(verifyAccessToken(`${token}A`, secret, now)).toBeNull();
    expect(verifyAccessToken(`${token}=`, secret, now)).toBeNull();
  });

  it('refuses a token whose signature was swapped for another of the same length', () => {
    const [head, body, sig] = forge(hs256, goodClaims()).split('.');
    const flipped = `${sig?.[0] === 'A' ? 'B' : 'A'}${sig?.slice(1)}`;

    expect(
      verifyAccessToken(`${head}.${body}.${flipped}`, secret, now),
    ).toBeNull();
  });

  it.each([
    null,
    undefined,
    42,
    {},
    [],
  ])('refuses the non-string token %p without throwing', (token) => {
    expect(
      verifyAccessToken(token as unknown as string, secret, now),
    ).toBeNull();
  });

  it('refuses a five megabyte junk token without throwing', () => {
    expect(
      verifyAccessToken(
        `${'A'.repeat(5_000_000)}.${'B'.repeat(10)}.C`,
        secret,
        now,
      ),
    ).toBeNull();
  });

  it('refuses a token with unicode and null bytes in its parts', () => {
    expect(verifyAccessToken('ăâî.șț\u0000.€', secret, now)).toBeNull();
  });

  it('returns exactly the account and role for a token with a very large extra claim', () => {
    const token = forge(
      hs256,
      goodClaims({ admin: true, padding: 'x'.repeat(2_000_000) }),
    );

    expect(verifyAccessToken(token, secret, now)).toEqual({
      accountId: id,
      expiresAt: expect.any(Number),
      role: 'driver',
    });
  });

  it('refuses a token signed with zero or negative minutes of life', () => {
    expect(
      verifyAccessToken(
        signAccessToken({ accountId: id, role: 'driver' }, secret, now, 0),
        secret,
        now,
      ),
    ).toBeNull();
    expect(
      verifyAccessToken(
        signAccessToken({ accountId: id, role: 'driver' }, secret, now, -5),
        secret,
        now,
      ),
    ).toBeNull();
  });

  it('refuses a valid token under an empty secret and a different secret of the same length', () => {
    const token = signAccessToken(
      { accountId: id, role: 'driver' },
      secret,
      now,
    );

    expect(verifyAccessToken(token, '', now)).toBeNull();
    expect(verifyAccessToken(token, 'x'.repeat(secret.length), now)).toBeNull();
  });

  it('gives the same answer when the same token is verified twice', () => {
    const token = signAccessToken(
      { accountId: id, role: 'admin' },
      secret,
      now,
    );

    expect(verifyAccessToken(token, secret, now)).toEqual(
      verifyAccessToken(token, secret, now),
    );
  });
});

describe('capability table boundaries', () => {
  it('never gives a driver a garage or admin capability, whatever the permissions', () => {
    for (const permissions of [off, on]) {
      const held = capabilitiesOf('driver', permissions);
      expect(held.filter((c) => !c.startsWith('driver.'))).toEqual([]);
    }
  });

  it('never gives a garage or admin role a driver capability', () => {
    for (const role of [
      'garage',
      'receptionist',
      'mechanic',
      'admin',
    ] as const) {
      expect(
        capabilitiesOf(role, on).filter((c) => c.startsWith('driver.')),
      ).toEqual([]);
    }
  });

  it('gives an admin only admin capabilities', () => {
    expect(
      capabilitiesOf('admin', on).every((c) => c.startsWith('admin.')),
    ).toBe(true);
  });

  it('keeps every owner-only capability away from a mechanic with all permissions on', () => {
    const held = capabilitiesOf('mechanic', on);

    for (const c of [
      'garage.team',
      'garage.prices',
      'garage.profile',
      'garage.feature_switches',
      'garage.reviews',
    ]) {
      expect(held).not.toContain(c);
    }
    expect([...held].sort()).toEqual([
      'garage.audit_history',
      'garage.final_price',
      'garage.own_jobs',
      'garage.requests',
      'garage.schedule',
    ]);
  });

  it('opens each mechanic capability only through its own permission', () => {
    expect(
      [...capabilitiesOf('mechanic', { ...off, canMoveBookings: true })].sort(),
    ).toEqual(['garage.audit_history', 'garage.own_jobs', 'garage.schedule']);
    expect(
      [...capabilitiesOf('mechanic', { ...off, canAnswerQuotes: true })].sort(),
    ).toEqual(['garage.audit_history', 'garage.own_jobs', 'garage.requests']);
    expect(
      [
        ...capabilitiesOf('mechanic', { ...off, canRecordFinalPrice: true }),
      ].sort(),
    ).toEqual([
      'garage.audit_history',
      'garage.final_price',
      'garage.own_jobs',
    ]);
  });

  it('gives a mechanic only the base capabilities when the permissions are missing or not true booleans', () => {
    expect(capabilitiesOf('mechanic', {} as never)).toEqual([
      'garage.own_jobs',
      'garage.audit_history',
    ]);
    expect(capabilitiesOf('mechanic', null as never)).toEqual([
      'garage.own_jobs',
      'garage.audit_history',
    ]);
    expect(
      capabilitiesOf('mechanic', {
        canAnswerQuotes: 'false',
        canMoveBookings: 1,
        canRecordFinalPrice: {},
      } as never),
    ).toEqual(['garage.own_jobs', 'garage.audit_history']);
  });

  it('ignores mechanic permissions for the other roles', () => {
    for (const role of ROLES as readonly Role[]) {
      if (role === 'mechanic') continue;
      expect([...capabilitiesOf(role, off)].sort()).toEqual(
        [...capabilitiesOf(role, on)].sort(),
      );
    }
  });

  it('returns a fresh list without duplicates on every call', () => {
    for (const role of ROLES as readonly Role[]) {
      const first = capabilitiesOf(role, on);
      expect(new Set(first).size).toBe(first.length);
      first.push('admin.users');
      first.length = 0;
      expect(capabilitiesOf(role, on).length).toBeGreaterThan(0);
    }
  });

  it('returns only capabilities that exist in the table', () => {
    for (const role of ROLES as readonly Role[]) {
      for (const c of capabilitiesOf(role, on))
        expect(CAPABILITIES).toContain(c);
    }
  });

  it('answers 404 for a capability that is not in the table', () => {
    const owner = actor({ garageId: 'g1', role: 'garage', roles: ['garage'] });

    expect(() =>
      requireCapability(owner, 'garage.everything' as never),
    ).toThrow(NotFoundException);
    expect(() => requireCapability(owner, undefined as never)).toThrow(
      NotFoundException,
    );
    expect(() => requireCapability(owner, '__proto__' as never)).toThrow(
      NotFoundException,
    );
  });

  it('answers 404 for a mechanic own-jobs call without a garage', () => {
    expect(() =>
      requireCapability(
        actor({ role: 'mechanic', roles: ['mechanic'] }),
        'garage.own_jobs',
      ),
    ).toThrow(NotFoundException);
  });

  it('answers 404 for an admin capability to a driver who also holds admin but acts as driver', () => {
    expect(() =>
      requireCapability(
        actor({ role: 'driver', roles: ['driver', 'admin'] }),
        'admin.users',
      ),
    ).toThrow(NotFoundException);
  });
});

describe('policy boundaries', () => {
  it('refuses a null or undefined resource id even when the actor has no garage', () => {
    expect(() =>
      assertGarage(actor({ garageId: null }), null as never),
    ).toThrow(NotFoundException);
    expect(() =>
      assertGarage(actor({ garageId: null }), undefined as never),
    ).toThrow(NotFoundException);
    expect(() => assertGarage(actor({ garageId: 'g1' }), '' as never)).toThrow(
      NotFoundException,
    );
  });

  it('refuses a missing or empty owner id', () => {
    expect(() => assertOwner(actor({}), undefined as never)).toThrow(
      NotFoundException,
    );
    expect(() => assertOwner(actor({}), null as never)).toThrow(
      NotFoundException,
    );
    expect(() => assertOwner(actor({}), '')).toThrow(NotFoundException);
  });

  it('does not treat a padded or differently cased id as the same resource', () => {
    expect(() => assertOwner(actor({}), ' account-a')).toThrow(
      NotFoundException,
    );
    expect(() => assertOwner(actor({}), 'account-a ')).toThrow(
      NotFoundException,
    );
    expect(() => assertGarage(actor({ garageId: 'g1' }), 'G1')).toThrow(
      NotFoundException,
    );
  });

  it('uses the token role when held, even if the last role is another held role', () => {
    expect(roleInUse('driver', 'admin', ['driver', 'admin'])).toBe('driver');
  });

  it('uses the last role when no token role is given and the last role is held', () => {
    expect(roleInUse(null, 'mechanic', ['driver', 'garage', 'mechanic'])).toBe(
      'mechanic',
    );
  });

  it('picks the same role for the same input in any order of held roles', () => {
    expect(
      roleInUse(null, 'receptionist', ['driver', 'mechanic', 'garage']),
    ).toBe('garage');
    expect(
      roleInUse(null, 'receptionist', ['garage', 'mechanic', 'driver']),
    ).toBe('garage');
  });

  it('falls back when the token role is held but the token is for a role outside the held list', () => {
    expect(roleInUse('admin', 'driver', ['driver', 'mechanic'])).toBe('driver');
  });

  it('keeps a customer view free of extra fields on the input for a mechanic', () => {
    const mechanic = actor({
      garageId: 'g1',
      role: 'mechanic',
      roles: ['mechanic'],
    });
    const seen = describeCustomer(
      mechanic,
      {
        car: 'Dacia Logan',
        email: 'a@b.ro',
        firstName: 'Ana',
        phone: '+40700000000',
        plate: 'B 1 XYZ',
      } as never,
      { ownJob: false },
    );

    expect(seen).toEqual({ car: 'Dacia Logan', firstName: 'Ana' });
    expect(JSON.stringify(seen)).not.toContain('40700000000');
  });

  it('does not change the customer it describes', () => {
    const mechanic = actor({
      garageId: 'g1',
      role: 'mechanic',
      roles: ['mechanic'],
    });
    const customer = Object.freeze({
      car: 'Dacia Logan',
      firstName: 'Ana',
      phone: '+40700000000',
      plate: 'B 1 XYZ',
    });

    expect(() =>
      describeCustomer(mechanic, customer, { ownJob: true }),
    ).not.toThrow();
    expect(customer.phone).toBe('+40700000000');
  });

  it('gives a mechanic without a plate on the input no plate key on their own job', () => {
    const mechanic = actor({
      garageId: 'g1',
      role: 'mechanic',
      roles: ['mechanic'],
    });
    const seen = describeCustomer(
      mechanic,
      { car: 'Dacia', firstName: 'Ana', phone: '1', plate: undefined as never },
      { ownJob: true },
    );

    expect(seen).not.toHaveProperty('phone');
    expect(Object.keys(seen).sort()).not.toContain('phone');
  });

  it('treats a mechanic with permissions on exactly like one with them off for the phone', () => {
    const mechanic = actor({
      garageId: 'g1',
      permissions: on,
      role: 'mechanic',
      roles: ['mechanic'],
    });
    const seen = describeCustomer(
      mechanic,
      { car: 'Dacia', firstName: 'Ana', phone: '1', plate: 'B 1 A' },
      { ownJob: false },
    );

    expect(seen).toEqual({ car: 'Dacia', firstName: 'Ana' });
  });
});
