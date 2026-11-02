import {
  AskBookingMoveDto,
  BookingMoveDto,
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

import { MovesService } from './moves.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';

const KEY = 'Idempotency-Key';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class MovesController {
  constructor(private readonly service: MovesService) {}

  @Post(':id/moves')
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      'Ask the garage to move a confirmed booking to a free start; the booking keeps its time until the garage answers',
  })
  @ApiHeader({
    description:
      'One per move the driver means; a repeat answers the first move',
    name: KEY,
    required: true,
  })
  @ApiCreatedResponse({ description: 'Asked now', type: BookingMoveDto })
  @ApiOkResponse({
    description: 'The key asked before: the move as it reads now',
    type: BookingMoveDto,
  })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad id or key, or a start that is not a time on the half hour',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not the driver’s booking' })
  @ApiConflictResponse({
    description:
      'The first rule broken, with a message in the caller’s language. invalid_transition: the booking is not confirmed, or its car is received or its job started; move_cutoff: less than 2 hours before the start; move_limit: moved twice already; move_pending: a move waits for an answer; slot_taken: the start is not free',
  })
  async ask(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers(KEY) key: string | undefined,
    @Body() body: AskBookingMoveDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BookingMoveDto> {
    if (!key || key.length > QUOTE_IDEMPOTENCY_KEY_MAX) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        `Idempotency-Key must hold 1 to ${QUOTE_IDEMPOTENCY_KEY_MAX} characters`,
        [{ code: 'required', field: 'idempotency-key' }],
      );
    }
    const { created, move } = await this.service.submit(actor, id, body, key);
    if (!created) res.status(HttpStatus.OK);
    return move;
  }
}
