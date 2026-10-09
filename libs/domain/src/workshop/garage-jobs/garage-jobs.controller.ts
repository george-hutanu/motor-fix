import { JobDto, JobListDto, JobListQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { GarageJobsService } from './garage-jobs.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('garage-jobs')
@ApiBearerAuth()
@Controller('garage/jobs')
export class GarageJobsController {
  constructor(private readonly jobs: GarageJobsService) {}

  @Get()
  @ApiOkResponse({ type: JobListDto })
  @ApiOperation({
    summary:
      'The garage’s jobs by booking start, from a Bucharest day (today by default), with every job still in work or paused',
  })
  @ApiBadRequestResponse({ description: 'validation_failed; invalid_cursor' })
  @ApiNotFoundResponse({ description: 'not_found: not garage staff' })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: JobListQueryDto,
  ): Promise<JobListDto> {
    return this.jobs.list(actor, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: JobDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({ description: 'forbidden: another mechanic’s job' })
  @ApiNotFoundResponse({ description: 'not_found: not the garage’s job' })
  get(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<JobDto> {
    return this.jobs.get(actor, id);
  }
}
