import { type FactoryProvider, Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';

import { LISTING_PHOTOS_QUEUE } from './listing-photos.service';
import { ListingPhotosWorkerModule } from './listing-photos.worker';
import { systemLog } from '../../../admin/system-log/system-log';
import { redisUrlFor } from '../../../notifications/notifications.testing';

const photoJob = (attemptsMade: number) => ({
  attemptsMade,
  data: { key: 'garage_photo/draft-1/photo-1' },
  id: '7',
  name: 'process',
  opts: { attempts: 3 },
});

// @traces 297-FR-007
describe('a listing photo that failed for good', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes one job_failed entry, on its last attempt only', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const write = jest.spyOn(systemLog, 'write').mockResolvedValue('written');
    const { providers = [] } = ListingPhotosWorkerModule.register({
      redisUrl: redisUrlFor(13),
    });
    const factory = providers.find(
      (provider): provider is FactoryProvider =>
        typeof provider === 'object' &&
        'provide' in provider &&
        typeof provider.provide === 'symbol' &&
        provider.provide.description === 'PHOTOS_WORKER',
    );
    const worker = (await factory?.useFactory({})) as Worker;
    try {
      worker.emit(
        'failed',
        photoJob(1) as never,
        new Error('bad image'),
        'active',
      );
      expect(write).not.toHaveBeenCalled();
      worker.emit(
        'failed',
        photoJob(3) as never,
        new Error('bad image'),
        'active',
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith('job_failed', 'worker', {
        attempts: 3,
        error_code: 'Error',
        job: 'process',
        queue: LISTING_PHOTOS_QUEUE,
      });
    } finally {
      await worker.close();
    }
  });
});
