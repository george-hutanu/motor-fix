import { observeWorker, queueTelemetry } from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import {
  CAR_ACCOUNT_DELETED_QUEUE,
  CarAccountDeleted,
  type CarAccountDeletedEvent,
} from './account-deleted';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';

const CAR_ACCOUNT_DELETED_WORKER = Symbol('CAR_ACCOUNT_DELETED_WORKER');

interface CarAccountDeletedOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose database client this shares.
  notifications: DynamicModule;
}

@Module({})
export class CarAccountDeletedModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(CAR_ACCOUNT_DELETED_WORKER) private readonly worker: Worker,
  ) {}

  static registerWorker(options: CarAccountDeletedOptions): DynamicModule {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    return {
      imports: [options.notifications],
      module: CarAccountDeletedModule,
      providers: [
        CarAccountDeleted,
        {
          inject: [CarAccountDeleted],
          provide: CAR_ACCOUNT_DELETED_WORKER,
          useFactory: (cars: CarAccountDeleted) => {
            const worker = new Worker(
              CAR_ACCOUNT_DELETED_QUEUE,
              (job: Job<CarAccountDeletedEvent>) =>
                inJob(job, () => cars.onEvent(job)),
              { autorun: false, connection, telemetry: queueTelemetry() },
            );
            logFinalFailure(worker, new Logger('CarAccountDeleted'));
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  // Started with the application, not when compiled, so a test can hand the
  // handler its events itself.
  onApplicationBootstrap() {
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker.close();
  }
}
