import {
  DashboardLayoutDto,
  PutDashboardLayoutDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { DashboardLayoutsService } from './dashboard-layouts.service';
import { CurrentActor } from '../actor.guard';
import type { Actor } from '../policy';

const FORBIDDEN = 'account_suspended';
const NOT_FOUND =
  'not_found: a role with no dashboard layout yet, or one the caller does not hold';

// The account is the session's, never the request's.
@ApiTags('dashboard-layouts')
@ApiBearerAuth()
@ApiParam({ description: 'admin only for now', name: 'role' })
@ApiUnauthorizedResponse({ description: 'sign_in_required' })
@ApiForbiddenResponse({ description: FORBIDDEN })
@ApiNotFoundResponse({ description: NOT_FOUND })
@Controller('me/dashboard-layouts/:role')
export class DashboardLayoutsController {
  constructor(private readonly layouts: DashboardLayoutsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      "The caller's dashboard sections for the role: saved, or the default",
  })
  @ApiOkResponse({ type: DashboardLayoutDto })
  read(
    @CurrentActor() actor: Actor,
    @Param('role') role: string,
  ): Promise<DashboardLayoutDto> {
    return this.layouts.read(actor, role);
  }

  @Put()
  @ApiOperation({
    summary: "Replace the caller's whole dashboard layout for the role",
  })
  @ApiOkResponse({ type: DashboardLayoutDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a key not in the role list, a key twice, or a bad shape; nothing written',
  })
  save(
    @CurrentActor() actor: Actor,
    @Param('role') role: string,
    @Body() body: PutDashboardLayoutDto,
  ): Promise<DashboardLayoutDto> {
    return this.layouts.save(actor, role, body.panels);
  }

  @Delete()
  @ApiOperation({
    summary: "Put the caller's dashboard for the role back to the default",
  })
  @ApiOkResponse({ type: DashboardLayoutDto })
  reset(
    @CurrentActor() actor: Actor,
    @Param('role') role: string,
  ): Promise<DashboardLayoutDto> {
    return this.layouts.reset(actor, role);
  }
}
