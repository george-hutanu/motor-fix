import { Module } from '@nestjs/common';

import { AcceptController } from './accept/accept.controller';
import { AcceptService } from './accept/accept.service';
import { CancelBookingController } from './cancel-booking/cancel-booking.controller';
import { CancelBookingService } from './cancel-booking/cancel-booking.service';
import { CancelRequestController } from './cancel-request/cancel-request.controller';
import { CancelRequestService } from './cancel-request/cancel-request.service';
import { CompareController } from './compare/compare.controller';
import { CompareService } from './compare/compare.service';
import { ConfirmController } from './confirm/confirm.controller';
import { ConfirmService } from './confirm/confirm.service';
import { DeclineService } from './decline/decline.service';
import { DeclineQuoteController } from './decline-quote/decline-quote.controller';
import { DeclineQuoteService } from './decline-quote/decline-quote.service';
import { GarageRequestsController } from './garage-requests/garage-requests.controller';
import { GarageRequestsService } from './garage-requests/garage-requests.service';
import { GarageScheduleController } from './garage-schedule/garage-schedule.controller';
import { GarageScheduleService } from './garage-schedule/garage-schedule.service';
import { QuoteRequestsController } from './quote-requests/quote-requests.controller';
import { QuoteRequestsService } from './quote-requests/quote-requests.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuotesService } from './quotes/quotes.service';
import { RequestsController } from './requests/requests.controller';
import { RequestsService } from './requests/requests.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { CacheModule } from '../cache/cache.module';
import { WorkshopModule } from '../workshop/workshop.module';

// Requests, quotes and bookings. The client, the outbox and the Redis
// connection come from the global AuthModule.
@Module({
  controllers: [
    RequestsController,
    GarageRequestsController,
    QuoteRequestsController,
    QuotesController,
    AcceptController,
    CompareController,
    ConfirmController,
    DeclineQuoteController,
    CancelRequestController,
    CancelBookingController,
    GarageScheduleController,
  ],
  exports: [DeclineService, GarageRequestsService, RequestsService],
  imports: [CacheModule, WorkshopModule],
  providers: [
    RequestsService,
    GarageRequestsService,
    QuoteRequestsService,
    QuotesService,
    DeclineService,
    AcceptService,
    CompareService,
    ConfirmService,
    DeclineQuoteService,
    CancelRequestService,
    CancelBookingService,
    GarageScheduleService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class QuotesModule {}
