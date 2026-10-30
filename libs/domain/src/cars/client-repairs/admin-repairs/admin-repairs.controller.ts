import {
  AdminRepairDto,
  AdminRepairListDto,
  CorrectClientRepairDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
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

import { idOr404, toAdminItem } from './admin-repairs';
import { AdminRepairsService } from './admin-repairs.service';
import { CurrentActor, Requires } from '../../../auth/actor.guard';
import { JsonOnly } from '../../../auth/auth.controller';
import { refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';
import { ADMIN_SCOPE } from '../client-repairs';
import { ClientRepairsService } from '../client-repairs.service';

// A driver's logged repairs as the MotorFix admin reads and corrects them;
// only the driver ever deletes one. Every other caller is answered 404.
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@ApiUnauthorizedResponse({ description: 'sign_in_required' })
export class AdminRepairsController {
  constructor(
    private readonly admin: AdminRepairsService,
    private readonly repairs: ClientRepairsService,
  ) {}

  @Get('accounts/:id/repairs')
  @Requires('admin.users')
  @ApiOperation({
    summary: 'The logged repairs on the cars an account owns now',
  })
  @ApiOkResponse({ type: AdminRepairListDto })
  @ApiNotFoundResponse({
    description: 'not_found: not an admin, or no such account',
  })
  list(@Param('id') id: string): Promise<AdminRepairListDto> {
    return this.admin.list(idOr404(id, 'account'));
  }

  @Get('repairs/:id')
  @Requires('admin.users')
  @ApiOperation({
    summary: 'Open a logged repair; the open is recorded in the activity log',
  })
  @ApiOkResponse({ type: AdminRepairDto })
  @ApiNotFoundResponse({
    description: 'not_found: not an admin, or no such logged repair',
  })
  open(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<AdminRepairDto> {
    return this.admin.open(actor, idOr404(id, 'repair'));
  }

  @Patch('repairs/:id')
  @Requires('admin.users')
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      'Correct what was done, the day, the reading or the amount of a logged repair as MotorFix; null clears the amount',
  })
  @ApiOkResponse({ type: AdminRepairDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad or unknown field, a day after today or a missing version',
  })
  @ApiNotFoundResponse({
    description: 'not_found: not an admin, or no such logged repair',
  })
  @ApiConflictResponse({
    description: 'stale_version: the repair changed since that version',
  })
  async correct(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: CorrectClientRepairDto,
  ): Promise<AdminRepairDto> {
    const row = await this.repairs.correct(
      actor,
      ADMIN_SCOPE,
      idOr404(id, 'repair'),
      body,
    );
    return toAdminItem(row);
  }

  @Delete('repairs/:id')
  @Requires('admin.users')
  @ApiOperation({ summary: 'Always refused: only the driver deletes a repair' })
  @ApiForbiddenResponse({
    description: 'forbidden: an admin never deletes a logged repair',
  })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  remove(): never {
    throw refusal(
      HttpStatus.FORBIDDEN,
      'forbidden',
      'Doar șoferul poate șterge reparația',
    );
  }
}
