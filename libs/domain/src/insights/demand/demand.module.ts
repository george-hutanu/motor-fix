import { Module } from '@nestjs/common';

import { DemandController } from './demand.controller';
import { AreaLoader } from '../areas/areas';

// The admin's demand reads, and the area load the API runs at its start.
// Needs the global AuthModule for its database.
@Module({
  controllers: [DemandController],
  exports: [AreaLoader],
  providers: [AreaLoader],
})
export class DemandModule {}
