import {
  AcceptQuoteDto,
  BookingDto,
  QUOTE_IDEMPOTENCY_KEY_MAX,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { AcceptService } from './accept.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';
import { refusal } from '../../auth/sign-up.service';
import { recordQuoteAccept } from '../quotes/quotes.metrics';

const KEY = 'Idempotency-Key';

@ApiTags('quotes')
@ApiBearerAuth()
@Controller('quotes')
export class AcceptController {
  constructor(private readonly service: AcceptService) {}

  @Post(':id/accept')
  @UseGuards(JsonOnly)
  @ApiOperation({ summary: 'Accept a quote: a booking waits for the garage' })
  @ApiHeader({
    description:
      'One per acceptance the driver means; a repeat answers the first booking',
    name: KEY,
    required: true,
  })
  @ApiCreatedResponse({ description: 'Accepted now', type: BookingDto })
  @ApiOkResponse({
    description: 'The key accepted before: the booking as it reads now',
    type: BookingDto,
  })
  @ApiBadRequestResponse({
    description: 'validation_failed: a bad id, historyShared or key',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not the driver’s quote' })
  @ApiConflictResponse({
    description:
      'invalid_transition: the quote is not waiting, has expired or its garage is suspended, or the request is not quoted; booking_pending: the request already has a booking; slot_passed: the proposed time has passed',
  })
  async accept(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers(KEY) key: string | undefined,
    @Body() body: AcceptQuoteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BookingDto> {
    if (!key || key.length > QUOTE_IDEMPOTENCY_KEY_MAX) {
      recordQuoteAccept('refused');
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        `Idempotency-Key must hold 1 to ${QUOTE_IDEMPOTENCY_KEY_MAX} characters`,
        [{ code: 'required', field: 'idempotency-key' }],
      );
    }
    const { booking, created } = await this.service.accept(
      actor,
      id,
      key,
      body,
    );
    if (!created) res.status(HttpStatus.OK);
    return booking;
  }
}
