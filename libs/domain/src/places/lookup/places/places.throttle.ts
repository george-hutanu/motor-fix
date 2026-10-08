import type { Redis } from 'ioredis';

import { AddressThrottle } from '../../../rate-limit/address-throttle';

export const PLACES_LOOKUPS_PER_MINUTE = 60;

// Look-ups per address a minute: what a person typing needs, and a cap on
// what one source can spend of the provider's free quota.
export class PlacesThrottle extends AddressThrottle {
  constructor(redis: Redis) {
    super(redis, {
      key: 'places:lookup',
      limit: PLACES_LOOKUPS_PER_MINUTE,
      name: 'Places',
      windowSeconds: 60,
    });
  }
}
