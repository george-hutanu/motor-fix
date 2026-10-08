import type { Redis } from 'ioredis';

import { CREATE_PER_HOUR } from './listing-drafts';
import { AddressThrottle } from '../rate-limit/address-throttle';

// Drafts created per address in the hour that began with the first.
export class ListingDraftThrottle extends AddressThrottle {
  constructor(redis: Redis) {
    super(redis, {
      key: 'listing-drafts:create',
      limit: CREATE_PER_HOUR,
      name: 'ListingDrafts',
      windowSeconds: 60 * 60,
    });
  }
}
