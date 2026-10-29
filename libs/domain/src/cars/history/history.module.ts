import { Module } from '@nestjs/common';

import { CarHistoryController } from './history.controller';
import { CarHistoryService } from './history.service';

// The client comes from the global AuthModule.
@Module({
  controllers: [CarHistoryController],
  providers: [CarHistoryService],
})
export class CarHistoryModule {}
