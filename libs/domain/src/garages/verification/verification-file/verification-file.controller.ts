import {
  VerificationDecisionDto,
  VerificationFileDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { VerificationFileService } from './verification-file.service';
import { CurrentActor, Requires } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import type { PrismaClient } from '../../../generated/prisma/client';
import { VerificationService } from '../verification.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/verification-files')
export class VerificationFileController {
  private readonly logger = new Logger('VerificationFile');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly files: VerificationFileService,
    private readonly verification: VerificationService,
  ) {}

  @Get(':id')
  @Requires('admin.garages')
  @ApiOkResponse({ type: VerificationFileDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no file' })
  read(@Param('id') id: string): Promise<VerificationFileDto> {
    return this.files.read(id);
  }

  // A waiting file moves to review for this admin; any other is read as it is.
  @Post(':id/open')
  @HttpCode(200)
  @Requires('admin.garages')
  @ApiOkResponse({ type: VerificationFileDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no file' })
  async open(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<VerificationFileDto> {
    const opened = await this.prisma.$transaction((tx) =>
      this.verification.open(tx, actor, id),
    );
    if (opened.first) {
      this.logger.log(`file ${id} opened by ${actor.accountId}`);
    }
    return this.files.read(id);
  }

  // One decision per review; the answer is the file as it now stands.
  @Post(':id/decision')
  @HttpCode(200)
  @Requires('admin.garages')
  @ApiOkResponse({ type: VerificationFileDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no file' })
  @ApiConflictResponse({
    description:
      'verification_transition_refused (decidedBy, decidedAt, currentStatus), rar_check_required, caen_check_required',
  })
  @ApiUnprocessableEntityResponse({
    description: 'reason_required, note_required',
  })
  async decision(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: VerificationDecisionDto,
  ): Promise<VerificationFileDto> {
    await this.prisma.$transaction((tx) =>
      this.verification.decide(tx, actor, id, {
        note: body.note,
        outcome: body.decision,
        reason: body.reason,
        requestedItems: body.requestedItems,
      }),
    );
    return this.files.read(id);
  }

  // A decided file goes back to review; its decision stands until a new one.
  @Post(':id/reopen')
  @HttpCode(200)
  @Requires('admin.garages')
  @ApiOkResponse({ type: VerificationFileDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no file' })
  @ApiConflictResponse({ description: 'verification_transition_refused' })
  async reopen(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<VerificationFileDto> {
    await this.prisma.$transaction((tx) =>
      this.verification.reopen(tx, actor, id),
    );
    return this.files.read(id);
  }
}
