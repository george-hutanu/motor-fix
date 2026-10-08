import { Module } from '@nestjs/common';

import { GarageJobsController } from './garage-jobs/garage-jobs.controller';
import { GarageJobsService } from './garage-jobs/garage-jobs.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// The work on a confirmed booking. The client and the Redis connection come
// from the global AuthModule.
@Module({
  controllers: [GarageJobsController],
  providers: [
    GarageJobsService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class WorkshopModule {}
