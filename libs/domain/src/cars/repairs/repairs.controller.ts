import { RepairListDto, RepairsQueryDto } from '@motor-fix/contracts';
import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RepairsService } from './repairs.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

const REFUSED = {
  conflict: 'motorfix_repair: a MotorFix repair is the job’s, never edited',
  notFound: 'not_found: not a repair of a car the caller owns',
  notImplemented: 'not_implemented: editing a logged repair comes later',
};

@ApiTags('cars')
@ApiBearerAuth()
@Controller('repairs')
export class RepairsController {
  constructor(private readonly repairs: RepairsService) {}

  @Get()
  @Requires('driver.cars')
  @ApiOperation({
    summary: "The caller's repairs across every car he owns, newest first",
  })
  @ApiOkResponse({ type: RepairListDto })
  @ApiBadRequestResponse({ description: 'validation_failed, invalid_cursor' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description: 'not_found: carId is not a car the caller owns',
  })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: RepairsQueryDto,
  ): Promise<RepairListDto> {
    return this.repairs.list(actor, query);
  }

  @Patch(':id')
  @Requires('driver.cars')
  @ApiOperation({ summary: 'Edit a repair: refused until editing ships' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: REFUSED.notFound })
  @ApiConflictResponse({ description: REFUSED.conflict })
  @ApiResponse({ description: REFUSED.notImplemented, status: 501 })
  edit(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<never> {
    return this.repairs.refuse(actor, id);
  }

  @Delete(':id')
  @Requires('driver.cars')
  @ApiOperation({ summary: 'Delete a repair: refused until editing ships' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: REFUSED.notFound })
  @ApiConflictResponse({ description: REFUSED.conflict })
  @ApiResponse({ description: REFUSED.notImplemented, status: 501 })
  remove(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<never> {
    return this.repairs.refuse(actor, id);
  }
}
