import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { RemindersScheduler } from './reminders.module';
import type { RemindersService } from './reminders.service';
import { systemLog } from '../../admin/system-log/system-log';
import type { DailyTask } from '../../scheduler/daily';
import { bucharestDaily } from '../../scheduler/daily';

describe('the reminders failure handler', () => {
  afterEach(() => vi.restoreAllMocks());

  // @traces 297-FR-007
  it('writes job_failed when an unrecoverable error ends a job before its last attempt', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const write = vi.spyOn(systemLog, 'write').mockResolvedValue('written');
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

describe('the daily run', () => {
  const day = { data: { day: '2026-10-20' } } as Job<{ day: string }>;
  const scheduler = (tasks: DailyTask[]) => {
    const s = new RemindersScheduler(
      { add: vi.fn() } as unknown as Queue,
      bucharestDaily(9),
      { run: vi.fn() } as unknown as RemindersService,
      tasks,
    );
    s.now = () => new Date('2026-10-20T06:00:00Z');
    return s;
  };

  it('runs every task after one that throws, then fails the job with its error', async () => {
    const broken = new Error('PUBLIC_WEB_URL is not set');
    const after = { run: vi.fn() };

    await expect(
      scheduler([{ run: vi.fn().mockRejectedValue(broken) }, after]).handle(
        day,
      ),
    ).rejects.toBe(broken);
    expect(after.run).toHaveBeenCalledTimes(1);
  });

  it('fails the job once with every error when several tasks throw', async () => {
    const first = new Error('first');
    const second = new Error('second');

    const run = scheduler([
      { run: vi.fn().mockRejectedValue(first) },
      { run: vi.fn().mockRejectedValue(second) },
    ]).handle(day);

    await expect(run).rejects.toBeInstanceOf(AggregateError);
    await expect(run).rejects.toMatchObject({ errors: [first, second] });
  });

  it('finishes the job when every task runs', async () => {
    const tasks = [{ run: vi.fn() }, { run: vi.fn() }];

    await scheduler(tasks).handle(day);

    for (const task of tasks) expect(task.run).toHaveBeenCalledTimes(1);
  });
});
