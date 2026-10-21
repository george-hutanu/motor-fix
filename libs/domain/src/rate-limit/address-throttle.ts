import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { clientOf } from '../auth/attempts';

// Calls counted in Redis over a window that begins with the first, under a
// key prefix of their own.
export interface AddressRule {
  // The Redis key prefix the counts live under.
  key: string;
  limit: number;
  // The logger's name, so a skipped count says whose it was.
  name: string;
  windowSeconds: number;
}

// One less, never below nothing, and only while the window lives.
const GIVE = `local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n > 0 then return redis.call('DECR', KEYS[1]) end
return 0`;

// Requests per address in the window that began with the first. Redis only
// counts: when it is unreachable a visitor is never refused for it.
export class AddressThrottle {
  private readonly logger: Logger;

  constructor(
    private readonly redis: Redis,
    private readonly rule: AddressRule,
  ) {
    this.logger = new Logger(rule.name);
  }

  // Counts one request; the seconds to wait once the address is past its
  // share, else null.
  async take(address: string): Promise<number | null> {
    const client = clientOf(address);
    if (!client) {
      this.logger.warn('limit skipped: address unreadable');
      return null;
    }
    return this.takeKey(client);
  }

  // Hands back one request counted for the address, for a call that did not
  // get what it was counted for.
  async give(address: string): Promise<void> {
    const client = clientOf(address);
    if (!client) return;
    try {
      await this.redis.eval(GIVE, 1, this.keyOf(client));
    } catch {
      this.logger.warn('give-back skipped: Redis unavailable');
    }
  }

  // The same count for any key, such as an account's id.
  async takeKey(id: string): Promise<number | null> {
    const { limit, windowSeconds } = this.rule;
    const key = this.keyOf(id);
    try {
      const replies =
        (await this.redis
          .multi()
          .incr(key)
          .expire(key, windowSeconds, 'NX')
          .ttl(key)
          .exec()) ?? [];
      for (const [error] of replies) if (error) throw error;
      if (Number(replies[0]?.[1]) <= limit) return null;
      return Math.max(1, Number(replies[2]?.[1]));
    } catch {
      this.logger.warn('limit skipped: Redis unavailable');
      return null;
    }
  }

  private keyOf(id: string): string {
    return `${this.rule.key}:${createHash('sha256').update(id).digest('hex')}`;
  }
}
