import {
  AdminCatalogueJobsDto,
  ApproveCatalogueJobDto,
  CatalogueJobDecisionDto,
  RejectCatalogueJobDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';

import { JobDecisionsService } from './job-decisions.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/catalogue-jobs')
export class JobDecisionsController {
  constructor(private readonly decisions: JobDecisionsService) {}

  @Get()
  @Requires('admin.catalogue')
  @ApiOkResponse({ type: AdminCatalogueJobsDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  queue(@CurrentActor() actor: Actor): Promise<AdminCatalogueJobsDto> {
    return this.decisions.queue(actor);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @UseGuards(JsonOnly)
  @Requires('admin.catalogue')
  @ApiOkResponse({ type: CatalogueJobDecisionDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no job' })
  @ApiConflictResponse({ description: 'already_decided' })
  @ApiUnprocessableEntityResponse({
    description:
      'exists: a name of an approved job (jobTypeId, nameRo); unknown_activity',
  })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  approve(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ApproveCatalogueJobDto,
  ): Promise<CatalogueJobDecisionDto> {
    return this.decisions.approve(actor, id, body);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @UseGuards(JsonOnly)
  @Requires('admin.catalogue')
  @ApiOkResponse({ type: CatalogueJobDecisionDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no job' })
  @ApiConflictResponse({ description: 'already_decided' })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  reject(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RejectCatalogueJobDto,
  ): Promise<CatalogueJobDecisionDto> {
    return this.decisions.reject(actor, id, body);
  }
}
