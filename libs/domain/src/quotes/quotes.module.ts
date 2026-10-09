import { Module } from '@nestjs/common';

import { GarageRequestsController } from './garage-requests/garage-requests.controller';
import { GarageRequestsService } from './garage-requests/garage-requests.service';
import { RequestsController } from './requests/requests.controller';
import { RequestsService } from './requests/requests.service';

// Requests, quotes and bookings. The client and the Redis connection come
// from the global AuthModule.
@Module({
  controllers: [RequestsController, GarageRequestsController],
  providers: [RequestsService, GarageRequestsService],
})
export class QuotesModule {}
