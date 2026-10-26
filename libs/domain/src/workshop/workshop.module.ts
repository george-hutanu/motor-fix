import { Module } from '@nestjs/common';

import { ActiveRequestController } from './active-request/active-request.controller';
import { ActiveRequestService } from './active-request/active-request.service';
import { GarageJobsController } from './garage-jobs/garage-jobs.controller';
import { GarageJobsService } from './garage-jobs/garage-jobs.service';
import { JobStepsController } from './job-steps/job-steps.controller';
import { JobStepsService } from './job-steps/job-steps.service';
import { ScheduleService } from './schedule/schedule.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// The work on a confirmed booking, and the driver's view of it; the schedule
// a confirm places a booking on. The client, the events and the Redis
// connection come from the global AuthModule.
@Module({
  controllers: [
    ActiveRequestController,
    GarageJobsController,
    JobStepsController,
  ],
  exports: [ScheduleService],
  providers: [
    ActiveRequestService,
    GarageJobsService,
    JobStepsService,
    ScheduleService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class WorkshopModule {}
