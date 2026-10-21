import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { AuthOptions } from './actor.guard';
import { AuthController } from './auth.controller';
import { signInLimitConfig } from './qa-sign-in-limit';
import type { SignInService } from './sign-in.service';
import type { SignUpService } from './sign-up.service';
import type { RateLimits } from '../rate-limit/rate-limit.service';

// @traces 1361-FR-008

const ADDRESS = '203.0.113.7';
const BODY = { email: 'sofer@example.test', password: 'parola-de-test' };

// The route limit as Redis counts it: 30 sign-ins per address, then 429.
function routeLimits() {
  const counts = new Map<string, number>();
  const take = jest.fn(async (limit: string, value: string) => {
    const n = (counts.get(`${limit}:${value}`) ?? 0) + 1;
    counts.set(`${limit}:${value}`, n);
    if (n > 30)
      throw new HttpException(
        { code: 'rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  });
  return { take } as unknown as RateLimits & { take: jest.Mock };
}

function controller(options: Partial<AuthOptions>) {
  const limits = routeLimits();
  const signIn = jest.fn(async () => ({ accessToken: 't', remember: false }));
  const signIns = { signIn } as unknown as SignInService;
  const auth = new AuthController(
    signIns,
    {} as SignUpService,
    limits,
    options as AuthOptions,
  );
  const send = () =>
    auth.signIn(
      BODY,
      { ip: ADDRESS } as Request,
      { cookie: jest.fn() } as unknown as Response,
    );
  return { limits, send, signIn };
}

async function signInTimes(send: () => Promise<unknown>, times: number) {
  for (let i = 1; i < times; i++) await send();
  return send();
}

describe('AuthController sign-in route limit', () => {
  it('takes no signInAttempts count when the option lifts it, and still runs the sign-in and its failure limits', async () => {
    const { limits, send, signIn } = controller({
      skipSignInAttemptsLimit: true,
    });
    await send();
    expect(limits.take).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith(BODY, ADDRESS);
  });

  it('takes one signInAttempts count per sign-in from the caller address without the option', async () => {
    const { limits, send } = controller({});
    await send();
    expect(limits.take).toHaveBeenCalledWith('signInAttempts', ADDRESS);
  });

  it('lets the 31st sign-in from one address through when the PR QA flag is set under APP_ENV=test', async () => {
    const { skipAttemptsLimit } = signInLimitConfig(
      'test',
      { PR_QA_SIGN_IN_UNLIMITED: '1' },
      () => undefined,
    );
    const { send } = controller({
      skipSignInAttemptsLimit: skipAttemptsLimit,
    });
    await expect(signInTimes(send, 31)).resolves.toEqual({
      accessToken: 't',
    });
  });

  it.each(['development', 'staging', 'production'])(
    'refuses the 31st sign-in from one address under %s, the flag set or not',
    async (appEnv) => {
      const { skipAttemptsLimit } = signInLimitConfig(
        appEnv,
        { PR_QA_SIGN_IN_UNLIMITED: '1' },
        () => undefined,
      );
      const { send } = controller({
        skipSignInAttemptsLimit: skipAttemptsLimit,
      });
      await expect(signInTimes(send, 31)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    },
  );
});
