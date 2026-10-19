import type { Redis } from 'ioredis';

import { AddressThrottle } from '../../rate-limit/address-throttle';
import { THROTTLES } from '../../rate-limit/rate-limit.config';

// Beacons per address a minute.
export class ProfileViewsThrottle extends AddressThrottle {
  constructor(redis: Redis) {
    super(redis, THROTTLES.profileViews);
  }
}
