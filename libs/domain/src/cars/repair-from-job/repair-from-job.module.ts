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
  REPAIR_FROM_JOB_QUEUE,
  RepairFromJob,
  type RepairFromJobEvent,
} from './repair-from-job';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { EVENT_PORT, outbox } from '../../events/event.port';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';

const REPAIR_FROM_JOB_WORKER = Symbol('REPAIR_FROM_JOB_WORKER');

interface RepairFromJobOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose database client this shares.
  notifications: DynamicModule;
}

@Module({})
export class RepairFromJobModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(REPAIR_FROM_JOB_WORKER) private readonly worker: Worker,
  ) {}

  static registerWorker(options: RepairFromJobOptions): DynamicModule {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    return {
      imports: [options.notifications],
      module: RepairFromJobModule,
      providers: [
        RepairFromJob,
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: EVENT_PORT, useValue: outbox },
        {
          inject: [RepairFromJob],
          provide: REPAIR_FROM_JOB_WORKER,
          useFactory: (repairs: RepairFromJob) => {
            const worker = new Worker(
              REPAIR_FROM_JOB_QUEUE,
              (job: Job<RepairFromJobEvent>) =>
                inJob(job, () => repairs.onEvent(job)),
              { autorun: false, connection, telemetry: queueTelemetry() },
            );
            logFinalFailure(worker, new Logger('RepairFromJob'));
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
