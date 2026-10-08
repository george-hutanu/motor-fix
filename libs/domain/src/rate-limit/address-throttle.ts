import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { clientOf } from '../auth/attempts';

interface AddressRule {
  // The Redis key prefix the counts live under.
  key: string;
  limit: number;
  // The logger's name, so a skipped count says whose it was.
  name: string;
  windowSeconds: number;
}

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
    const { key: prefix, limit, windowSeconds } = this.rule;
    const key = `${prefix}:${createHash('sha256').update(client).digest('hex')}`;
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
}
