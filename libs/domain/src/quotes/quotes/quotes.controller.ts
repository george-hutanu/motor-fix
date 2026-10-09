import {
  GarageQuoteDto,
  QUOTE_IDEMPOTENCY_KEY_MAX,
  SendQuoteDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QuotesService } from './quotes.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';
import { refusal } from '../../auth/sign-up.service';

const KEY = 'Idempotency-Key';

@ApiTags('quotes')
@ApiBearerAuth()
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @UseGuards(JsonOnly)
  @ApiOperation({ summary: 'Send the garage’s quote for a request' })
  @ApiHeader({
    description:
      'One per send the garage means; a repeat answers the first quote',
    name: KEY,
    required: true,
  })
  @ApiCreatedResponse({ type: GarageQuoteDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad field, fromLei above toLei, a past slot or a missing key',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: a mechanic who may not answer quotes',
  })
  @ApiNotFoundResponse({
    description: 'not_found: not one of the garage’s requests',
  })
  @ApiConflictResponse({
    description:
      'already_answered: the garage answered already; request_not_open: the request, the garage’s row or the garage is closed',
  })
  send(
    @CurrentActor() actor: Actor,
    @Headers(KEY) key: string | undefined,
    @Body() body: SendQuoteDto,
  ): Promise<GarageQuoteDto> {
    if (!key || key.length > QUOTE_IDEMPOTENCY_KEY_MAX) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        `Idempotency-Key must hold 1 to ${QUOTE_IDEMPOTENCY_KEY_MAX} characters`,
        [{ code: 'required', field: 'idempotency-key' }],
      );
    }
    return this.quotes.send(actor, key, body);
  }
}
