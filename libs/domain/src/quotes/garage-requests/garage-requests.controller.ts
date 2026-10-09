import {
  GarageRequestDto,
  GarageRequestListDto,
  GarageRequestsQueryDto,
} from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { GarageRequestsService } from './garage-requests.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('garage-requests')
@ApiBearerAuth()
@Controller('garage/requests')
export class GarageRequestsController {
  constructor(private readonly requests: GarageRequestsService) {}

  @Get()
  @ApiOkResponse({ type: GarageRequestListDto })
  @ApiBadRequestResponse({ description: 'validation_failed; invalid_cursor' })
  @ApiNotFoundResponse({ description: 'not_found: may not answer requests' })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: GarageRequestsQueryDto,
  ): Promise<GarageRequestListDto> {
    return this.requests.list(actor, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: GarageRequestDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not sent to this garage' })
  get(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GarageRequestDto> {
    return this.requests.get(actor, id);
  }
}
