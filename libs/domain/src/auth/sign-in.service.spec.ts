import { HttpException, Logger } from '@nestjs/common';

import type { AuthOptions } from './actor.guard';
import type { Attempts } from './attempts';
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

async function refusal(blocked: boolean, address: string) {
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
    .signIn({ email: EMAIL, password: PASSWORD }, address)
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
