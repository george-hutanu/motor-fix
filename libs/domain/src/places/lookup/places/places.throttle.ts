import type { Redis } from 'ioredis';

import { AddressThrottle } from '../../../rate-limit/address-throttle';
import { THROTTLES } from '../../../rate-limit/rate-limit.config';

export const PLACES_LOOKUPS_PER_MINUTE = THROTTLES.places.limit;

// Look-ups per address a minute.
export class PlacesThrottle extends AddressThrottle {
  constructor(redis: Redis) {
    super(redis, THROTTLES.places);
  }
}
