import {
  ClientRepairDto,
  ClientRepairListDto,
  CorrectClientRepairDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ClientRepairsService } from './client-repairs.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';

// The logged repairs drivers shared with the caller's garage, which its owner
// may correct but never delete.
@ApiTags('cars')
@ApiBearerAuth()
@Controller('garage/client-repairs')
@ApiUnauthorizedResponse({ description: 'sign_in_required' })
@ApiForbiddenResponse({
  description: 'forbidden: a receptionist or a mechanic of the garage',
})
export class ClientRepairsController {
  constructor(private readonly repairs: ClientRepairsService) {}

  @Get()
  @Requires('garage.client_repairs')
  @ApiOperation({
    summary: "The logged repairs drivers shared with the caller's garage",
  })
  @ApiOkResponse({ type: ClientRepairListDto })
  @ApiNotFoundResponse({
    description: 'not_found: not a garage owner, or the garage is not approved',
  })
  list(@CurrentActor() actor: Actor): Promise<ClientRepairListDto> {
    return this.repairs.list(actor);
  }

  @Patch(':id')
  @Requires('garage.client_repairs')
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      'Correct what was done, the day, the reading or the amount of a shared repair; null clears the amount',
  })
  @ApiOkResponse({ type: ClientRepairDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad field or id, an unknown field, a day after today or a missing version',
  })
  @ApiNotFoundResponse({
    description:
      'not_found: no such repair shared with the garage, or the garage is not approved',
  })
  @ApiConflictResponse({
    description: 'stale_version: the repair changed since that version',
  })
  correct(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CorrectClientRepairDto,
  ): Promise<ClientRepairDto> {
    return this.repairs.correct(actor, id, body);
  }

  @Delete(':id')
  @Requires('garage.client_repairs')
  @ApiOperation({ summary: 'Always refused: a garage never deletes a repair' })
  @ApiForbiddenResponse({
    description: 'forbidden: the named garage never deletes a logged repair',
  })
  @ApiNotFoundResponse({ description: 'not_found: not a garage owner' })
  remove(@Param('id', new ParseUUIDPipe()) _id: string): never {
    throw refusal(
      HttpStatus.FORBIDDEN,
      'forbidden',
      'The named garage never deletes a logged repair',
    );
  }
}
