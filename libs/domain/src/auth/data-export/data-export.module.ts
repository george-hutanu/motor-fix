import { type DynamicModule, Module } from '@nestjs/common';

import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';

// Apart from AuthModule, which many specs boot without an object store: the
// download needs the global StorageModule. PRISMA and EVENT_PORT are
// AuthModule's.
@Module({})
export class DataExportModule {
  static register(): DynamicModule {
    return {
      controllers: [DataExportController],
      module: DataExportModule,
      providers: [
        DataExportService,
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
