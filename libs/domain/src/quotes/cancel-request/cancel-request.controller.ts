import { RequestDto } from '@motor-fix/contracts';
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

import { CancelRequestService } from './cancel-request.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('quote-requests')
@ApiBearerAuth()
@Controller('quote-requests')
export class CancelRequestController {
  constructor(private readonly service: CancelRequestService) {}

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel a request not yet booked; every garage still answering is told',
  })
  @ApiOkResponse({ type: RequestDto })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not the driver’s request' })
  @ApiConflictResponse({
    description:
      'invalid_transition: the request is booked, in work, done or closed (its currentStatus named), with a message in the caller’s language',
  })
  cancel(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RequestDto> {
    return this.service.cancel(actor, id);
  }
}
