import { Module } from '@nestjs/common';

import { RepairsController } from './repairs.controller';
import { RepairsService } from './repairs.service';
import { ReviewEligibility } from '../../reviews/eligibility/eligibility';

// The client comes from the global AuthModule; the eligibility answers
// each MotorFix repair's review.
@Module({
  controllers: [RepairsController],
  providers: [RepairsService, ReviewEligibility],
})
export class RepairsModule {}
