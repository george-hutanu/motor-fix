import {
  RecheckDueListDto,
  RecheckRecordedDto,
  RecordRecheckDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { RecheckService } from './recheck.service';
import { CurrentActor, Requires } from '../../../auth/actor.guard';
import { JsonOnly } from '../../../auth/auth.controller';
import type { Actor } from '../../../auth/policy';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class RecheckController {
  constructor(private readonly rechecks: RecheckService) {}

  @Get('rechecks')
  @Requires('admin.garages')
  @ApiOperation({
    summary: 'The published garages due for their monthly register re-check',
  })
  @ApiOkResponse({ type: RecheckDueListDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  due(@CurrentActor() actor: Actor): Promise<RecheckDueListDto> {
    return this.rechecks.due(actor);
  }

  @Post('garages/:id/rechecks')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JsonOnly)
  @Requires('admin.garages')
  @ApiOperation({ summary: "Record a garage's monthly register re-check" })
  @ApiOkResponse({ type: RecheckRecordedDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no garage' })
  @ApiConflictResponse({
    description:
      'recheck_conflict or recheck_stale: the date of last check moved; recheck_not_due',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'recheck_date_invalid, recheck_detail_invalid, recheck_activities_empty, recheck_activity_unknown or recheck_activities_wider, with the field',
  })
  record(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: RecordRecheckDto,
  ): Promise<RecheckRecordedDto> {
    return this.rechecks.record(actor, id, body);
  }
}
