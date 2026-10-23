import { Module } from '@nestjs/common';

import { BrandLoader } from './brand-loader';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { JobDecisionsController } from './job-decisions/job-decisions.controller';
import { JobDecisionsService } from './job-decisions/job-decisions.service';
import { JobTypeLoader } from './job-types/job-type-loader';
import { JobTypesController } from './job-types/job-types.controller';
import { JobTypesService } from './job-types/job-types.service';
import { PublicHolidaysController } from './public-holidays.controller';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { EVENT_PORT, outbox } from '../events/event.port';

// The client and the Redis connection come from the global AuthModule.
@Module({
  controllers: [
    BrandsController,
    JobDecisionsController,
    JobTypesController,
    PublicHolidaysController,
  ],
  providers: [
    BrandLoader,
    BrandsService,
    JobDecisionsService,
    JobTypeLoader,
    JobTypesService,
    { provide: AUDIT_PORT, useClass: AuditService },
    { provide: EVENT_PORT, useValue: outbox },
  ],
})
export class CatalogueModule {}
