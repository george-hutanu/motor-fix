import { EventEmitter } from 'node:events';

import type { Queue, Worker } from 'bullmq';

import { observeQueue, observeWorker } from './observe';
import { queueTelemetry } from './telemetry-option';

describe('queue telemetry while telemetry is off', () => {
  it('subscribes to nothing and polls nothing', () => {
    const worker = new EventEmitter() as unknown as Worker & EventEmitter;
    const queue = { getJobCounts: jest.fn(), name: 'q' } as unknown as Queue;

    observeWorker(worker);
    const stop = observeQueue(queue);

    expect(worker.listenerCount('failed')).toBe(0);
    expect(worker.listenerCount('completed')).toBe(0);
    expect(queue.getJobCounts).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('gives bullmq no telemetry option', () => {
    expect(queueTelemetry()).toBeUndefined();
  });
});
