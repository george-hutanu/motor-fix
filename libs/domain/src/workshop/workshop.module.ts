import { Module } from '@nestjs/common';

import { GarageJobsController } from './garage-jobs/garage-jobs.controller';
import { GarageJobsService } from './garage-jobs/garage-jobs.service';

// The work on a confirmed booking. The client and the Redis connection come
// from the global AuthModule.
@Module({
  controllers: [GarageJobsController],
  providers: [GarageJobsService],
})
export class WorkshopModule {}
