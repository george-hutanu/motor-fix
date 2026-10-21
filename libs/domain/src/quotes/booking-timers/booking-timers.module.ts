import {
  observeQueue,
  observeWorker,
  queueTelemetry,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';

import {
  BOOKING_TIMERS_JOBS,
  BOOKING_TIMERS_QUEUE,
  BOOKING_TIMERS_URL,
  type BookingTimerEvent,
  BookingTimers,
} from './booking-timers';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';

export const BOOKING_TIMERS_WORKER = Symbol('BOOKING_TIMERS_WORKER');

interface BookingTimersOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose service reminds the garage.
  notifications: DynamicModule;
  // The web app's address, for the reminder's link.
  webUrl: string | undefined;
}

type BookingTimerJob = Job<BookingTimerEvent | { id?: string }>;

// The booking-timers queue: the relay's quote.accepted and booking.confirmed
// events, which set and clear a booking's timers, and the timers and their
// sweep, which remind the garage and lapse the booking.
@Module({})
export class BookingTimersModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly booking: BookingTimers,
    @Inject(BOOKING_TIMERS_JOBS) private readonly jobs: Queue,
    @Inject(BOOKING_TIMERS_WORKER) private readonly worker: Worker,
  ) {}

  static registerWorker(options: BookingTimersOptions): DynamicModule {
    return {
      imports: [options.notifications],
      module: BookingTimersModule,
      providers: [
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: BOOKING_TIMERS_URL, useValue: options.webUrl ?? '' },
        {
          provide: BOOKING_TIMERS_JOBS,
          useFactory: () => {
            const queue = new Queue(BOOKING_TIMERS_QUEUE, {
              connection: { maxRetriesPerRequest: null, url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        BookingTimers,
        {
          inject: [BookingTimers],
          provide: BOOKING_TIMERS_WORKER,
          useFactory: (booking: BookingTimers) => {
            // Without the address only the reminders stop; a booking still
            // lapses.
            if (!options.webUrl) {
              new Logger('BookingTimers').error(
                'PUBLIC_WEB_URL missing; booking reminders are not sent',
              );
            }
            const worker = new Worker(
              BOOKING_TIMERS_QUEUE,
              (job: BookingTimerJob) =>
                inJob(job, () =>
                  job.name === 'event'
                    ? booking.onEvent(job as Job<BookingTimerEvent>)
                    : booking.timers.handle(job as Job<{ id?: string }>),
                ),
              {
                autorun: false,
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
                telemetry: queueTelemetry(),
              },
            );
            logFinalFailure(worker, new Logger('BookingTimers'));
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  // Started with the application, not when compiled, so a test can run the
  // timers itself.
  async onApplicationBootstrap() {
    await this.booking.timers.startSweep();
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
  }
}
