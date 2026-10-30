import { Module } from '@nestjs/common';

import { AdminRepairsController } from './admin-repairs/admin-repairs.controller';
import { AdminRepairsService } from './admin-repairs/admin-repairs.service';
import { ClientRepairsController } from './client-repairs.controller';
import { ClientRepairsService } from './client-repairs.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';

// The client and the outbox come from the global AuthModule.
@Module({
  controllers: [AdminRepairsController, ClientRepairsController],
  providers: [
    AdminRepairsService,
    ClientRepairsService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class ClientRepairsModule {}
