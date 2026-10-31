import { GarageBookingDto } from '@motor-fix/contracts';
import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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

import { NoShowService } from './no-show.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class NoShowController {
  constructor(private readonly service: NoShowService) {}

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record that the driver did not come to a confirmed booking whose time has come; no fee, no penalty',
  })
  @ApiOkResponse({ type: GarageBookingDto })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: another mechanic’s booking',
  })
  @ApiNotFoundResponse({ description: 'not_found: not the garage’s booking' })
  @ApiConflictResponse({
    description:
      'invalid_transition: the booking is not confirmed, its time has not come or its job has started (its currentStatus named)',
  })
  record(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GarageBookingDto> {
    return this.service.record(actor, id);
  }

  @Delete(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Withdraw a no-show recorded today (Bucharest time): the booking stands again in its place',
  })
  @ApiOkResponse({ type: GarageBookingDto })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: another mechanic’s booking',
  })
  @ApiNotFoundResponse({ description: 'not_found: not the garage’s booking' })
  @ApiConflictResponse({
    description:
      'invalid_transition: no no-show, or recorded before today; mechanic_busy or lift_busy: its place was taken since',
  })
  withdraw(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GarageBookingDto> {
    return this.service.withdraw(actor, id);
  }
}
