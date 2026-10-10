import type { Redis } from 'ioredis';

import { RECORDS_PER_HOUR } from './consents';
import { AddressThrottle } from '../../rate-limit/address-throttle';

// Choices stored per address in the hour that began with the first.
export class ConsentThrottle extends AddressThrottle {
  constructor(redis: Redis) {
    super(redis, {
      key: 'consents:record',
      limit: RECORDS_PER_HOUR,
      name: 'Consents',
      windowSeconds: 60 * 60,
    });
  }
}
