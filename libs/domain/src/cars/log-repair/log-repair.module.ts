import { Module } from '@nestjs/common';

import { LogRepairController } from './log-repair.controller';
import { LogRepairService } from './log-repair.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';

// The client and the outbox come from the global AuthModule.
@Module({
  controllers: [LogRepairController],
  providers: [
    LogRepairService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class LogRepairModule {}
