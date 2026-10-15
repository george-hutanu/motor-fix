import {
  DeclineRequestDto,
  GarageRecipientDto,
  GarageRequestDto,
  GarageRequestListDto,
  GarageRequestsQueryDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { GarageRequestsService } from './garage-requests.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';
import { CacheService, cacheKey } from '../../cache/cache.service';
import { DeclineService } from '../decline/decline.service';

@ApiTags('garage-requests')
@ApiBearerAuth()
@Controller('garage/requests')
export class GarageRequestsController {
  constructor(
    private readonly requests: GarageRequestsService,
    private readonly declines: DeclineService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @ApiOkResponse({ type: GarageRequestListDto })
  @ApiBadRequestResponse({ description: 'validation_failed; invalid_cursor' })
  @ApiNotFoundResponse({ description: 'not_found: may not answer requests' })
  async list(
    @CurrentActor() actor: Actor,
    @Query() query: GarageRequestsQueryDto,
  ): Promise<GarageRequestListDto> {
    // The owner's only: the list shows the phone by who reads it.
    const warmed =
      actor.role === 'garage' &&
      actor.garageId &&
      query.status &&
      query.cursor === undefined
        ? await this.cache.take<GarageRequestListDto>(
            cacheKey('garage-home', actor.garageId, query.status),
          )
        : undefined;
    return warmed ?? this.requests.list(actor, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: GarageRequestDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({
    description: 'forbidden: a mechanic who may not answer quotes',
  })
  @ApiNotFoundResponse({ description: 'not_found: not sent to this garage' })
  get(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GarageRequestDto> {
    return this.requests.get(actor, id);
  }

  @Post(':id/decline')
  @UseGuards(JsonOnly)
  @HttpCode(200)
  @ApiOperation({ summary: 'Decline a request with one of the four reasons' })
  @ApiOkResponse({ type: GarageRecipientDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a missing or unknown reason, a bad id',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: a mechanic who may not answer quotes',
  })
  @ApiNotFoundResponse({ description: 'not_found: not sent to this garage' })
  @ApiConflictResponse({
    description:
      'already_answered: the garage answered already; request_not_open: the request, the garage’s row or the garage is closed',
  })
  decline(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeclineRequestDto,
  ): Promise<GarageRecipientDto> {
    return this.declines.decline(actor, id, body.reason);
  }
}
