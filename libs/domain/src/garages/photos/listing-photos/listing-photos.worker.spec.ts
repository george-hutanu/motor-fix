import type { FactoryProvider } from '@nestjs/common';

import { ListingPhotosWorkerModule } from './listing-photos.worker';

// The queue is held only for its gauges: with telemetry off it opens no
// Redis connection.
// @traces 878-FR-011
describe('ListingPhotosWorkerModule', () => {
  it('holds no queue with telemetry off', () => {
    const { providers = [] } = ListingPhotosWorkerModule.register({
      redisUrl: 'redis://127.0.0.1:1',
    });
    const queue = providers.find(
      (provider): provider is FactoryProvider =>
        typeof provider === 'object' &&
        'provide' in provider &&
        typeof provider.provide === 'symbol' &&
        provider.provide.description === 'PHOTOS_QUEUE',
    );

    expect(queue?.useFactory()).toBeUndefined();
  });
});
