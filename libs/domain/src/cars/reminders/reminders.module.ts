import type { EventKind } from '@motor-fix/contracts';
import {
  isFinalFailure,
  observeQueue,
  observeWorker,
  queueTelemetry,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { type Job, type JobsOptions, Queue, Worker } from 'bullmq';

import { type CarEvent, RemindersService } from './reminders.service';
import { writeJobFailed } from '../../job-failures';
import { inJob } from '../../logging';
import {
  bucharestDaily,
  DAILY_TASKS,
  type DailyClock,
  type DailyTask,
  nextRun,
  runDue,
  shortenedDaily,
} from '../../scheduler/daily';

export const REMINDERS_QUEUE = 'reminders';
export const REMINDERS_CLOCK = Symbol('REMINDERS_CLOCK');
const REMINDERS_JOBS = Symbol('REMINDERS_JOBS');
const REMINDERS_WORKER = Symbol('REMINDERS_WORKER');

// The reminders run at 09:00 in Bucharest. The proposed time of the brief.
const RUN_HOUR = 9;

// A failed run is tried 3 more times, 1, 2 and 4 minutes later. A finished
// day keeps its id for two days, so a restart does not run it again; a day
// that failed for good gives it back, so a restart tries it once more.
const RUN: JobsOptions = {
  attempts: 4,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: { age: 2 * 86_400 },
  removeOnFail: true,
};

interface Daily {
  day: string;
}

// A car's edit or removal, relayed onto the reminders queue: its reminders
// follow the new dates or go. Tried 5 more times, 1 to 16 minutes later.
export const CAR_REMINDERS_CONSUMER = {
  jobs: {
    attempts: 6,
    backoff: { delay: 60_000, type: 'exponential' },
    removeOnComplete: true,
    removeOnFail: true,
  } as JobsOptions,
  kinds: ['car.updated', 'car.removed'] as readonly EventKind[],
  queue: REMINDERS_QUEUE,
};

// One job a day, under the id of its day, so a restart or a second worker
// cannot queue a day twice; a day run twice still sends nothing twice.
// The next day is queued before the run, so a failing run cannot stop it.
@Injectable()
export class RemindersScheduler {
  private readonly logger = new Logger('Reminders');
  now = () => new Date();

  constructor(
    @Inject(REMINDERS_JOBS) private readonly jobs: Queue,
    @Inject(REMINDERS_CLOCK) private readonly clock: DailyClock,
    private readonly reminders: RemindersService,
    @Inject(DAILY_TASKS)
    private readonly tasks: DailyTask[] = [],
  ) {}

  // A worker that was down at 09:00 runs that day's run when it starts.
  async start(): Promise<void> {
    const now = this.now();
    if (runDue(this.clock, now)) await this.queue(this.clock.today(now), 0);
    await this.queueNext(now);
  }

  async handle(job: Job<Daily>): Promise<void> {
    await this.queueNext(this.now());
    await this.reminders.run(job.data.day);
    // A task that throws does not skip the ones after it; the job still
    // fails, so the retry runs them all again.
    const errors: unknown[] = [];
    for (const task of this.tasks) {
      try {
        await task.run(this.now());
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, `${errors.length} daily tasks failed`);
    }
  }

  failed(job: Job<Daily | CarEvent>, error: Error): void {
    if (!isFinalFailure(job, error)) return;
    if (job.name === 'event') {
      const { id, kind } = job.data as CarEvent;
      this.logger.error(`reminders lost ${kind} event ${id}: ${error.message}`);
    } else {
      const { day } = job.data as Daily;
      this.logger.error(`reminders run of ${day} failed: ${error.message}`);
    }
    writeJobFailed(REMINDERS_QUEUE, job, error);
  }

  private queueNext(now: Date) {
    const next = nextRun(this.clock, now);
    return this.queue(next.day, next.at.getTime() - now.getTime());
  }

  private async queue(day: string, delay: number) {
    await this.jobs.add(
      'daily',
      { day },
      { ...RUN, delay, jobId: `daily-${day}` },
    );
  }
}

interface RemindersOptions {
  redisUrl: string;
  // Test environments only (reminders-config.ts).
  dayMs?: number;
  // The worker's NotificationsModule, whose service sends the reminders.
  notifications: DynamicModule;
  // Provides DAILY_TASKS: the work the daily job runs after the reminders.
  daily?: Provider;
}

@Module({})
export class RemindersModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly scheduler: RemindersScheduler,
    @Inject(REMINDERS_JOBS) private readonly jobs: Queue,
    @Inject(REMINDERS_WORKER) private readonly worker: Worker,
  ) {}

  static registerWorker(options: RemindersOptions): DynamicModule {
    return {
      imports: [options.notifications],
      module: RemindersModule,
      providers: [
        RemindersService,
        RemindersScheduler,
        options.daily ?? { provide: DAILY_TASKS, useValue: [] },
        {
          provide: REMINDERS_CLOCK,
          useFactory: () =>
            options.dayMs
              ? shortenedDaily(new Date(), options.dayMs)
              : bucharestDaily(RUN_HOUR),
        },
        {
          provide: REMINDERS_JOBS,
          useFactory: () => {
            const queue = new Queue(REMINDERS_QUEUE, {
              connection: { maxRetriesPerRequest: null, url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        {
          inject: [RemindersScheduler, RemindersService],
          provide: REMINDERS_WORKER,
          useFactory: (
            scheduler: RemindersScheduler,
            reminders: RemindersService,
          ) => {
            const worker = new Worker<Daily | CarEvent>(
              REMINDERS_QUEUE,
              (job) =>
                inJob(job, () =>
                  job.name === 'event'
                    ? reminders.onCarEvent(job.data as CarEvent)
                    : scheduler.handle(job as Job<Daily>),
                ),
              {
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
                telemetry: queueTelemetry(),
              },
            );
            // A job that fails for good is dropped (removeOnFail), so it is
            // logged once here: a lost car event leaves its reminders as they were.
            worker.on('failed', (job, error) => {
              if (job) inJob(job, () => scheduler.failed(job, error));
            });
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  onApplicationBootstrap() {
    return this.scheduler.start();
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
  }
}
