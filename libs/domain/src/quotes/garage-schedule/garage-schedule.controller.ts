import { GarageScheduleDto, ScheduleQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
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

import { GarageScheduleService } from './garage-schedule.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/schedule')
export class GarageScheduleController {
  constructor(private readonly schedule: GarageScheduleService) {}

  @Get()
  @ApiOperation({
    operationId: 'garageSchedule',
    summary:
      'The garage’s bookings over one to seven Bucharest days, with their segments',
  })
  @ApiOkResponse({ type: GarageScheduleDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a bad day, or a range over seven days',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: a mechanic asking for another card',
  })
  @ApiNotFoundResponse({ description: 'not_found: not this garage’s staff' })
  list(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Query() query: ScheduleQueryDto,
  ): Promise<GarageScheduleDto> {
    return this.schedule.list(actor, garageId, query);
  }
}
