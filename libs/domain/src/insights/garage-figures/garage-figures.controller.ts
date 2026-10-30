import { WeeklyFiguresDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { GarageFiguresService } from './garage-figures.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/figures')
export class GarageFiguresController {
  constructor(private readonly figures: GarageFiguresService) {}

  @Get('weekly')
  @ApiOperation({
    operationId: 'garageWeeklyFigures',
    summary:
      'Profile views, requests and conversion of the eight complete weeks before this one',
  })
  @ApiOkResponse({ type: WeeklyFiguresDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a garage id that is not a UUID',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: a mechanic does not read the garage’s figures',
  })
  @ApiNotFoundResponse({ description: 'not_found: not this garage’s staff' })
  weekly(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<WeeklyFiguresDto> {
    return this.figures.weekly(actor, garageId);
  }
}
