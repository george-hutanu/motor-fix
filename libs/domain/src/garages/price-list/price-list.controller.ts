import {
  BrandRangeDto,
  BrandRangeSavedDto,
  PriceAddDto,
  PriceListDto,
  PriceRangeDto,
  PriceRangeSavedDto,
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
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';

import { PriceListService } from './price-list.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/prices')
export class PriceListController {
  constructor(private readonly priceList: PriceListService) {}

  @Get()
  @ApiOperation({
    summary:
      "The garage's price list: each job, whether drivers see it and, when not, why",
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiOkResponse({ type: PriceListDto })
  @ApiBadRequestResponse({ description: 'validation_failed: not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  read(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<PriceListDto> {
    return this.priceList.read(actor, garageId);
  }

  @Post()
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      'Adds an approved catalogue job to the end of the price list with its default range',
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiCreatedResponse({ type: PriceRangeSavedDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: not a uuid, or an unknown field',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  @ApiUnprocessableEntityResponse({
    description:
      'validation_failed: the range, a job unknown, not approved or already on the list, or a fifty-first job',
  })
  add(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: PriceAddDto,
  ): Promise<PriceRangeSavedDto> {
    return this.priceList.add(actor, garageId, body);
  }

  @Patch(':priceId')
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      "Changes a job's default range and duration in place, against the stamp it was read with",
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiParam({ format: 'uuid', name: 'priceId', type: String })
  @ApiOkResponse({ type: PriceRangeSavedDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: not a uuid, a missing or malformed stamp, or an unknown field',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({
    description: "not_found: no such garage, or no such job's default row",
  })
  @ApiConflictResponse({
    description: 'stale: the row changed since it was read',
  })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  @ApiUnprocessableEntityResponse({
    description: 'validation_failed: the range or the duration',
  })
  setRange(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('priceId', new ParseUUIDPipe()) priceId: string,
    @Body() body: PriceRangeDto,
  ): Promise<PriceRangeSavedDto> {
    return this.priceList.setRange(actor, { garageId, priceId }, body);
  }

  @Put(':jobTypeId/brands/:brandId')
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      "Sets a job's own range for a brand the garage takes, creating it or changing it in place",
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiParam({ format: 'uuid', name: 'jobTypeId', type: String })
  @ApiParam({ format: 'uuid', name: 'brandId', type: String })
  @ApiOkResponse({ type: BrandRangeSavedDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: not a uuid, or an unknown field',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  @ApiUnprocessableEntityResponse({
    description:
      'validation_failed: the range, an unknown or untaken brand, a job not on the list or without a default range, or a duplicate',
  })
  setBrandRange(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('jobTypeId', new ParseUUIDPipe()) jobTypeId: string,
    @Param('brandId', new ParseUUIDPipe()) brandId: string,
    @Body() body: BrandRangeDto,
  ): Promise<BrandRangeSavedDto> {
    return this.priceList.setBrandRange(
      actor,
      { brandId, garageId, jobTypeId },
      body,
    );
  }

  @Delete(':jobTypeId/brands/:brandId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Removes a job's own range for a brand" })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiParam({ format: 'uuid', name: 'jobTypeId', type: String })
  @ApiParam({ format: 'uuid', name: 'brandId', type: String })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiBadRequestResponse({ description: 'validation_failed: not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({
    description: 'not_found: no such garage, or no range for the brand',
  })
  removeBrandRange(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('jobTypeId', new ParseUUIDPipe()) jobTypeId: string,
    @Param('brandId', new ParseUUIDPipe()) brandId: string,
  ): Promise<void> {
    return this.priceList.removeBrandRange(actor, {
      brandId,
      garageId,
      jobTypeId,
    });
  }
}
