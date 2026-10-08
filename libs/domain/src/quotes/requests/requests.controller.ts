import { ListQueryDto, RequestDto, RequestListDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequestsService } from './requests.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('requests')
@ApiBearerAuth()
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @ApiOkResponse({ type: RequestListDto })
  @ApiBadRequestResponse({ description: 'validation_failed; invalid_cursor' })
  @ApiNotFoundResponse({ description: 'not_found: not a driver' })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: ListQueryDto,
  ): Promise<RequestListDto> {
    return this.requests.list(actor, query.cursor);
  }

  @Get(':id')
  @ApiOkResponse({ type: RequestDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not the driver’s request' })
  get(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RequestDto> {
    return this.requests.get(actor, id);
  }
}
