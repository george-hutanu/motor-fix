import { CarRepairListDto, SoldCarListDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CarHistoryService } from './history.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

// The sold routes come first, so `sold` is never read as a car id.
@ApiTags('cars')
@ApiBearerAuth()
@Controller('cars')
export class CarHistoryController {
  constructor(private readonly history: CarHistoryService) {}

  @Get('sold')
  @Requires('driver.cars')
  @ApiOperation({ summary: 'The cars the caller sold, newest sale first' })
  @ApiOkResponse({ type: SoldCarListDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  sold(@CurrentActor() actor: Actor): Promise<SoldCarListDto> {
    return this.history.sold(actor);
  }

  @Get('sold/:id/repairs')
  @Requires('driver.cars')
  @ApiOperation({
    summary: "A sold car's repairs, up to the sale date, read-only",
  })
  @ApiOkResponse({ type: CarRepairListDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: the caller never sold it' })
  soldRepairs(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CarRepairListDto> {
    return this.history.soldRepairs(actor, id);
  }

  @Get(':id/repairs')
  @Requires('driver.cars')
  @ApiOperation({ summary: "The caller's car's repairs, newest first" })
  @ApiOkResponse({ type: CarRepairListDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description: 'not_found: not the caller’s car, or removed',
  })
  repairs(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CarRepairListDto> {
    return this.history.repairs(actor, id);
  }
}
