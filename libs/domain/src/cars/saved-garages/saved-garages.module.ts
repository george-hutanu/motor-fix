import { Module } from '@nestjs/common';

import { SavedGaragesController } from './saved-garages.controller';
import { SavedGaragesService } from './saved-garages.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';

// The client, the outbox and the accounts come from the global AuthModule.
@Module({
  controllers: [SavedGaragesController],
  providers: [
    SavedGaragesService,
    { provide: AUDIT_PORT, useClass: AuditService },
  ],
})
export class SavedGaragesModule {}
