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
  UseInterceptors,
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

import { ConfirmOutcomes } from './confirm.interceptor';
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
  @ApiForbiddenResponse({ description: 'forbidden: a mechanic of the garage' })
  @ApiNotFoundResponse({ description: 'not_found: not this garage’s booking' })
  options(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConfirmOptionsDto> {
    return this.service.options(actor, id);
  }

  @Post(':id/confirm')
  @UseGuards(JsonOnly)
  @UseInterceptors(ConfirmOutcomes)
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
  @ApiForbiddenResponse({ description: 'forbidden: a mechanic of the garage' })
  @ApiNotFoundResponse({ description: 'not_found: not this garage’s booking' })
  @ApiConflictResponse({
    description:
      'invalid_transition: the booking is not awaiting confirmation, or has lapsed; mechanic_unavailable; outside_hours; mechanic_busy; lift_busy; slot_taken: another confirm took the time first. An outside_hours or mechanic_unavailable refusal names its cause in reason: public_holiday, closed_day or outside_opening for the garage; day_off, saturday_off, not_working or ends_early for the mechanic',
  })
  confirm(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmBookingDto,
  ): Promise<GarageBookingDto> {
    return this.service.confirm(actor, id, body);
  }
}
