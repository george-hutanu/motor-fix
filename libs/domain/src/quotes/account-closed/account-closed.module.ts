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
  ACCOUNT_CLOSED_QUEUE,
  AccountClosed,
  type AccountClosedEvent,
} from './account-closed';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';

const ACCOUNT_CLOSED_WORKER = Symbol('ACCOUNT_CLOSED_WORKER');

interface AccountClosedOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose database client the clean-up
  // shares.
  notifications: DynamicModule;
}

// The account-closed queue: the relay's account.deleted and
// account.suspended events, each closing that driver's open requests.
@Module({})
export class AccountClosedModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(@Inject(ACCOUNT_CLOSED_WORKER) private readonly worker: Worker) {}

  static registerWorker(options: AccountClosedOptions): DynamicModule {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    return {
      imports: [options.notifications],
      module: AccountClosedModule,
      providers: [
        { provide: AUDIT_PORT, useClass: AuditService },
        AccountClosed,
        {
          inject: [AccountClosed],
          provide: ACCOUNT_CLOSED_WORKER,
          useFactory: (closing: AccountClosed) => {
            const worker = new Worker(
              ACCOUNT_CLOSED_QUEUE,
              (job: Job<AccountClosedEvent>) =>
                inJob(job, () => closing.onEvent(job)),
              { autorun: false, connection, telemetry: queueTelemetry() },
            );
            logFinalFailure(worker, new Logger('AccountClosed'));
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
