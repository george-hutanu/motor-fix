import {
  PlatformRuleChangeDto,
  PlatformRuleChangesDto,
  RequestPlatformRuleChangeDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { PlatformRuleChangesService } from './changes.service';
import { CurrentActor, Requires } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/platform-rule-changes')
export class PlatformRuleChangesController {
  constructor(private readonly changes: PlatformRuleChangesService) {}

  @Get()
  @Requires('admin.settings')
  @ApiQuery({ name: 'key', type: String })
  @ApiOkResponse({ type: PlatformRuleChangesDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no rule' })
  list(
    @CurrentActor() actor: Actor,
    @Query('key') key: string,
  ): Promise<PlatformRuleChangesDto> {
    return this.changes.list(actor, key);
  }

  @Post()
  @Requires('admin.settings')
  @ApiCreatedResponse({ type: PlatformRuleChangeDto })
  @ApiNotFoundResponse({
    description: 'not_found: not an admin, or no rule that needs two admins',
  })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiConflictResponse({ description: 'stale_value, change_pending' })
  request(
    @CurrentActor() actor: Actor,
    @Body() body: RequestPlatformRuleChangeDto,
  ): Promise<PlatformRuleChangeDto> {
    return this.changes.request(actor, body);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Requires('admin.settings')
  @ApiOkResponse({ type: PlatformRuleChangeDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiForbiddenResponse({ description: 'own_request' })
  @ApiConflictResponse({ description: 'already_decided' })
  approve(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<PlatformRuleChangeDto> {
    return this.changes.approve(actor, id);
  }

  @Post(':id/refuse')
  @HttpCode(HttpStatus.OK)
  @Requires('admin.settings')
  @ApiOkResponse({ type: PlatformRuleChangeDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiForbiddenResponse({ description: 'own_request' })
  @ApiConflictResponse({ description: 'already_decided' })
  refuse(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<PlatformRuleChangeDto> {
    return this.changes.refuse(actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Requires('admin.settings')
  @ApiOkResponse({ type: PlatformRuleChangeDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiForbiddenResponse({ description: 'not_requester' })
  @ApiConflictResponse({ description: 'already_decided' })
  cancel(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<PlatformRuleChangeDto> {
    return this.changes.cancel(actor, id);
  }
}
