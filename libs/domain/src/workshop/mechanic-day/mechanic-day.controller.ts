import { MeDayDto, MeDayQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { MechanicDayService } from './mechanic-day.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/day')
export class MechanicDayController {
  constructor(private readonly day: MechanicDayService) {}

  @Get()
  @ApiOkResponse({ type: MeDayDto })
  @ApiOperation({
    summary:
      'The signed-in mechanic’s jobs of a Bucharest day (today by default), with the work carried from earlier days first on today',
  })
  @ApiNotFoundResponse({
    description:
      'not_found: not a mechanic with a live card at a garage that works as a team',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'validation_failed: the date is not YYYY-MM-DD or is more than 30 days from today',
  })
  get(
    @CurrentActor() actor: Actor,
    @Query() query: MeDayQueryDto,
  ): Promise<MeDayDto> {
    return this.day.get(actor, query);
  }
}
