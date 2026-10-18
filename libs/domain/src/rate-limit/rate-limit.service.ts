import { HttpException, HttpStatus } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AddressThrottle } from './address-throttle';
import { ROUTE_LIMITS, type RouteLimit } from './rate-limit.config';

// The route limits, one count each over the shared client. Redis only
// counts: when it is unreachable no call is refused for it.
export class RateLimits {
  private readonly throttles = new Map<RouteLimit, AddressThrottle>();

  constructor(redis: Redis) {
    for (const [name, rule] of Object.entries(ROUTE_LIMITS))
      this.throttles.set(name as RouteLimit, new AddressThrottle(redis, rule));
  }

  // Counts one call; the seconds to wait once the address or key is past
  // its share, else null.
  wait(limit: RouteLimit, value: string): Promise<number | null> {
    const throttle = this.throttles.get(limit) as AddressThrottle;
    return ROUTE_LIMITS[limit].per === 'address'
      ? throttle.take(value)
      : throttle.takeKey(value);
  }

  // Counts one call and refuses it past the limit.
  async take(limit: RouteLimit, value: string): Promise<void> {
    const wait = await this.wait(limit, value);
    if (wait === null) return;
    throw new HttpException(
      {
        code: 'rate_limited',
        message: 'Too many attempts; try again later',
        retryAfterSeconds: wait,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
