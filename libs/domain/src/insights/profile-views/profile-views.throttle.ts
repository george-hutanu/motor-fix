import type { Redis } from 'ioredis';

import { AddressThrottle } from '../../rate-limit/address-throttle';

// Beacons per address a minute: far above a person opening profiles, low
// enough that one source cannot flood the counters.
export class ProfileViewsThrottle extends AddressThrottle {
  constructor(redis: Redis) {
    super(redis, {
      key: 'insights:pv:address',
      limit: 60,
      name: 'ProfileViews',
      windowSeconds: 60,
    });
  }
}
