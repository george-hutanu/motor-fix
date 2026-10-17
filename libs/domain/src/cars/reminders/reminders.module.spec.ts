import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { RemindersScheduler } from './reminders.module';
import type { RemindersService } from './reminders.service';
import { systemLog } from '../../admin/system-log/system-log';
import { bucharestDaily } from '../../scheduler/daily';

describe('the reminders failure handler', () => {
  afterEach(() => jest.restoreAllMocks());

  // @traces 297-FR-007
  it('writes job_failed when an unrecoverable error ends a job before its last attempt', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const write = jest.spyOn(systemLog, 'write').mockResolvedValue('written');
    const s = new RemindersScheduler(
      {} as Queue,
      bucharestDaily(9),
      {} as RemindersService,
    );
    const unrecoverable = new Error('bad payload');
    unrecoverable.name = 'UnrecoverableError';

    s.failed(
      {
        attemptsMade: 1,
        data: { id: '41', kind: 'car.updated' },
        name: 'event',
        opts: { attempts: 6 },
      } as Job,
      unrecoverable,
    );

    expect(write).toHaveBeenCalledWith('job_failed', 'worker', {
      attempts: 1,
      error_code: 'Error',
      job: 'event',
      queue: 'reminders',
    });
  });
});
