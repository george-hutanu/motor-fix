import {
  RecordVerificationCheckDto,
  VerificationCheckRecordedDto,
} from '@motor-fix/contracts';
import { Body, Controller, Inject, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { VerificationChecksService } from './verification-checks.service';
import { CurrentActor, Requires } from '../auth/actor.guard';
import type { Actor } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/verification-files')
export class VerificationChecksController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly checks: VerificationChecksService,
  ) {}

  @Put(':id/checks/:kind')
  @Requires('admin.garages')
  @ApiOkResponse({ type: VerificationCheckRecordedDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no file' })
  @ApiConflictResponse({ description: 'verification_file_decided' })
  @ApiUnprocessableEntityResponse({
    description: 'verification_check_kind_unknown',
  })
  record(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: RecordVerificationCheckDto,
  ): Promise<VerificationCheckRecordedDto> {
    return this.prisma.$transaction((tx) =>
      this.checks.record(tx, actor, id, kind, body),
    );
  }
}
