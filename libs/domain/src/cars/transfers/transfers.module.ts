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
import { Brevo } from '../../notifications/brevo/brevo';
import type { PhoneConfig } from '../../notifications/phone-config';

// The api sends the link itself, while the seller waits: no queue, and a
// Brevo of its own with a short timeout. The client, the outbox and the
// accounts come from the global AuthModule; the cache drops the warm car list.
@Module({})
export class CarTransfersModule {
  static register(options: {
    brevo: { apiKey: string; apiUrl: string };
    phone: PhoneConfig;
    webUrl: string | undefined;
  }): DynamicModule {
    const sending: TransferSending = {
      brevo: new Brevo({ ...options.brevo, timeoutMs: 5000 }),
      config: options.phone,
      webUrl: options.webUrl,
    };
    return {
      controllers: [CarSaleController, CarTransferLinkController],
      imports: [CacheModule],
      module: CarTransfersModule,
      providers: [
        CarTransfersService,
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: TRANSFER_SENDING, useValue: sending },
      ],
    };
  }
}
