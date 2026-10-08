import { Module } from '@nestjs/common';

import { GarageRequestsController } from './garage-requests/garage-requests.controller';
import { GarageRequestsService } from './garage-requests/garage-requests.service';
import { RequestsController } from './requests/requests.controller';
import { RequestsService } from './requests/requests.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// Requests, quotes and bookings. The client and the Redis connection come
// from the global AuthModule.
@Module({
  controllers: [RequestsController, GarageRequestsController],
  providers: [
    RequestsService,
    GarageRequestsService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class QuotesModule {}
