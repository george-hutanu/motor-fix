import {
  ConfirmBookingDto,
  ConfirmOptionsDto,
  GarageBookingDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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

import { ConfirmService } from './confirm.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class ConfirmController {
  constructor(private readonly service: ConfirmService) {}

  @Get(':id/confirm-options')
  @ApiOperation({ summary: 'What a confirm may choose: mechanics and lifts' })
  @ApiOkResponse({ type: ConfirmOptionsDto })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: a mechanic' })
  @ApiNotFoundResponse({ description: 'not_found: not this garage’s booking' })
  options(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConfirmOptionsDto> {
    return this.service.options(actor, id);
  }

  @Post(':id/confirm')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an accepted booking, with its mechanic and lift',
  })
  @ApiOkResponse({ type: GarageBookingDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad id or body, a mechanic or lift the garage does not take, a lift past its count',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: a mechanic' })
  @ApiNotFoundResponse({ description: 'not_found: not this garage’s booking' })
  @ApiConflictResponse({
    description:
      'invalid_transition: the booking is not awaiting confirmation, or has lapsed; mechanic_unavailable; outside_hours; mechanic_busy; lift_busy',
  })
  confirm(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmBookingDto,
  ): Promise<GarageBookingDto> {
    return this.service.confirm(actor, id, body);
  }
}
