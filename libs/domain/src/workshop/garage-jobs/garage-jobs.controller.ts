import { JobDto, JobListDto, ListQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
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
  @ApiBadRequestResponse({ description: 'validation_failed; invalid_cursor' })
  @ApiNotFoundResponse({ description: 'not_found: not garage staff' })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: ListQueryDto,
  ): Promise<JobListDto> {
    return this.jobs.list(actor, query.cursor);
  }

  @Get(':id')
  @ApiOkResponse({ type: JobDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not the caller’s job' })
  get(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<JobDto> {
    return this.jobs.get(actor, id);
  }
}
