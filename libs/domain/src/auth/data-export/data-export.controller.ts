import { DataExportDto } from '@motor-fix/contracts';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { DataExportService } from './data-export.service';
import { CurrentActor } from '../actor.guard';
import type { Actor } from '../policy';

// The signed-in person's copy of their own data. Never cached: refusals
// included, every answer is about one account.
@ApiTags('me')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'sign_in_required' })
@ApiForbiddenResponse({ description: 'forbidden: an assistant session' })
@Controller('me/data-export')
export class DataExportController {
  constructor(private readonly exports: DataExportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Queued', type: DataExportDto })
  @ApiConflictResponse({ description: 'export_ready: a copy is ready' })
  @ApiTooManyRequestsResponse({
    description: 'export_too_soon: a copy was asked for in the last 24 hours',
  })
  request(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataExportDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.exports.request(actor);
  }

  @Get()
  @ApiOkResponse({
    description: 'The newest copy, or null before any request',
    type: DataExportDto,
  })
  latest(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataExportDto | null> {
    res.setHeader('Cache-Control', 'no-store');
    return this.exports.latest(actor);
  }

  @Get('download')
  @ApiProduces('application/zip')
  @ApiOkResponse({
    description: 'The ready copy as a ZIP attachment',
    schema: { format: 'binary', type: 'string' },
  })
  @ApiNotFoundResponse({ description: 'not_found: no copy is ready' })
  @ApiServiceUnavailableResponse({
    description: 'storage_unavailable: the file store did not answer',
  })
  async download(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    res.setHeader('Cache-Control', 'no-store');
    const file = await this.exports.download(actor);
    return new StreamableFile(file.body, {
      disposition: `attachment; filename="${file.filename}"`,
      type: 'application/zip',
    });
  }
}
