import {
  MediaFileAddressDto,
  MediaFileQueryDto,
  MediaItemDto,
  MediaListDto,
  MediaUploadAddressDto,
  MediaUploadRequestDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { MediaService } from './media.service';
import { CurrentActor } from '../auth/actor.guard';
import type { Actor } from '../auth/policy';

@ApiTags('media')
@ApiBearerAuth()
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('jobs/:id/media/uploads')
  @ApiOperation({
    operationId: 'requestMediaUpload',
    summary: 'Send a photo or a clip of the car to the job',
  })
  @ApiCreatedResponse({ type: MediaUploadAddressDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({
    description:
      'not_found: no such job, another garage’s or driver’s, or live media off',
  })
  @ApiForbiddenResponse({
    description: 'forbidden: not the garage owner or the job’s mechanic',
  })
  @ApiConflictResponse({ description: 'job_handed_over or job_not_in_work' })
  @ApiUnprocessableEntityResponse({
    description: 'file_type_not_allowed, file_too_large or clip_too_long',
  })
  @ApiServiceUnavailableResponse({ description: 'storage_unavailable' })
  requestUpload(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) jobId: string,
    @Body() body: MediaUploadRequestDto,
  ): Promise<MediaUploadAddressDto> {
    return this.media.requestUpload(actor, jobId, body);
  }

  @Post('media/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'completeMediaUpload',
    summary: 'Say a sent file has finished uploading',
  })
  @ApiOkResponse({ type: MediaItemDto })
  @ApiNotFoundResponse({ description: 'not_found: not the sender’s' })
  @ApiConflictResponse({ description: 'file_missing or invalid_state' })
  @ApiUnprocessableEntityResponse({
    description: 'file_type_mismatch or file_too_large',
  })
  @ApiServiceUnavailableResponse({ description: 'storage_unavailable' })
  complete(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MediaItemDto> {
    return this.media.complete(actor, id);
  }

  @Get('jobs/:id/media')
  @ApiOperation({
    operationId: 'listJobMedia',
    summary: 'The job’s photos, clips and kept recordings, oldest first',
  })
  @ApiOkResponse({ type: MediaListDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiForbiddenResponse({ description: 'forbidden' })
  list(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) jobId: string,
  ): Promise<MediaListDto> {
    return this.media.list(actor, jobId);
  }

  @Get('media/:id/file')
  @ApiOperation({
    operationId: 'mediaFileAddress',
    summary: 'A 5-minute address of a visible item’s file or thumbnail',
  })
  @ApiOkResponse({ type: MediaFileAddressDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiForbiddenResponse({ description: 'forbidden' })
  @ApiServiceUnavailableResponse({ description: 'storage_unavailable' })
  file(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: MediaFileQueryDto,
  ): Promise<MediaFileAddressDto> {
    return this.media.fileAddress(actor, id, query.variant);
  }
}
