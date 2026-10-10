import {
  CreateGarageReportDto,
  GarageReportCreatedDto,
} from '@motor-fix/contracts';
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { GarageReportsService } from './garage-reports.service';
import { CurrentActor } from '../../../auth/actor.guard';
import { JsonOnly } from '../../../auth/auth.controller';
import type { Actor } from '../../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages')
export class GarageReportsController {
  constructor(private readonly reports: GarageReportsService) {}

  @Post(':id/reports')
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary: 'Report a listed garage; its verification goes back to review',
  })
  @ApiCreatedResponse({ type: GarageReportCreatedDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: the text holds 20 to 1000 characters',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description:
      'not_found: not a driver, staff of this garage, or no listed garage',
  })
  @ApiConflictResponse({
    description:
      'garage_already_reported, or verification_transition_refused: no file',
  })
  @ApiTooManyRequestsResponse({
    description: 'too_many_reports: 5 in the last 24 hours',
  })
  async report(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: CreateGarageReportDto,
  ): Promise<GarageReportCreatedDto> {
    const { createdAt, id: reportId } = await this.reports.report(
      actor,
      id,
      body,
    );
    return { createdAt: createdAt.toISOString(), id: reportId };
  }
}
