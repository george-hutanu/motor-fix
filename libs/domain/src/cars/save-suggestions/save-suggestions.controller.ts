import {
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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SaveSuggestionsService } from './save-suggestions.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
import { DriverOnly } from '../saved-garages/saved-garages.service';

// Bearer only, never the refresh cookie, like the saved garages beside it.
@ApiTags('saved-garages')
@ApiBearerAuth()
@Controller('me/save-suggestions')
@UseGuards(DriverOnly)
export class SaveSuggestionsController {
  constructor(private readonly suggestions: SaveSuggestionsService) {}

  @Post(':garageId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Remember the caller's no to saving a garage after a finished job there",
  })
  @ApiNoContentResponse({
    description: 'Recorded, or recorded already with its first time kept',
  })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'driver_role_required: the role in use is not driver',
  })
  @ApiNotFoundResponse({
    description: 'not_found: no finished job of the caller at that garage',
  })
  dismiss(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<void> {
    return this.suggestions.dismiss(actor, garageId);
  }
}
