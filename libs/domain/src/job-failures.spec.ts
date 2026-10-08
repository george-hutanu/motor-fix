import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';

import { logFinalFailure } from './job-failures';
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
