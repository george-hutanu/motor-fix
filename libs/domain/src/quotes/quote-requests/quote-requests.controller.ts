import {
  CandidateGarageListDto,
  CandidateGaragesQueryDto,
  CreateQuoteRequestDto,
  RequestDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QuoteRequestsService } from './quote-requests.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';
import { refusal } from '../../auth/sign-up.service';

const KEY = 'Idempotency-Key';

@ApiTags('quote-requests')
@ApiBearerAuth()
@Controller('quote-requests')
export class QuoteRequestsController {
  constructor(private readonly quoteRequests: QuoteRequestsService) {}

  @Post()
  @UseGuards(JsonOnly)
  @ApiOperation({ summary: 'Send a quote request to up to five garages' })
  @ApiHeader({
    description:
      'One per send the driver means; a repeat answers the first request',
    name: KEY,
    required: true,
  })
  @ApiCreatedResponse({ type: RequestDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad field, too_many garages, length_mismatch, a missing description or key; garage_cannot_receive: garageId, garageName and reason',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description: 'not_found: not a driver, or not the driver’s car',
  })
  @ApiTooManyRequestsResponse({
    description: 'too_many_requests: 20 sent today already',
  })
  send(
    @CurrentActor() actor: Actor,
    @Headers(KEY) key: string | undefined,
    @Body() body: CreateQuoteRequestDto,
  ): Promise<RequestDto> {
    if (!key || key.length > 64) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'Idempotency-Key must hold 1 to 64 characters',
        [{ code: 'required', field: 'idempotency-key' }],
      );
    }
    return this.quoteRequests.send(actor, key, body);
  }

  @Get('garages')
  @ApiOperation({
    summary: 'Up to five more garages near a place that would take the request',
  })
  @ApiOkResponse({ type: CandidateGarageListDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description: 'not_found: not a driver, or not the driver’s car',
  })
  candidates(
    @CurrentActor() actor: Actor,
    @Query() query: CandidateGaragesQueryDto,
  ): Promise<CandidateGarageListDto> {
    return this.quoteRequests.candidates(actor, query);
  }
}
