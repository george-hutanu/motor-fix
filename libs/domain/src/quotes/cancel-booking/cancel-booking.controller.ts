import { BookingDto, CancelBookingDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CancelBookingService } from './cancel-booking.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class CancelBookingController {
  constructor(private readonly service: CancelBookingService) {}

  @Post(':id/cancel')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel a booking that has not started, with a reason; late inside the free-cancel cutoff, never a penalty',
  })
  @ApiOkResponse({ type: BookingDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad id, a reason the driver may not give, a note past its length',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not the driver’s booking' })
  @ApiConflictResponse({
    description:
      'invalid_transition: the booking has ended, its time has come or its job has started (its currentStatus named), with a message in the caller’s language',
  })
  cancel(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CancelBookingDto,
  ): Promise<BookingDto> {
    return this.service.cancel(actor, id, body);
  }
}
