import {
  ChangePlatformRuleDto,
  PlatformRuleDto,
  PlatformRulesDto,
} from '@motor-fix/contracts';
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { PlatformRulesService } from './platform-rules.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/platform-rules')
export class PlatformRulesController {
  constructor(private readonly rules: PlatformRulesService) {}

  @Get()
  @Requires('admin.settings')
  @ApiOkResponse({ type: PlatformRulesDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  list(@CurrentActor() actor: Actor): Promise<PlatformRulesDto> {
    return this.rules.list(actor);
  }

  @Patch(':key')
  @Requires('admin.settings')
  @ApiOkResponse({ type: PlatformRuleDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no rule' })
  @ApiConflictResponse({ description: 'stale_value, two_admins_required' })
  change(
    @CurrentActor() actor: Actor,
    @Param('key') key: string,
    @Body() body: ChangePlatformRuleDto,
  ): Promise<PlatformRuleDto> {
    return this.rules.change(actor, key, body);
  }
}
