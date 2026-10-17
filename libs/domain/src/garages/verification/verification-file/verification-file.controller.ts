import { CorrectRarNumberDto, VerificationFileDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
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
    this.logger.log(`file ${id} RAR number corrected by ${actor.accountId}`);
    return this.files.read(id);
  }
}
