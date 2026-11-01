import { FreeSlotsDto, FreeSlotsQueryDto } from '@motor-fix/contracts';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
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

import { FreeSlotsGuard } from './free-slots.guard';
import { FreeSlotsService } from './free-slots.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

// No capability: FreeSlotsGuard tells apart the staff and the drivers who
// may ask, before the query is validated, and answers everyone else 404.
@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/free-slots')
export class FreeSlotsController {
  constructor(private readonly slots: FreeSlotsService) {}

  @Get()
  @UseGuards(FreeSlotsGuard)
  @ApiOperation({
    operationId: 'garageFreeSlots',
    summary: 'The first starts at which a job of the asked length fits',
  })
  @ApiOkResponse({ type: FreeSlotsDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bound, an unparsable earliest, a mechanicId or excludeBookingId the garage does not have',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: a mechanic of the garage with neither right',
  })
  @ApiNotFoundResponse({ description: 'not_found' })
  list(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Query() query: FreeSlotsQueryDto,
  ): Promise<FreeSlotsDto> {
    return this.slots.freeSlots(actor, garageId.toLowerCase(), query);
  }
}
