import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

const WINDOW_SECONDS = 15 * 60;
const LIMIT = { address: 20, email: 5 } as const;

type Kind = keyof typeof LIMIT;

// The keys never hold the e-mail or the address itself.
const keyOf = (kind: Kind, value: string) =>
  `auth:fail:${kind}:${createHash('sha256').update(value).digest('hex')}`;

// Failed sign-ins per e-mail and per address. Redis only counts: when it is
// unreachable the limits are skipped rather than sign-in being refused.
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
      this.unavailable();
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
      this.unavailable();
    }
  }

  async clear(email: string): Promise<void> {
    try {
      await this.redis.del(keyOf('email', email));
    } catch {
      this.unavailable();
    }
  }

  private unavailable() {
    this.logger.warn('sign-in attempt limits skipped: Redis unavailable');
  }
}
