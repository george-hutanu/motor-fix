import type { FactoryProvider } from '@nestjs/common';
import { Worker } from 'bullmq';

import { ListingPhotosWorkerModule } from './listing-photos.worker';

jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

const provider = (name: string) => {
  const { providers = [] } = ListingPhotosWorkerModule.register({
    redisUrl: 'redis://127.0.0.1:1',
  });
  return providers.find(
    (each): each is FactoryProvider =>
      typeof each === 'object' &&
      'provide' in each &&
      typeof each.provide === 'symbol' &&
      each.provide.description === name,
  );
};

// The queue is held only for its gauges: with telemetry off it opens no
// Redis connection.
// @traces 878-FR-011
describe('ListingPhotosWorkerModule', () => {
  it('holds no queue with telemetry off', () => {
    expect(provider('PHOTOS_QUEUE')?.useFactory()).toBeUndefined();
  });

  // @traces 1192-photo-variants-FR-010
  it('processes as many photos at once as the configured concurrency', () => {
    process.env['PHOTO_WORKER_CONCURRENCY'] = '3';
    try {
      provider('PHOTOS_WORKER')?.useFactory({});
    } finally {
      delete process.env['PHOTO_WORKER_CONCURRENCY'];
    }

    expect(jest.mocked(Worker).mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ concurrency: 3 }),
    );
  });
});
