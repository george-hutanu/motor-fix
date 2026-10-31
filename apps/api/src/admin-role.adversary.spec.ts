import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts';
import {
  CAPABILITIES,
  type Capability,
  capabilitiesOf,
  type Permissions,
  ROLES,
  type Role,
} from '@motor-fix/contracts/capabilities';
import {
  type AccountLoader,
  ActorGuard,
  Requires,
  signAccessToken,
} from '@motor-fix/domain';
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const SECRET = 'adversary-secret-adversary-secret';
const ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_CAPS = CAPABILITIES.filter((c) => c.startsWith('admin.'));
const none: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const accepted = (at = new Date()) => [
  { acceptedAt: at, kind: 'terms', textVersion: TERMS_VERSION },
  { acceptedAt: at, kind: 'privacy_notice', textVersion: PRIVACY_VERSION },
];

function account(roles: Role[], lastRole: Role, consents = accepted()) {
  return {
    consents,
    id: ID,
    language: 'en',
    lastRole,
    mechanic: null,
    memberships: [],
    roles: roles.map((role) => ({ role })),
    status: 'active',
  };
}

function guardFor(
  loaded: () => Promise<unknown>,
  maintenanceOn = false,
): ActorGuard {
  return new ActorGuard(
    { activeAccount: loaded } as unknown as AccountLoader,
    { tokenSecret: SECRET } as never,
    { on: async () => maintenanceOn } as never,
    new Reflector(),
  );
}

function handlerRequiring(capability?: Capability) {
  class Controller {
    handle() {
      return undefined;
    }
  }
  if (capability) {
    Requires(capability)(
      Controller.prototype,
      'handle',
      Object.getOwnPropertyDescriptor(
        Controller.prototype,
        'handle',
      ) as PropertyDescriptor,
    );
  }
  return Controller;
}

function contextOf(
  controller: ReturnType<typeof handlerRequiring>,
  authorization?: string,
) {
  const request: Record<string, unknown> = {
    header: (name: string) =>
      name.toLowerCase() === 'authorization' ? authorization : undefined,
    path: '/api/v1/admin/x',
  };
  return {
    context: {
      getClass: () => controller,
      getHandler: () => controller.prototype.handle,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
    request,
  };
}

const decide = async (
  guard: ActorGuard,
  capability: Capability | undefined,
  authorization?: string,
) => {
  const { context } = contextOf(handlerRequiring(capability), authorization);
  try {
    return String(await guard.canActivate(context));
  } catch (e) {
    const refusal = e as HttpException;
    const body = refusal.getResponse() as { code?: string };
    return `${refusal.getStatus()} ${body.code ?? 'not_found'}`;
  }
};

const bearer = (role: Role) =>
  `Bearer ${signAccessToken({ accountId: ID, role }, SECRET)}`;

describe('the admin role under hostile input', () => {
  // @traces 165-FR-001
  it('keeps the admin row identical for any permissions value, including null', () => {
    const expected = [...ADMIN_CAPS].sort();

    for (const permissions of [none, null, undefined, {}]) {
      expect(
        capabilitiesOf('admin', permissions as unknown as Permissions).sort(),
      ).toEqual(expected);
    }
  });

  // @traces 165-FR-001
  it('hands back a fresh admin list so a caller cannot widen another role by mutating it', () => {
    const first = capabilitiesOf('admin', none);
    first.push('driver.cars', 'garage.team');
    first.length = 0;

    expect(capabilitiesOf('admin', none).sort()).toEqual(
      [...ADMIN_CAPS].sort(),
    );
  });

  // @traces 165-FR-001
  it.each([
    'Admin',
    'ADMIN',
    ' admin',
    'admin ',
    '__proto__',
    'constructor',
    'toString',
    '',
  ])('gives no capability to the role name %j', (role) => {
    expect(capabilitiesOf(role as Role, none)).toEqual([]);
  });

  // @traces 165-FR-001
  it('lists exactly the six admin capabilities, each once, in no other role', () => {
    expect(ADMIN_CAPS.sort()).toEqual([
      'admin.audit_history',
      'admin.catalogue',
      'admin.garages',
      'admin.reviews',
      'admin.settings',
      'admin.users',
    ]);
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      for (const permissions of [none, { ...none, canMoveBookings: true }]) {
        expect(
          capabilitiesOf(role, permissions).filter((c) =>
            c.startsWith('admin.'),
          ),
        ).toEqual([]);
      }
    }
  });
});

