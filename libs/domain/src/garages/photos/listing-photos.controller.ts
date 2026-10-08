import {
  ConfirmPhotoDto,
  ListingPhotoDto,
  ListingPhotosDto,
  PhotoUploadAddressDto,
  PhotoUploadRequestDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ListingPhotosService } from './listing-photos.service';
import { Public } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import { NoStore, TOKEN, tokenHeader } from '../listing-drafts.controller';

@ApiTags('listing-drafts')
@UseInterceptors(NoStore)
@Controller('listing-drafts/:id/photos')
export class ListingPhotosController {
  constructor(private readonly photos: ListingPhotosService) {}

  @Public()
  @Post('upload-url')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @tokenHeader
  @ApiCreatedResponse({ type: PhotoUploadAddressDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted' })
  @ApiUnprocessableEntityResponse({
    description: 'photos_full, file_type_not_allowed, file_too_large',
  })
  uploadAddress(
    @Param('id') id: string,
    @Body() body: PhotoUploadRequestDto,
    @Headers(TOKEN) token?: string,
  ): Promise<PhotoUploadAddressDto> {
    return this.photos.uploadAddress(id, token, body);
  }

  @Public()
  @Post()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @tokenHeader
  @ApiCreatedResponse({ type: ListingPhotoDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted, file_missing' })
  @ApiUnprocessableEntityResponse({
    description: 'photos_full, file_type_mismatch, file_too_large',
  })
  confirm(
    @Param('id') id: string,
    @Body() body: ConfirmPhotoDto,
    @Headers(TOKEN) token?: string,
  ): Promise<ListingPhotoDto> {
    return this.photos.confirm(id, token, body.key);
  }

  @Public()
  @Get()
  @tokenHeader
  @ApiOkResponse({ type: ListingPhotosDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted' })
  list(
    @Param('id') id: string,
    @Headers(TOKEN) token?: string,
  ): Promise<ListingPhotosDto> {
    return this.photos.list(id, token);
  }

  @Public()
  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @tokenHeader
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted' })
  remove(
    @Param('id') id: string,
    @Param('key') key: string,
    @Headers(TOKEN) token?: string,
  ): Promise<void> {
    return this.photos.remove(id, token, key);
  }
}
