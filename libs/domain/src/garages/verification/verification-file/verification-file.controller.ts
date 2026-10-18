import {
  CorrectRarNumberDto,
  VerificationDecisionDto,
  VerificationFileDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Param,
  Post,
  Put,
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
import { REFUSAL_CODES, VerificationService } from '../verification.service';

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
    description: 'reason_required, note_required, note_too_short',
  })
  async decision(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: VerificationDecisionDto,
  ): Promise<VerificationFileDto> {
    await this.prisma
      .$transaction((tx) =>
        this.verification.decide(tx, actor, id, {
          note: body.note,
          outcome: body.decision,
          reason: body.reason,
          requestedItems: body.requestedItems,
        }),
      )
      .catch(async (error: unknown) => {
        const code = body.decision === 'approved' && refusalCode(error);
        if (code) await this.recordRefusal(actor, id, code);
        throw error;
      });
    return this.files.read(id);
  }

  // The refusal rolled its transaction back, so its entry gets its own; an
  // entry that cannot be written never hides the refusal from the admin.
  private async recordRefusal(actor: Actor, id: string, code: string) {
    try {
      await this.prisma.$transaction((tx) =>
        this.verification.recordRefusal(tx, actor, id, code),
      );
    } catch (cause) {
      this.logger.warn(
        `file ${id} refusal entry not written: ${String(cause)}`,
      );
    }
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

  // An admin sets or corrects the file's RAR number while it is undecided.
  @Put(':id/rar-number')
  @Requires('admin.garages')
  @ApiOkResponse({ type: VerificationFileDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: under 3 characters or holding control characters',
  })
  @ApiConflictResponse({
    description: 'verification_file_decided: the file is decided',
  })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no file' })
  async correct(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: CorrectRarNumberDto,
  ): Promise<VerificationFileDto> {
    await this.prisma.$transaction((tx) =>
      this.verification.correctRarNumber(tx, actor, id, body.rarNumber),
    );
    return this.files.read(id);
  }
}

// The approval rules' refusal code an error carries, if it is one.
function refusalCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const answer = error.getResponse();
  const code =
    typeof answer === 'object' && answer !== null && 'code' in answer
      ? String(answer.code)
      : null;
  return code && REFUSAL_CODES.has(code) ? code : null;
}
