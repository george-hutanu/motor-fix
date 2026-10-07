import { Module } from '@nestjs/common';

import { BrandLoader } from './brand-loader';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { PublicHolidaysController } from './public-holidays.controller';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// The client and the Redis connection come from the global AuthModule.
@Module({
  controllers: [BrandsController, PublicHolidaysController],
  providers: [
    BrandLoader,
    BrandsService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class CatalogueModule {}