describe('the access check for admin routes', () => {
  // @traces 165-FR-002
  it.each([undefined, ...ADMIN_CAPS])(
    'admits an active admin on a route requiring %s',
    async (capability) => {
      const guard = guardFor(async () => account(['admin'], 'admin'));

      expect(await decide(guard, capability, bearer('admin'))).toBe('true');
    },
  );

  // @traces 165-FR-002
  it('sets the admin actor on the request when it admits', async () => {
    const guard = guardFor(async () => account(['admin'], 'admin'));
    const { context, request } = contextOf(
      handlerRequiring('admin.users'),
      bearer('admin'),
    );

    await guard.canActivate(context);

    expect(request.actor).toMatchObject({ accountId: ID, role: 'admin' });
  });

  // @traces 165-FR-002
  it('admits an admin whose token names a role the account no longer holds', async () => {
    const guard = guardFor(async () => account(['admin'], 'admin'));

    expect(await decide(guard, 'admin.garages', bearer('driver'))).toBe('true');
  });

  // @traces 165-FR-004
  it('answers not_found to an admin and driver account acting as driver', async () => {
    const guard = guardFor(async () => account(['admin', 'driver'], 'admin'));

    expect(await decide(guard, 'admin.garages', bearer('driver'))).toBe(
      '404 not_found',
    );
  });

  // @traces 165-FR-004
  it.each(['driver', 'garage', 'receptionist', 'mechanic'] as Role[])(
    'answers not_found to a %s on every admin capability',
    async (role) => {
      const guard = guardFor(async () => account([role], role));
      const answers = await Promise.all(
        ADMIN_CAPS.map((c) => decide(guard, c, bearer(role))),
      );

      expect(answers).toEqual(ADMIN_CAPS.map(() => '404 not_found'));
    },
  );

  // @traces 165-FR-004
  it('answers not_found to an admin on a garage capability, never a 403', async () => {
    const guard = guardFor(async () => account(['admin'], 'admin'));

    expect(await decide(guard, 'garage.team', bearer('admin'))).toBe(
      '404 not_found',
    );
  });

  // @traces 165-FR-004
  it.each([
    ['no header', undefined],
    ['empty header', ''],
    ['Basic scheme', 'Basic abc'],
    ['bearer with no token', 'Bearer '],
    ['lowercase scheme', `bearer ${bearer('admin').slice(7)}`],
    ['two tokens', `${bearer('admin')} extra`],
    ['none algorithm', 'Bearer eyJhbGciOiJub25lIn0.e30.'],
    ['garbage', 'Bearer not.a.jwt'],
    [
      'wrong secret',
      `Bearer ${signAccessToken({ accountId: ID, role: 'admin' }, 'other-secret-other-secret-xx')}`,
    ],
    [
      'expired',
      `Bearer ${signAccessToken({ accountId: ID, role: 'admin' }, SECRET, 0)}`,
    ],
  ])(
    'answers sign_in_required without loading the account for %s',
    async (_, header) => {
      const load = jest.fn(async () => account(['admin'], 'admin'));
      const guard = guardFor(load);

      expect(await decide(guard, 'admin.users', header)).toBe(
        '401 sign_in_required',
      );
      expect(load).not.toHaveBeenCalled();
    },
  );

  // @traces 165-FR-004
  it('answers sign_in_required for an account holding no role', async () => {
    const guard = guardFor(async () => account([], 'admin'));

    expect(await decide(guard, 'admin.users', bearer('admin'))).toBe(
      '401 sign_in_required',
    );
  });

  // @traces 165-FR-004
  it('passes the loader refusal for a suspended admin through unchanged', async () => {
    const suspended = new HttpException(
      { code: 'account_suspended', message: 'This account is suspended' },
      403,
    );
    const guard = guardFor(async () => {
      throw suspended;
    });

    expect(await decide(guard, 'admin.users', bearer('admin'))).toBe(
      '403 account_suspended',
    );
  });

  // @traces 165-FR-004
  it('answers consent_required to an admin who has not accepted the current terms', async () => {
    const stale = [
      { acceptedAt: new Date(), kind: 'terms', textVersion: 'v0-old' },
      {
        acceptedAt: new Date(),
        kind: 'privacy_notice',
        textVersion: PRIVACY_VERSION,
      },
    ];
    const guard = guardFor(async () => account(['admin'], 'admin', stale));

    expect(await decide(guard, 'admin.users', bearer('admin'))).toMatch(
      /^\d{3} consent_required$/,
    );
  });

  // @traces 165-FR-004
  it('answers consent_required to an admin with no acceptances at all', async () => {
    const guard = guardFor(async () => account(['admin'], 'admin', []));

    expect(await decide(guard, undefined, bearer('admin'))).toMatch(
      /consent_required$/,
    );
  });

  // @traces 165-FR-002
  it('keeps admitting an admin while the platform is in maintenance', async () => {
    const guard = guardFor(async () => account(['admin'], 'admin'), true);

    expect(await decide(guard, 'admin.settings', bearer('admin'))).toBe('true');
  });

  // @traces 165-FR-004
  it('refuses a non-admin with maintenance while the platform is in maintenance', async () => {
    const guard = guardFor(async () => account(['driver'], 'driver'), true);

    expect(await decide(guard, 'admin.settings', bearer('driver'))).toBe(
      '503 maintenance',
    );
  });

  // @traces 165-FR-002
  it('gives the same answer when the same admin calls twice', async () => {
    const guard = guardFor(async () => account(['admin'], 'admin'));
    const header = bearer('admin');

    const answers = [
      await decide(guard, 'admin.users', header),
      await decide(guard, 'admin.users', header),
    ];

    expect(answers).toEqual(['true', 'true']);
  });
});

