import { DeclinedQuoteDto } from '@motor-fix/contracts';
import {
  Controller,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { DeclineQuoteService } from './decline-quote.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('quotes')
@ApiBearerAuth()
@Controller('quotes')
export class DeclineQuoteController {
  constructor(private readonly service: DeclineQuoteService) {}

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline one waiting quote; the garage is told' })
  @ApiOkResponse({ type: DeclinedQuoteDto })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not the driver’s quote' })
  @ApiConflictResponse({
    description:
      'invalid_transition: the quote is not waiting (its currentStatus named; a suspended garage’s reads withdrawn), with a message in the caller’s language',
  })
  decline(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DeclinedQuoteDto> {
    return this.service.decline(actor, id);
  }
}
