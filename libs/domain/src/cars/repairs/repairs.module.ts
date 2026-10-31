import { Module } from '@nestjs/common';

import { RepairsController } from './repairs.controller';
import { RepairsService } from './repairs.service';

// The client comes from the global AuthModule.
@Module({
  controllers: [RepairsController],
  providers: [RepairsService],
})
export class RepairsModule {}
