import { Module } from '@nestjs/common';

import { DeclineService } from './decline/decline.service';
import { GarageRequestsController } from './garage-requests/garage-requests.controller';
import { GarageRequestsService } from './garage-requests/garage-requests.service';
import { QuoteRequestsController } from './quote-requests/quote-requests.controller';
import { QuoteRequestsService } from './quote-requests/quote-requests.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuotesService } from './quotes/quotes.service';
import { RequestsController } from './requests/requests.controller';
import { RequestsService } from './requests/requests.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// Requests, quotes and bookings. The client, the outbox and the Redis
// connection come from the global AuthModule.
@Module({
  controllers: [
    RequestsController,
    GarageRequestsController,
    QuoteRequestsController,
    QuotesController,
  ],
  exports: [DeclineService],
  providers: [
    RequestsService,
    GarageRequestsService,
    QuoteRequestsService,
    QuotesService,
    DeclineService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class QuotesModule {}
