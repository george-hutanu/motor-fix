import { Module } from '@nestjs/common';

import { DashboardLayoutsController } from './dashboard-layouts.controller';
import { DashboardLayoutsService } from './dashboard-layouts.service';

// The client and the outbox come from the global AuthModule.
@Module({
  controllers: [DashboardLayoutsController],
  providers: [DashboardLayoutsService],
})
export class DashboardLayoutsModule {}
