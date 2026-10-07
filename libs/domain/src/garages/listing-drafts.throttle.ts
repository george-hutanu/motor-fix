import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { CREATE_PER_HOUR } from './listing-drafts';
import { clientOf } from '../auth/attempts';

const HOUR_SECONDS = 60 * 60;

// Drafts created per address in the hour that began with the first. Redis
// only counts: when it is unreachable a visitor is never refused for it.
export class ListingDraftThrottle {
  private readonly logger = new Logger('ListingDrafts');

  constructor(private readonly redis: Redis) {}

  // Counts one create; the seconds to wait once the address is past its
  // share, else null.
  async take(address: string): Promise<number | null> {
    const client = clientOf(address);
    if (!client) {
      this.logger.warn('create limit skipped: address unreadable');
      return null;
    }
    const key = `listing-drafts:create:${createHash('sha256').update(client).digest('hex')}`;
    try {
      const replies =
        (await this.redis
          .multi()
          .incr(key)
          .expire(key, HOUR_SECONDS, 'NX')
          .ttl(key)
          .exec()) ?? [];
      for (const [error] of replies) if (error) throw error;
      if (Number(replies[0]?.[1]) <= CREATE_PER_HOUR) return null;
      return Math.max(1, Number(replies[2]?.[1]));
    } catch {
      this.logger.warn('create limit skipped: Redis unavailable');
      return null;
    }
  }
}
