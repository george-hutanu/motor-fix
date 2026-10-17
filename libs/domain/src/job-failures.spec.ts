import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';

import { systemLog } from './admin/system-log/system-log';
import { logFinalFailure, writeJobFailed } from './job-failures';
import { requestContext } from './logging';

function fakeWorker() {
  return Object.assign(new EventEmitter(), { name: 'notifications' });
}

function job(attemptsMade: number, attempts?: number) {
  return { attemptsMade, id: '42', name: 'deliver', opts: { attempts } };
}

// @traces 876-FR-007
describe('logFinalFailure', () => {
  it('writes one error line, with the job id in context, when the last attempt fails', () => {
    const worker = fakeWorker();
    const logger = new Logger('Notifications');
    const seen: unknown[] = [];
    jest.spyOn(logger, 'error').mockImplementation((message) => {
      seen.push([message, requestContext.getStore()?.jobId]);
    });
    logFinalFailure(worker as unknown as Worker, logger);

    worker.emit('failed', job(1, 3), new Error('provider down'));
    worker.emit('failed', job(3, 3), new Error('provider down'));

    expect(seen).toEqual([
      ['notifications job deliver failed: provider down', '42'],
    ]);
  });

  it('treats an unrecoverable error as final', () => {
    const worker = fakeWorker();
    const logger = new Logger('Notifications');
    const error = jest.spyOn(logger, 'error').mockImplementation(() => {});
    logFinalFailure(worker as unknown as Worker, logger);

    const unrecoverable = Object.assign(new Error('unknown job'), {
      name: 'UnrecoverableError',
    });
    worker.emit('failed', job(1, 5), unrecoverable);
    worker.emit('failed', undefined, new Error('stalled'));

    expect(error).toHaveBeenCalledTimes(1);
  });
});

// @traces 297-FR-007
describe('the system log entry of a job that failed for good', () => {
  afterEach(() => jest.restoreAllMocks());

  const watch = () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    return jest.spyOn(systemLog, 'write').mockResolvedValue('written');
  };

  it('is written once, on the last attempt only, with the queue, job, attempts and error class', () => {
    const write = watch();
    const worker = fakeWorker();
    logFinalFailure(worker as unknown as Worker, new Logger('Notifications'));

    worker.emit('failed', job(1, 3), new TypeError('provider down'));
    expect(write).not.toHaveBeenCalled();
    worker.emit('failed', job(3, 3), new TypeError('provider down'));

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('job_failed', 'worker', {
      attempts: 3,
      error_code: 'TypeError',
      job: 'deliver',
      queue: 'notifications',
    });
  });

  it("names the error's own code when it has one", () => {
    const write = watch();
    const coded = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    });
    writeJobFailed(
      'insights',
      { attemptsMade: 1, name: 'demand-daily' },
      coded,
    );
    expect(write).toHaveBeenCalledWith('job_failed', 'worker', {
      attempts: 1,
      error_code: 'ECONNREFUSED',
      job: 'demand-daily',
      queue: 'insights',
    });
  });
});
