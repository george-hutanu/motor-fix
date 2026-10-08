import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';

import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { FailureLog } from './failure-log';

@Module({
  controllers: [AdminAccountsController],
  providers: [AdminAccountsService],
})
export class AdminAccountsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(FailureLog).forRoutes(AdminAccountsController);
  }
}
