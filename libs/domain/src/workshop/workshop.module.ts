import { Module } from '@nestjs/common';

import { ActiveRequestController } from './active-request/active-request.controller';
import { ActiveRequestService } from './active-request/active-request.service';
import { GarageJobsController } from './garage-jobs/garage-jobs.controller';
import { GarageJobsService } from './garage-jobs/garage-jobs.service';
import { JobLockController } from './job-lock/job-lock.controller';
import { JobLockService } from './job-lock/job-lock.service';
import { JobStagesController } from './job-stages/job-stages.controller';
import { JobStagesService } from './job-stages/job-stages.service';
import { JobStepsController } from './job-steps/job-steps.controller';
import { JobStepsService } from './job-steps/job-steps.service';
import { ScheduleService } from './schedule/schedule.service';
import { TimeBlocksController } from './time-blocks/time-blocks.controller';
import { TimeBlocksService } from './time-blocks/time-blocks.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// The work on a confirmed booking, and the driver's view of it; the schedule
// a confirm places a booking on, and the time a garage blocks on it. The client, the events and the Redis
// connection come from the global AuthModule.
@Module({
  controllers: [
    ActiveRequestController,
    GarageJobsController,
    JobLockController,
    JobStagesController,
    JobStepsController,
    TimeBlocksController,
  ],
  exports: [ScheduleService],
  providers: [
    ActiveRequestService,
    GarageJobsService,
    JobLockService,
    JobStagesService,
    JobStepsService,
    ScheduleService,
    TimeBlocksService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class WorkshopModule {}
