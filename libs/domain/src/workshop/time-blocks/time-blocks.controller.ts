import {
  CreateTimeBlockDto,
  TimeBlockDto,
  TimeBlockOptionsDto,
  TimeBlocksDto,
  TimeBlocksQueryDto,
  UpdateTimeBlockDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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

import { blockNotFound, TimeBlocksService } from './time-blocks.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

const REFUSED_FIELDS =
  'nothing_to_block: neither a mechanic nor a lift, or both switches off; validation_failed naming mechanicId, lift, startsAt, endsAt or note';
// A blockId that is not a uuid names no block: 404, as an unknown one.
const BLOCK_ID = new ParseUUIDPipe({ exceptionFactory: blockNotFound });

const CLASH =
  'mechanic_busy or lift_busy (reason time_block when a block holds it); slot_taken';

@ApiTags('garages')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'sign_in_required' })
@ApiForbiddenResponse({ description: 'forbidden: a mechanic of the garage' })
@Controller('garages/:garageId/time-blocks')
export class TimeBlocksController {
  constructor(private readonly blocks: TimeBlocksService) {}

  @Get()
  @Requires('garage.schedule')
  @ApiOperation({
    operationId: 'garageTimeBlocks',
    summary: "The garage's blocked time over 1 to 31 Bucharest days",
  })
  @ApiOkResponse({ type: TimeBlocksDto })
  @ApiBadRequestResponse({ description: 'validation_failed: the range' })
  @ApiNotFoundResponse({ description: 'not_found' })
  list(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Query() query: TimeBlocksQueryDto,
  ): Promise<TimeBlocksDto> {
    return this.blocks.list(actor, garageId.toLowerCase(), query);
  }

  @Get('options')
  @Requires('garage.schedule')
  @ApiOperation({
    operationId: 'timeBlockOptions',
    summary: 'The lifts and the mechanics a block may take',
  })
  @ApiOkResponse({ type: TimeBlockOptionsDto })
  @ApiBadRequestResponse({ description: 'the garage id is not a uuid' })
  @ApiNotFoundResponse({ description: 'not_found' })
  options(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<TimeBlockOptionsDto> {
    return this.blocks.options(actor, garageId.toLowerCase());
  }

  @Post()
  @Requires('garage.schedule')
  @ApiOperation({
    operationId: 'createTimeBlock',
    summary: 'Block time on a mechanic, a lift or both',
  })
  @ApiCreatedResponse({ type: TimeBlockDto })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiUnprocessableEntityResponse({ description: REFUSED_FIELDS })
  @ApiConflictResponse({ description: CLASH })
  create(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() dto: CreateTimeBlockDto,
  ): Promise<TimeBlockDto> {
    return this.blocks.create(actor, garageId.toLowerCase(), dto);
  }

  @Patch(':blockId')
  @Requires('garage.schedule')
  @ApiOperation({
    operationId: 'updateTimeBlock',
    summary: 'Change a blocked interval that has not ended',
  })
  @ApiOkResponse({ type: TimeBlockDto })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiUnprocessableEntityResponse({ description: REFUSED_FIELDS })
  @ApiConflictResponse({ description: `block_past; ${CLASH}` })
  update(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('blockId', BLOCK_ID) blockId: string,
    @Body() dto: UpdateTimeBlockDto,
  ): Promise<TimeBlockDto> {
    return this.blocks.update(
      actor,
      garageId.toLowerCase(),
      blockId.toLowerCase(),
      dto,
    );
  }

  @Delete(':blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requires('garage.schedule')
  @ApiOperation({
    operationId: 'deleteTimeBlock',
    summary: 'Free a blocked interval that has not ended',
  })
  @ApiNoContentResponse({ description: 'Freed' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'block_past' })
  remove(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('blockId', BLOCK_ID) blockId: string,
  ): Promise<void> {
    return this.blocks.remove(
      actor,
      garageId.toLowerCase(),
      blockId.toLowerCase(),
    );
  }
}
