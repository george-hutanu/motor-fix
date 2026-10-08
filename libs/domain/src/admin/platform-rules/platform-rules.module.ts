import { type DynamicModule, Module } from '@nestjs/common';

import { PlatformRulesController } from './platform-rules.controller';
import {
  PLATFORM_RULES_OPTIONS,
  type PlatformRulesOptions,
  PlatformRulesService,
} from './platform-rules.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';

@Module({})
export class PlatformRulesModule {
  static register(options: PlatformRulesOptions): DynamicModule {
    return {
      controllers: [PlatformRulesController],
      module: PlatformRulesModule,
      providers: [
        PlatformRulesService,
        { provide: PLATFORM_RULES_OPTIONS, useValue: options },
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
