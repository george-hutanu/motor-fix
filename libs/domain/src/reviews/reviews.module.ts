import { Module } from '@nestjs/common';

import { ReviewEligibility } from './eligibility/eligibility';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// A driver's review of a finished job. The client and the events come from
// the global AuthModule.
@Module({
  controllers: [ReviewsController],
  providers: [
    ReviewEligibility,
    ReviewsService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class ReviewsModule {}
