import {
  GarageSuspensionCreatedDto,
  SuspendGarageDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
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

import { SuspensionService } from './suspension.service';
import { CurrentActor, Requires } from '../../../auth/actor.guard';
import { JsonOnly } from '../../../auth/auth.controller';
import type { Actor } from '../../../auth/policy';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/garages')
export class SuspensionController {
  constructor(private readonly suspensions: SuspensionService) {}

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JsonOnly)
  @Requires('admin.garages')
  @ApiOperation({ summary: 'Take an approved garage off the map' })
  @ApiOkResponse({ type: GarageSuspensionCreatedDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a cause outside the four, or a reason that is not 1 to 200 characters',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no garage' })
  @ApiConflictResponse({
    description: 'garage_already_suspended, or garage_not_approved',
  })
  async suspend(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() { cause, reason }: SuspendGarageDto,
  ): Promise<GarageSuspensionCreatedDto> {
    const done = await this.suspensions.suspend(actor, id, cause, reason);
    return { ...done, fromTime: done.fromTime.toISOString() };
  }
}
