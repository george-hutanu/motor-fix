import {
  AuditHistoryPageDto,
  AuditHistoryQueryDto,
} from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AuditHistoryService } from './audit-history.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('audit-history')
@ApiBearerAuth()
@Controller('audit-history')
export class AuditHistoryController {
  constructor(private readonly history: AuditHistoryService) {}

  @Get()
  @ApiOkResponse({ type: AuditHistoryPageDto })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: AuditHistoryQueryDto,
  ): Promise<AuditHistoryPageDto> {
    return this.history.list(actor, query);
  }
}
