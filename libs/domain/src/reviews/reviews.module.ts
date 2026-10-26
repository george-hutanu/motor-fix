import { Module } from '@nestjs/common';

import { ReviewEligibility } from './eligibility/eligibility';
import { GarageReviewsController } from './garage-reviews/garage-reviews.controller';
import { ReviewRepliesController } from './reply/reply.controller';
import { ReviewRepliesService } from './reply/reply.service';
import { ReviewReportsController } from './report/report.controller';
import { ReviewReportsService } from './report/report.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// A driver's review of a finished job. The client and the events come from
// the global AuthModule.
@Module({
  controllers: [
    GarageReviewsController,
    ReviewRepliesController,
    ReviewReportsController,
    ReviewsController,
  ],
  providers: [
    ReviewEligibility,
    ReviewsService,
    ReviewRepliesService,
    ReviewReportsService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class ReviewsModule {}
