import { type DynamicModule, Module } from '@nestjs/common';

import { TRANSFER_SENDING, type TransferSending } from './transfers';
import {
  CarSaleController,
  CarTransferLinkController,
} from './transfers.controller';
import { CarTransfersService } from './transfers.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { CacheModule } from '../../cache/cache.module';

// The link goes out through the worker while the seller waits (direct-send);
// `sending` is a module that exports DirectSend: the application's
// NotificationsModule. The client, the outbox and the accounts come from the
// global AuthModule; the cache drops the warm car list.
@Module({})
export class CarTransfersModule {
  static register(
    options: TransferSending,
    sending: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [CarSaleController, CarTransferLinkController],
      imports: [CacheModule, sending],
      module: CarTransfersModule,
      providers: [
        CarTransfersService,
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: TRANSFER_SENDING, useValue: options },
      ],
    };
  }
}
