import { Module } from '@nestjs/common';

import { BrandLoader } from './brand-loader';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { JobTypeLoader } from './job-types/job-type-loader';
import { PublicHolidaysController } from './public-holidays.controller';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// The client and the Redis connection come from the global AuthModule.
@Module({
  controllers: [BrandsController, PublicHolidaysController],
  providers: [
    BrandLoader,
    BrandsService,
    JobTypeLoader,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class CatalogueModule {}
