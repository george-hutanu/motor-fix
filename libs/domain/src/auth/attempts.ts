import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

const WINDOW_SECONDS = 15 * 60;
const LIMIT = { address: 20, email: 5 } as const;
const SIGN_UP_WINDOW_SECONDS = 60 * 60;
const SIGN_UP_LIMIT = 10;

type Kind = keyof typeof LIMIT;

// The keys never hold the e-mail or the address itself.
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const keyOf = (kind: Kind, value: string) =>
  `auth:fail:${kind}:${digest(value)}`;

// Failed sign-ins per e-mail and per address, and sign-ups per address. Redis
// only counts: when it is unreachable the limits are skipped rather than
// sign-in or sign-up being refused.
export class Attempts {
  private readonly logger = new Logger('SignIn');

  constructor(private readonly redis: Redis) {}

  async blocked(email: string, address: string): Promise<boolean> {
    try {
      const [byEmail, byAddress] = await this.redis.mget(
        keyOf('email', email),
        keyOf('address', address),
      );
      return (
        Number(byEmail) >= LIMIT.email || Number(byAddress) >= LIMIT.address
      );
    } catch {
      this.unavailable('sign-in');
      return false;
    }
  }

  async fail(email: string, address: string): Promise<void> {
    try {
      await this.redis
        .multi()
        .incr(keyOf('email', email))
        .expire(keyOf('email', email), WINDOW_SECONDS)
        .incr(keyOf('address', address))
        .expire(keyOf('address', address), WINDOW_SECONDS)
        .exec();
    } catch {
      this.unavailable('sign-in');
    }
  }

  async clear(email: string): Promise<void> {
    try {
      await this.redis.del(keyOf('email', email));
    } catch {
      this.unavailable('sign-in');
    }
  }

  // Counts one sign-up from the address; false once it has had its 10 in the
  // hour that began with its first.
  async admitSignUp(address: string): Promise<boolean> {
    const key = `auth:signup:address:${digest(address)}`;
    try {
      const [counted] =
        (await this.redis
          .multi()
          .incr(key)
          .expire(key, SIGN_UP_WINDOW_SECONDS, 'NX')
          .exec()) ?? [];
      const [error, count] = counted ?? [new Error('no answer')];
      if (error) throw error;
      return Number(count) <= SIGN_UP_LIMIT;
    } catch {
      this.unavailable('sign-up');
      return true;
    }
  }

  private unavailable(what: 'sign-in' | 'sign-up') {
    this.logger.warn(`${what} attempt limits skipped: Redis unavailable`);
  }
}
