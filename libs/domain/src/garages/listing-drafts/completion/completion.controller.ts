import { CompletionCopyDto } from '@motor-fix/contracts';
import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CompletionService } from './completion.service';
import { CurrentActor } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';
import { NoStore } from '../listing-drafts.controller';

@ApiTags('listing-drafts')
@ApiBearerAuth()
@UseInterceptors(NoStore)
@Controller('listing-drafts')
export class CompletionController {
  constructor(private readonly completion: CompletionService) {}

  @Post('completion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Open the copy of the owner's garage that answers a request for more or a rejection, or the one already open",
  })
  @ApiOkResponse({ type: CompletionCopyDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: staff other than the owner',
  })
  @ApiNotFoundResponse({ description: 'not_found: no garage, or no file' })
  @ApiConflictResponse({
    description:
      "verification_transition_refused, with currentStatus: the garage's newest file is neither more_requested nor rejected",
  })
  open(@CurrentActor() actor: Actor): Promise<CompletionCopyDto> {
    return this.completion.open(actor);
  }
}
