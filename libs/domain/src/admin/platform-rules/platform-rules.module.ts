import { type DynamicModule, Module } from '@nestjs/common';

import { PlatformRuleChangesController } from './changes/changes.controller';
import { PlatformRuleChangesService } from './changes/changes.service';
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
  // `notifications` is the application's NotificationsModule: a change
  // request tells the other admins.
  static register(
    options: PlatformRulesOptions,
    notifications: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [PlatformRulesController, PlatformRuleChangesController],
      imports: [notifications],
      module: PlatformRulesModule,
      providers: [
        PlatformRulesService,
        PlatformRuleChangesService,
        { provide: PLATFORM_RULES_OPTIONS, useValue: options },
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
