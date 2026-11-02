import {
  ConfirmPhotoDto,
  GaragePhotosDto,
  GaragePhotoUploadDto,
  PhotoUploadAddressDto,
  PhotoUploadRequestDto,
  SaveGaragePhotosDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { OwnerPhotosSave } from './owner-photos.save';
import { OwnerPhotosService } from './owner-photos.service';
import { CurrentActor } from '../../../auth/actor.guard';
import { JsonOnly } from '../../../auth/auth.controller';
import type { Actor } from '../../../auth/policy';

const SIGN_IN = { description: 'sign_in_required' };
const STAFF = {
  description: 'forbidden: the receptionist or mechanic of this garage',
};
const UNKNOWN = {
  description: 'not_found: not this garage, or a garage not yet approved',
};
const SUSPENDED = { description: 'gone: the garage is suspended' };

// The owner's gallery, edited in place: uploads are kept under the garage
// until a save puts them in, and a save sends the whole gallery in order.
@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/photos')
export class OwnerPhotosController {
  constructor(
    private readonly photos: OwnerPhotosService,
    private readonly gallery: OwnerPhotosSave,
  ) {}

  @Get()
  @ApiOperation({ summary: "The garage's gallery in order, with its stamp" })
  @ApiOkResponse({ type: GaragePhotosDto })
  @ApiUnauthorizedResponse(SIGN_IN)
  @ApiForbiddenResponse(STAFF)
  @ApiNotFoundResponse(UNKNOWN)
  list(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<GaragePhotosDto> {
    return this.photos.list(actor, garageId);
  }

  // The body is judged by the use case, after who asks and the garage's
  // state, so it reaches it as sent; the declared shape is the DTO's.
  @Put()
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      'Save the whole gallery in its new order: kept photos by id, new uploads by key, each with its caption',
  })
  @ApiBody({ type: SaveGaragePhotosDto })
  @ApiOkResponse({ type: GaragePhotosDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a rule broken (errors[].field names the entry); unknown_photo: an id the gallery does not hold',
  })
  @ApiUnauthorizedResponse(SIGN_IN)
  @ApiForbiddenResponse(STAFF)
  @ApiNotFoundResponse(UNKNOWN)
  @ApiConflictResponse({
    description:
      'file_missing: an added upload is not stored; photo_processing: its copies are not made yet; profile_changed: the version is not the current one',
  })
  @ApiGoneResponse(SUSPENDED)
  save(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<GaragePhotosDto> {
    return this.gallery.save(actor, garageId, body);
  }

  @Post('upload-url')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Sign an upload of a photo for the gallery' })
  @ApiCreatedResponse({ type: PhotoUploadAddressDto })
  @ApiUnauthorizedResponse(SIGN_IN)
  @ApiForbiddenResponse(STAFF)
  @ApiNotFoundResponse(UNKNOWN)
  @ApiGoneResponse(SUSPENDED)
  @ApiUnprocessableEntityResponse({
    description: 'photos_full, file_type_not_allowed, file_too_large',
  })
  @ApiTooManyRequestsResponse({
    description: 'rate_limited: too many upload addresses for this garage',
  })
  uploadAddress(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: PhotoUploadRequestDto,
  ): Promise<PhotoUploadAddressDto> {
    return this.photos.uploadAddress(actor, garageId, body);
  }

  @Post('uploads')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Keep an uploaded photo under the garage and make its copies',
  })
  @ApiCreatedResponse({ type: GaragePhotoUploadDto })
  @ApiUnauthorizedResponse(SIGN_IN)
  @ApiForbiddenResponse(STAFF)
  @ApiNotFoundResponse({
    description: 'not_found: not this garage, or not an upload of its own',
  })
  @ApiConflictResponse({ description: 'file_missing: nothing was uploaded' })
  @ApiGoneResponse(SUSPENDED)
  @ApiUnprocessableEntityResponse({
    description: 'file_type_mismatch, file_too_large',
  })
  confirm(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: ConfirmPhotoDto,
  ): Promise<GaragePhotoUploadDto> {
    return this.photos.confirm(actor, garageId, body.key);
  }

  @Get('uploads/:id')
  @ApiOperation({ summary: 'An upload not yet saved, as its copies are made' })
  @ApiOkResponse({ type: GaragePhotoUploadDto })
  @ApiUnauthorizedResponse(SIGN_IN)
  @ApiForbiddenResponse(STAFF)
  @ApiNotFoundResponse({ description: 'not_found: no such upload' })
  upload(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GaragePhotoUploadDto> {
    return this.photos.upload(actor, garageId, id);
  }

  @Delete('uploads/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Drop an upload not yet saved, with its copies' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse(SIGN_IN)
  @ApiForbiddenResponse(STAFF)
  @ApiNotFoundResponse({ description: 'not_found: no such upload' })
  @ApiConflictResponse({
    description: 'photo_in_gallery: remove it by saving the gallery',
  })
  @ApiGoneResponse(SUSPENDED)
  removeUpload(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.photos.removeUpload(actor, garageId, id);
  }
}
