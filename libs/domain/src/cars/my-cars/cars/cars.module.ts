import { Module } from '@nestjs/common';

import { CarsController } from './cars.controller';
import { CarsService } from './cars.service';
import { AUDIT_PORT } from '../../../audit/audit.port';
import { AuditService } from '../../../audit/audit.service';

// The client, the outbox and the accounts come from the global AuthModule.
@Module({
  controllers: [CarsController],
  providers: [CarsService, { provide: AUDIT_PORT, useClass: AuditService }],
})
export class CarsModule {}
