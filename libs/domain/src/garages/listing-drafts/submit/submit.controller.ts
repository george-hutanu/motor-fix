import {
  LISTING_SUBMIT_CONFLICTS,
  ListingSubmittedDto,
} from '@motor-fix/contracts';
import {
  Controller,
  Headers,
  HttpStatus,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ListingSubmitService } from './submit.service';
import { CurrentActor } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';
import { refusal } from '../../../auth/sign-up.service';
import { NoStore, TOKEN, tokenHeader } from '../listing-drafts.controller';

const KEY = 'Idempotency-Key';

@ApiTags('listing-drafts')
@ApiBearerAuth()
@UseInterceptors(NoStore)
@Controller('listing-drafts')
export class ListingSubmitController {
  constructor(private readonly listings: ListingSubmitService) {}

  @Post(':id/submit')
  @ApiOperation({
    summary: 'Send the draft: its garage and verification file are created',
  })
  @tokenHeader
  @ApiHeader({
    description: 'One per send the person means; a repeat answers the first',
    name: KEY,
    required: true,
  })
  @ApiCreatedResponse({ type: ListingSubmittedDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'draft_not_found' })
  @ApiConflictResponse({
    description: LISTING_SUBMIT_CONFLICTS.join('; '),
  })
  @ApiPayloadTooLargeResponse({ description: 'payload_too_large past 320 KB' })
  @ApiUnprocessableEntityResponse({
    description: 'validation_failed, with errors and warnings',
  })
  submit(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Headers(TOKEN) token: string | undefined,
    @Headers(KEY) key: string | undefined,
  ): Promise<ListingSubmittedDto> {
    if (!key || key.length > 64) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'Idempotency-Key must hold 1 to 64 characters',
        [{ code: 'required', field: 'idempotency-key' }],
      );
    }
    return this.listings.submit(actor, id, token, key);
  }
}
