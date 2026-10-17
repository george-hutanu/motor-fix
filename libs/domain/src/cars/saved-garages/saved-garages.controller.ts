import {
  SavedGarageDto,
  SavedGarageIdsDto,
  SavedGaragesPageDto,
  SavedGaragesQueryDto,
  SaveGarageDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { SavedGaragesService } from './saved-garages.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

const FORBIDDEN = 'driver_role_required: the role in use is not driver';

// Bearer only, never the refresh cookie, so a cross-site form cannot reach
// these: the save's body is optional and need not be JSON-guarded.
@ApiTags('saved-garages')
@ApiBearerAuth()
@Controller('me/saved-garages')
export class SavedGaragesController {
  constructor(private readonly saved: SavedGaragesService) {}

  @Put(':garageId')
  @ApiOperation({ summary: "Save an approved garage on the caller's account" })
  @ApiBody({ required: false, type: SaveGarageDto })
  @ApiCreatedResponse({ description: 'Saved now', type: SavedGarageDto })
  @ApiOkResponse({
    description: 'Saved already; nothing changed',
    type: SavedGarageDto,
  })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id or body' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({
    description: 'not_found: no approved garage with that id',
  })
  @ApiUnprocessableEntityResponse({
    description: 'saved_at_in_future: savedAt is later than now',
  })
  async save(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: SaveGarageDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SavedGarageDto> {
    const { created, row } = await this.saved.save(
      actor,
      garageId,
      body?.savedAt,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return row;
  }

  @Delete(':garageId')
  @ApiOperation({
    summary:
      "Remove a garage from the caller's saved ones, whatever its status",
  })
  @ApiOkResponse({
    description: 'Removed; savedAt is what an undo sends back',
    type: SavedGarageDto,
  })
  @ApiNoContentResponse({ description: 'Was not saved; nothing changed' })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SavedGarageDto | undefined> {
    const row = await this.saved.remove(actor, garageId);
    res.status(row ? HttpStatus.OK : HttpStatus.NO_CONTENT);
    return row ?? undefined;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      "The caller's saved garages, newest first, 20 a page, with the brands of their cars each works on",
  })
  @ApiOkResponse({ type: SavedGaragesPageDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: near outside Romania or a cursor too long; invalid_cursor: a cursor this list did not give out',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: SavedGaragesQueryDto,
  ): Promise<SavedGaragesPageDto> {
    return this.saved.list(actor, query);
  }

  @Get('ids')
  @ApiOperation({
    summary: "The ids of the caller's saved garages, whatever their status",
  })
  @ApiOkResponse({ type: SavedGarageIdsDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  ids(@CurrentActor() actor: Actor): Promise<SavedGarageIdsDto> {
    return this.saved.ids(actor);
  }
}
