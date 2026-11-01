import { Module } from '@nestjs/common';

import { CarHistoryController } from './history.controller';
import { CarHistoryService } from './history.service';
import { ReviewEligibility } from '../../reviews/eligibility/eligibility';

// The client comes from the global AuthModule; the eligibility answers
// each MotorFix repair's review.
@Module({
  controllers: [CarHistoryController],
  providers: [CarHistoryService, ReviewEligibility],
})
export class CarHistoryModule {}
