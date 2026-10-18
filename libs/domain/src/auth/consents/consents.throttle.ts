import type { Redis } from 'ioredis';

import { AddressThrottle } from '../../rate-limit/address-throttle';
import { THROTTLES } from '../../rate-limit/rate-limit.config';

// Choices stored per address in the hour that began with the first.
export class ConsentThrottle extends AddressThrottle {
  constructor(redis: Redis) {
    super(redis, THROTTLES.consents);
  }
}
