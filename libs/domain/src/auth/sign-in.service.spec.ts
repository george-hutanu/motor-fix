import { HttpException, Logger } from '@nestjs/common';

import type { AuthOptions } from './actor.guard';
import type { Attempts } from './attempts';
import type { Forwarding } from './forwarding';
import type { Maintenance } from './maintenance';
import { SignInService } from './sign-in.service';
import type { AuditPort } from '../audit/audit.port';
import type { EventPort } from '../events/event.port';
import type { LivePublisher } from '../events/live/live.hub';
import type { PrismaClient } from '../generated/prisma/client';

const EMAIL = 'andrei@example.test';
const PASSWORD = 'secret-typo';

function service(blocked: boolean) {
  const attempts = {
    blocked: jest.fn(async () => blocked),
    clear: jest.fn(async () => undefined),
    fail: jest.fn(async () => undefined),
  };
  const prisma = { account: { findUnique: async () => null } };
  const signIns = new SignInService(
    prisma as unknown as PrismaClient,
    { tokenSecret: 'test-secret' } as AuthOptions,
    { on: async () => false } as unknown as Maintenance,
    attempts as unknown as Attempts,
    {} as AuditPort,
    {} as EventPort,
    {} as LivePublisher,
  );
  return { attempts, signIns };
}

async function refusal(
  blocked: boolean,
  address: string,
  forwarding?: Forwarding,
) {
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        lines.push(JSON.stringify(args));
      });
  }
  const { attempts, signIns } = service(blocked);
  const error = await signIns
    .signIn({ email: EMAIL, password: PASSWORD }, address, forwarding)
    .catch((e: unknown) => e);
  return { attempts, code: codeOf(error), lines };
}

function codeOf(error: unknown) {
  return error instanceof HttpException
    ? (error.getResponse() as { code: string }).code
    : error;
}

afterEach(() => jest.restoreAllMocks());

// @traces 500-FR-005
describe('a refused sign-in names its caller masked', () => {
  it('on wrong credentials', async () => {
    const { attempts, code, lines } = await refusal(false, '203.0.113.9');

    expect(code).toBe('invalid_credentials');
    expect(lines).toEqual([
      JSON.stringify(['sign-in refused: invalid_credentials caller=203.0.x.x']),
    ]);
    expect(attempts.fail).toHaveBeenCalledWith(EMAIL, '203.0.113.9');
  });

  it('on too many attempts', async () => {
    const { code, lines } = await refusal(true, '203.0.113.9');

    expect(code).toBe('too_many_attempts');
    expect(lines).toEqual([
      JSON.stringify(['sign-in refused: too_many_attempts caller=203.0.x.x']),
    ]);
  });

  it('for an IPv6 caller', async () => {
    const { lines } = await refusal(false, '2a02:2f0c:1234:5678::9');

    expect(lines.join('\n')).toContain('caller=2a02:2f0c:x:x:x:x:x:x');
  });

  it('as unknown when the address cannot be read', async () => {
    const { lines } = await refusal(false, '');

    expect(lines.join('\n')).toContain('caller=unknown');
  });

  it.each([
    [false, '203.0.113.9'],
    [true, '203.0.113.9'],
    [false, '2a02:2f0c:1234:5678::9'],
  ])(
    'never writes the address, e-mail or password (blocked: %s, %s)',
    async (blocked, address) => {
      const { lines } = await refusal(blocked, address);

      const all = lines.join('\n');
      expect(all).not.toContain(address);
      expect(all).not.toContain('113.9');
      expect(all).not.toMatch(/andrei|secret-typo|1234:5678/);
    },
  );
});

// @traces 500-FR-011
describe('a refused sign-in also names the forwarding facts, masked', () => {
  const VISITOR = '86.125.92.213';
  const EDGE = '95.173.10.20';
  const SOCKET = 'fd12:3456::1';
  const chain = {
    headers: { 'x-forwarded-for': `${VISITOR}, ${EDGE}` },
    socket: SOCKET,
  };

  it.each([
    [false, 'invalid_credentials'],
    [true, 'too_many_attempts'],
  ])(
    'on the same line as the caller (blocked: %s)',
    async (blocked, reason) => {
      const { lines } = await refusal(blocked, VISITOR, chain);

      expect(lines).toEqual([
        JSON.stringify([
          `sign-in refused: ${reason} caller=86.125.x.x hops=86.125.x.x,95.173.x.x,fd12:3456:x:x:x:x:x:x headers=x-forwarded-for`,
        ]),
      ]);
    },
  );

  it('with x-real-ip, Forwarded and the other forwarding header names', async () => {
    const { lines } = await refusal(false, EDGE, {
      headers: {
        forwarded: 'for="[2a02:2f0c::1]:4711"',
        'x-forwarded-for': `${VISITOR}, ${EDGE}`,
        'x-forwarded-proto': 'https',
        'x-railway-edge': 'europe-west4',
        'x-real-ip': VISITOR,
      },
      socket: SOCKET,
    });

    expect(lines).toEqual([
      JSON.stringify([
        'sign-in refused: invalid_credentials caller=95.173.x.x hops=86.125.x.x,95.173.x.x,fd12:3456:x:x:x:x:x:x headers=forwarded,x-forwarded-for,x-forwarded-proto,x-railway-edge,x-real-ip real-ip=86.125.x.x forwarded=2a02:2f0c:x:x:x:x:x:x',
      ]),
    ]);
  });

  it('shows a forged chain masked and leaves the caller as resolved', async () => {
    const { lines } = await refusal(false, VISITOR, {
      headers: { 'x-forwarded-for': `spoof, 1.2.3.4, ${VISITOR}, ${EDGE}` },
      socket: SOCKET,
    });

    expect(lines.join('\n')).toContain(
      'caller=86.125.x.x hops=unknown,1.2.x.x,86.125.x.x,95.173.x.x,fd12:3456:x:x:x:x:x:x',
    );
  });

  it.each([false, true])(
    'never writes a full address, the e-mail or the password (blocked: %s)',
    async (blocked) => {
      const { lines } = await refusal(blocked, VISITOR, {
        headers: {
          forwarded: `for=${VISITOR}`,
          'x-forwarded-for': `1.2.3.4, ${VISITOR}, ${EDGE}`,
          'x-real-ip': VISITOR,
        },
        socket: SOCKET,
      });

      const all = lines.join('\n');
      for (const address of [VISITOR, EDGE, SOCKET, '1.2.3.4'])
        expect(all).not.toContain(address);
      expect(all).not.toMatch(/92\.213|10\.20|3456::1|andrei|secret-typo/);
    },
  );
});

// @traces 500-FR-005
describe('a successful sign-in', () => {
  it('logs no line that names its caller', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push(JSON.stringify(args));
        });
    }
    const { attempts, signIns } = service(false);
    const inner = signIns as unknown as {
      credentials: () => Promise<unknown>;
    };
    jest.spyOn(inner, 'credentials').mockResolvedValue({
      account: { id: 'acc-1', roles: [], status: 'active' },
      role: 'driver',
    } as never);
    jest
      .spyOn(signIns, 'openSession')
      .mockResolvedValue({ accessToken: 't', remember: true } as never);

    const issued = await signIns.signIn(
      { email: EMAIL, password: PASSWORD },
      '203.0.113.9',
    );

    expect(issued.accessToken).toBe('t');
    expect(attempts.clear).toHaveBeenCalledWith(EMAIL);
    const all = lines.join('\n');
    expect(all).not.toContain('203.0');
    expect(all).not.toContain('caller=');
  });
});