describe('the OpenAPI admin operations', () => {
  const doc = JSON.parse(
    readFileSync(join(__dirname, '..', 'openapi.json'), 'utf8'),
  ) as { paths: Record<string, Record<string, unknown>> };
  const verbs = [
    'get',
    'put',
    'post',
    'delete',
    'options',
    'head',
    'patch',
    'trace',
  ];
  const operations = Object.entries(doc.paths)
    .filter(([path]) => path.includes('/admin'))
    .flatMap(([path, item]) =>
      Object.keys(item)
        .filter((k) => verbs.includes(k))
        .map((method) => ({ method, path })),
    );

  // @traces 165-FR-002
  it('puts every admin operation under the versioned admin prefix', () => {
    expect(
      operations.filter((o) => !o.path.startsWith('/api/v1/admin/')),
    ).toEqual([]);
  });

  // @traces 165-FR-002
  it('publishes at least the 54 admin operations known when the walk was written', () => {
    expect(operations.length).toBeGreaterThanOrEqual(54);
  });

  // @traces 165-FR-002
  it('declares no admin operation twice and none with an empty segment', () => {
    const keys = operations.map((o) => `${o.method} ${o.path}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(operations.filter((o) => o.path.includes('//'))).toEqual([]);
  });

  // @traces 165-FR-002
  it('marks no admin operation as public', () => {
    const open = operations.filter(({ method, path }) => {
      const op = doc.paths[path][method] as { security?: unknown[] };
      return Array.isArray(op.security) && op.security.length === 0;
    });

    expect(open).toEqual([]);
  });
});
